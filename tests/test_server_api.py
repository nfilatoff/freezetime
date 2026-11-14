"""The app's endpoints end to end, called as ASGI with a made-up client address (no sockets, so
nothing here listens on the network)."""

import asyncio
import json
import shutil

import pytest

from freezetime.app.server import create_app

REMOTE = "192.168.1.20"
LOCAL = "127.0.0.1"


def call(app, method: str, path: str, client: str = LOCAL, body=None) -> tuple[int, dict]:
    """One request: (status, JSON body or {}); a JSON list comes as {"list": ...}, other bytes as {"raw": ...}."""
    payload = b"" if body is None else body if isinstance(body, bytes) else json.dumps(body).encode()
    headers = [(b"host", b"test"), (b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode())]
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method, "scheme": "http",
        "path": path.split("?")[0], "raw_path": path.split("?")[0].encode(), "query_string": path.partition("?")[2].encode(),
        "root_path": "", "headers": headers,
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
    try:
        data = json.loads(raw) if raw else {}
    except ValueError:
        data = {"raw": raw}
    return start["status"], data if isinstance(data, dict) else {"list": data}


@pytest.fixture
def out(tmp_path, dust2_mini):
    shutil.copytree(dust2_mini, tmp_path / "dust2_mini")
    return tmp_path


def test_other_computers_get_nothing(out):
    app = create_app(out)
    assert call(app, "GET", "/api/library")[0] == 200
    assert call(app, "GET", "/api/library", REMOTE) == (403, {"detail": "access_local_only"})
    assert call(app, "GET", "/api/cs2", REMOTE)[0] == 403
    for path in ("/api/session", "/api/team"):  # the team server and the team profile are gone
        assert call(app, "GET", path)[0] == 404, path


def test_replay_state_metadata_and_refresh_conflict(out, monkeypatch):
    app = create_app(out)
    status, match = call(app, "GET", "/api/matches/dust2_mini")
    assert status == 200 and match["has_player_states"] is False and match["can_refresh_replay"] is False
    endpoint = next(r.endpoint for r in app.routes if getattr(r.endpoint, "__name__", "") == "build_replay_data")
    queue = next(cell.cell_contents for cell in endpoint.__closure__ if hasattr(cell.cell_contents, "active_for_match"))
    monkeypatch.setattr(queue, "active_for_match", lambda _match_id: object())
    assert call(app, "POST", "/api/matches/dust2_mini/replay-data") == (409, {"detail": "the match is being processed; wait for the job to finish"})


def test_a_pack_goes_out_and_comes_back(out, tmp_path_factory):
    import tempfile
    from pathlib import Path

    left = lambda: set(Path(tempfile.gettempdir()).glob("freezetime-pack-*.zip"))  # noqa: E731
    before = left()
    app = create_app(out)
    status, data = call(app, "POST", "/api/pack/export", body={"boards": None, "matches": ["dust2_mini"]})
    assert status == 200 and data["raw"][:2] == b"PK"
    assert call(app, "POST", "/api/pack/export", body={"matches": ["nope"]})[0] == 404

    other = tmp_path_factory.mktemp("other")
    status, result = call(create_app(other), "PUT", "/api/pack/import", body=data["raw"])
    assert status == 200 and result["matches"] == {"added": ["dust2_mini"], "skipped": []} and result["team"] is None
    assert call(create_app(other), "PUT", "/api/pack/import", body=b"not a zip") == (400, {"detail": "not a zip file"})
    assert left() == before  # the temporary files are gone, also on Windows


