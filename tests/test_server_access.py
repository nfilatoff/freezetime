"""The team server end to end: the app's own middleware and session endpoints, called as ASGI
with a made-up client address (no sockets, so nothing here listens on the network)."""

import asyncio
import json
import shutil

import pytest

from freezetime import team as T
from freezetime.app import access as A
from freezetime.app.server import create_app

REMOTE = "192.168.1.20"
LOCAL = "127.0.0.1"


def call(app, method: str, path: str, client: str = REMOTE, cookies: dict | None = None, body=None) -> tuple[int, dict, dict]:
    """One request: (status, JSON body or {}, cookies set by the response — "" for a deleted one)."""
    payload = b"" if body is None else body if isinstance(body, bytes) else json.dumps(body).encode()
    headers = [(b"host", b"test"), (b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode())]
    if cookies:
        headers.append((b"cookie", "; ".join(f"{k}={v}" for k, v in cookies.items()).encode()))
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method, "scheme": "http",
        "path": path, "raw_path": path.encode(), "query_string": b"", "root_path": "", "headers": headers,
        "client": (client, 50000), "server": ("test", 80),
    }
    sent: list[dict] = []
    done = False

    async def receive():
        nonlocal done
        if done:
            await asyncio.sleep(3600)
        done = True
        return {"type": "http.request", "body": payload, "more_body": False}

    async def send(message):
        sent.append(message)

    async def run():
        await asyncio.wait_for(app(scope, receive, send), 30)

    asyncio.run(run())
    start = next(m for m in sent if m["type"] == "http.response.start")
    raw = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    set_cookies = {}
    for k, v in start["headers"]:
        if k == b"set-cookie":
            name, _, value = v.decode().split(";")[0].partition("=")
            set_cookies[name] = value.strip('"')
    try:
        data = json.loads(raw) if raw else {}
    except ValueError:
        data = {"raw": raw}
    return start["status"], data if isinstance(data, dict) else {"list": data}, set_cookies


@pytest.fixture
def out(tmp_path, dust2_mini):
    shutil.copytree(dust2_mini, tmp_path / "dust2_mini")
    T.save_team(tmp_path, {"name": "Us", "members": [{"nick": "bravo", "role": "awp"}, {"nick": "coach", "role": "coach"}]})
    return tmp_path


def member(out, nick):
    return next(m["id"] for m in T.load_team(out)["members"] if m["nick"] == nick)


def test_without_team_mode_nobody_else_gets_in(out):
    app = create_app(out)
    assert call(app, "GET", "/api/library", LOCAL)[0] == 200
    assert call(app, "GET", "/api/library") == (403, {"detail": "access_local_only"}, {})
    status, session, _ = call(app, "GET", "/api/session")
    assert status == 200 and session["need"] == "team_mode" and session["members"] == [] and "share" not in session
    assert call(app, "POST", "/api/session", body={"token": "x" * 24})[0] == 401


def test_joining_the_team_server(out):
    app = create_app(out, team=True)
    status, mine, _ = call(app, "GET", "/api/session", LOCAL)
    token = mine["share"]["token"]
    assert status == 200 and mine["role"] == "analyst" and mine["need"] is None and A.TOKEN_RE.fullmatch(token)

    # a stranger sees neither the data nor the roster
    assert call(app, "GET", "/api/library") == (401, {"detail": "access_token"}, {})
    status, session, _ = call(app, "GET", "/api/session")
    assert session["need"] == "token" and session["members"] == [] and "share" not in session
    assert call(app, "POST", "/api/session", body={"token": "wrong" * 5})[0] == 401
    assert call(app, "POST", "/api/session", body={"member": member(out, "coach")})[0] == 401  # a nick without the token

    # the join link's token becomes a cookie; then the nick
    status, session, cookies = call(app, "POST", "/api/session", body={"token": token})
    assert status == 200 and session["need"] == "member" and cookies == {A.TOKEN_COOKIE: token}
    assert [m["nick"] for m in session["members"]] == ["bravo", "coach"] and "steamid" not in session["members"][0]
    assert call(app, "GET", "/api/library", cookies=cookies) == (401, {"detail": "access_member"}, {})
    assert call(app, "POST", "/api/session", cookies=cookies, body={"member": "nobody00"})[0] == 404
    status, session, more = call(app, "POST", "/api/session", cookies=cookies, body={"member": member(out, "bravo")})
    assert session["role"] == "player" and not session["can_edit"] and session["need"] is None
    cookies |= more

    # a player looks; the analyst's folders stay private
    status, library, _ = call(app, "GET", "/api/library", cookies=cookies)
    assert status == 200 and [m["id"] for m in library["matches"]] == ["dust2_mini"]
    assert library["folders"] == [] and library["demos"] == [] and library["out"] == ""
    assert call(app, "GET", "/api/matches/dust2_mini", cookies=cookies)[0] == 200
    assert call(app, "PUT", "/api/team", cookies=cookies, body={"name": "Hacked", "members": []}) == (403, {"detail": "access_staff"}, {})
    assert call(app, "DELETE", "/api/matches/dust2_mini", cookies=cookies)[0] == 403
    assert (out / "dust2_mini" / "manifest.json").exists() and T.load_team(out)["name"] == "Us"

    # staff changes shared things, but the game and the disk stay with the analyst's computer
    staff = cookies | {A.MEMBER_COOKIE: member(out, "coach")}
    assert call(app, "GET", "/api/session", cookies=staff)[1]["role"] == "staff"
    assert call(app, "POST", "/api/teams/alias", cookies=staff, body={"raw": "a", "name": "b"})[0] == 200
    for method, path in [("GET", "/api/cs2"), ("GET", "/api/recorder"), ("POST", "/api/library/folders"), ("DELETE", "/api/demos"), ("POST", "/api/session/token")]:
        assert call(app, method, path, cookies=staff, body={}) == (403, {"detail": "access_this_computer"}, {}), path

    # new links: the old token stops working at once
    status, mine, _ = call(app, "POST", "/api/session/token", LOCAL)
    assert mine["share"]["token"] != token
    assert call(app, "GET", "/api/library", cookies=cookies) == (401, {"detail": "access_token"}, {})

    # signing out forgets both cookies
    assert call(app, "DELETE", "/api/session", cookies=cookies)[2] == {A.TOKEN_COOKIE: "", A.MEMBER_COOKIE: ""}


def test_the_analyst_can_say_who_they_are(out):
    app = create_app(out)
    status, session, cookies = call(app, "POST", "/api/session", LOCAL, body={"member": member(out, "coach")})
    assert status == 200 and session["member"]["nick"] == "coach" and session["role"] == "analyst"
    assert A.TOKEN_COOKIE not in cookies  # this computer needs no token
    assert call(app, "POST", "/api/session", LOCAL, cookies=cookies, body={"member": ""})[1]["member"] is None


def test_a_pack_goes_out_and_comes_back(out, tmp_path_factory):
    import tempfile
    from pathlib import Path

    left = lambda: set(Path(tempfile.gettempdir()).glob("freezetime-pack-*.zip"))  # noqa: E731
    before = left()
    app = create_app(out)
    status, data, _ = call(app, "POST", "/api/pack/export", LOCAL, body={"boards": None, "team": True, "matches": ["dust2_mini"]})
    assert status == 200 and data["raw"][:2] == b"PK"
    assert call(app, "POST", "/api/pack/export", LOCAL, body={"matches": ["nope"]})[0] == 404

    other = tmp_path_factory.mktemp("other")
    status, result, _ = call(create_app(other), "PUT", "/api/pack/import", LOCAL, body=data["raw"])
    assert status == 200 and result["matches"] == {"added": ["dust2_mini"], "skipped": []} and result["team"] == "added"
    assert call(create_app(other), "GET", "/api/teams", LOCAL)[1]["own"] == "Us"
    assert call(create_app(other), "PUT", "/api/pack/import", LOCAL, body=b"not a zip") == (400, {"detail": "not a zip file"}, {})
    assert left() == before  # the temporary files are gone, also on Windows