def test_notes_and_playlists(out):
    app = create_app(out)
    status, note = call(app, "POST", "/api/notes", body={"note": {"match": "dust2_mini", "round": 3, "sec": 10, "text": "watch this", "author": "a1b2c3d4"}})
    assert status == 200 and note["text"] == "watch this" and "author" not in note and "mentions" not in note
    assert call(app, "POST", "/api/notes", body={"note": {"match": "nope", "round": 1, "text": "x"}})[0] == 404
    assert [n["id"] for n in call(app, "GET", "/api/notes?match=dust2_mini")[1]["notes"]] == [note["id"]]
    assert call(app, "PUT", f"/api/notes/{note['id']}", body={"text": "changed"})[1]["text"] == "changed"
    assert call(app, "DELETE", f"/api/notes/{note['id']}")[0] == 200
    assert call(app, "DELETE", f"/api/notes/{note['id']}")[0] == 404

    status, pl = call(app, "POST", "/api/playlists", body={"playlist": {"name": "mine", "items": []}})
    assert status == 200 and "owner" not in pl
    item = {"item": {"match": "dust2_mini", "round": 2, "start": 3, "end": 9, "caption": "x"}}
    assert len(call(app, "POST", f"/api/playlists/{pl['id']}/items", body=item)[1]["items"]) == 1
    assert call(app, "POST", f"/api/playlists/{pl['id']}/items", body={"item": {"match": "nope", "round": 1}})[0] == 404
    assert call(app, "PUT", f"/api/playlists/{pl['id']}", body={"playlist": {"name": "renamed", "items": []}})[1]["name"] == "renamed"
    assert [p["name"] for p in call(app, "GET", "/api/playlists")[1]["list"]] == ["renamed"]
    assert call(app, "DELETE", f"/api/playlists/{pl['id']}")[0] == 200


def test_playbook_entries_and_books(out):
    app = create_app(out)
    item = {"name": "B split", "tasks": [{"slot": "bravo", "text": "Smoke doors"}]}
    status, entry = call(app, "POST", "/api/playbook/entries", body={"item": item})
    assert status == 200 and entry["tasks"] == [{"slot": "bravo", "text": "Smoke doors", "utility": []}]
    path = f"/api/playbook/entries/{entry['id']}"
    assert call(app, "GET", "/api/playbook")[1]["entries"] == [entry]
    assert call(app, "GET", path + "/stats")[1]["available"] is False  # no team of ours chosen yet
    status, book = call(app, "POST", "/api/playbook/books", body={"item": {"name": "Dust2", "entries": [entry["id"]]}})
    assert status == 200 and book["entries"] == [entry["id"]]
    assert call(app, "PUT", path, body={"item": item | {"name": "Changed"}})[1]["name"] == "Changed"
    assert call(app, "POST", "/api/playbook/books", body={"item": {"name": "Bad", "entries": ["f" * 12]}})[0] == 400
    assert call(app, "PUT", "/api/playbook/entries/ffffffffffff", body={"item": item})[0] == 404
    assert call(app, "POST", "/api/pack/export", body={"boards": [], "playbook": True})[0] == 200
    assert call(app, "DELETE", path)[0] == 200
    assert call(app, "GET", "/api/playbook")[1]["books"][0]["entries"] == []


def test_playbook_utility_discovery_and_own_stats(out):
    from freezetime.lineups import throws
    from freezetime.scout import match_data

    app = create_app(out)
    actual = throws(out / "dust2_mini").row(0, named=True)
    body = {"match": "dust2_mini", "round": actual["round_num"], "steamid": str(actual["steamid"])}
    status, copied = call(app, "POST", "/api/playbook/utility", body=body)
    assert status == 200 and copied["list"] and "setpos" in copied["list"][0]["commands"]
    assert call(app, "POST", "/api/playbook/utility", body=body | {"round": 199})[0] == 404
    assert call(app, "POST", "/api/playbook/utility", body=body | {"steamid": "123"})[0] == 404
    data = match_data(out / "dust2_mini")
    raw_team = data.rounds.filter(data.rounds["side"] == "terrorist")["team"][0]
    call(app, "POST", "/api/teams/alias", body={"raw": raw_team, "name": "Us"})
    status, found = call(app, "POST", "/api/playbook/discover",
                         body={"matches": ["dust2_mini"], "map": data.map, "team": "Us", "aliases": {raw_team: "Us"}})
    assert status == 200 and found["total"] > 0
    entry = call(app, "POST", "/api/playbook/entries", body={"item": {
        "name": "B", "map": data.map, "side": "terrorist", "detector": {"site": "B", "core": []},
    }})[1]
    assert call(app, "POST", "/api/teams/own", body={"name": "Us"})[1] == {"own": "Us"}
    status, stats = call(app, "GET", f"/api/playbook/entries/{entry['id']}/stats")
    assert status == 200 and stats["available"] and stats["sample"] == 8
    assert 0 <= stats["wins"] <= stats["rounds"] <= stats["sample"]
    assert call(app, "POST", "/api/playbook/discover", body={"matches": ["nope"], "map": data.map, "team": "Us"})[0] == 404


def test_players_of_our_team(out):
    from freezetime.scout import match_data

    app = create_app(out)
    assert call(app, "GET", "/api/teams/own/players")[1] == {"list": []}
    raw_team = match_data(out / "dust2_mini").rounds["team"][0]
    call(app, "POST", "/api/teams/own", body={"name": raw_team})
    players = call(app, "GET", "/api/teams/own/players")[1]["list"]
    assert len(players) == 5 and all(p["matches"] == 1 and p["nick"] for p in players)


def test_only_hlae_records(out):
    app = create_app(out)
    clip = {"round": 2, "start": 1, "end": 4, "steamid": None, "title": "x", "kind": "custom"}
    for capture in ("screen", "window"):  # removed modes are refused, never replaced by another way of recording
        assert call(app, "POST", "/api/recorder/start", body={"match_id": "dust2_mini", "clips": [clip], "capture": capture}) == (400, {"detail": "rec_capture_removed"})
    status = call(app, "GET", "/api/recorder")[1]
    assert "connected" not in status and "bind_command" not in status and "hlae" in status


def test_zone_editor_saves_a_map(out, tmp_path, monkeypatch):
    import shutil

    import freezetime.maps as maps

    configs = tmp_path / "configs"
    shutil.copytree(maps.CONFIG_DIR, configs, ignore=shutil.ignore_patterns("*.py", "__pycache__"))
    monkeypatch.setattr(maps, "CONFIG_DIR", configs)
    maps.load_map_config.cache_clear()
    app = create_app(out)
    zone = {"name": "Box", "group": "mid", "level": "default", "polygon": [[0, 0], [100, 0], [100, 100]]}
    assert call(app, "PUT", "/api/maps/de_nope/zones", body={"zones": [zone]})[0] == 404
    assert call(app, "PUT", "/api/maps/de_dust2/zones", body={"zones": [zone | {"group": "C"}]})[0] == 400
    assert call(app, "PUT", "/api/maps/de_dust2/zones", body={"zones": [zone]}, client=REMOTE)[0] == 403
    status, meta = call(app, "PUT", "/api/maps/de_dust2/zones", body={"zones": [zone]})
    maps.load_map_config.cache_clear()
    assert status == 200 and [z["name"] for z in meta["zones"]] == ["Box"] and meta["sites"]


def test_player_stats_route(out):
    app = create_app(out)
    status, stats = call(app, "GET", "/api/matches/dust2_mini/player-stats")
    assert status == 200 and len(stats) == 10 and all({"weapons", "accuracy", "flashes"} <= set(p) for p in stats.values())
    assert call(app, "GET", "/api/matches/nope/player-stats")[0] == 404


def test_player_stats_pick_up_a_newly_cached_mesh(out, monkeypatch, tmp_path):
    from freezetime import visibility
    from freezetime.app import server

    built = []
    monkeypatch.setattr(server, "player_stats", lambda d: built.append(d) or {"n": len(built)})
    monkeypatch.setattr(visibility, "mesh_path", lambda map_name: None)
    server._player_stats.cache_clear()
    app = create_app(out)
    assert call(app, "GET", "/api/matches/dust2_mini/player-stats")[1] == {"n": 1}
    assert call(app, "GET", "/api/matches/dust2_mini/player-stats")[1] == {"n": 1}  # cached
    mesh = tmp_path / "de_dust2.mesh"
    mesh.write_bytes(b"")
    monkeypatch.setattr(visibility, "mesh_path", lambda map_name: mesh if map_name == "de_dust2" else None)
    assert call(app, "GET", "/api/matches/dust2_mini/player-stats")[1] == {"n": 2}  # the mesh appeared: rebuilt without a restart
    assert call(app, "GET", "/api/matches/dust2_mini/player-stats")[1] == {"n": 2}
    server._player_stats.cache_clear()
