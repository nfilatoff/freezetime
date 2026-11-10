import pytest

from freezetime.app import access as A

TOKEN = "t" * 24
MEMBERS = [
    {"id": "aaaaaaaa", "nick": "alpha", "steamid": "", "role": "igl"},
    {"id": "bbbbbbbb", "nick": "bravo", "steamid": "", "role": "awp"},
    {"id": "cccccccc", "nick": "coach", "steamid": "", "role": "coach"},
]


def who(host="192.168.1.20", token=TOKEN, member=None, server_token=TOKEN):
    cookies = {}
    if token:
        cookies[A.TOKEN_COOKIE] = token
    if member:
        cookies[A.MEMBER_COOKIE] = member
    return A.identify(host, cookies, server_token, MEMBERS)


@pytest.mark.parametrize("host, local", [
    ("127.0.0.1", True), ("127.5.5.5", True), ("::1", True), ("::ffff:127.0.0.1", True), ("localhost", True),
    ("192.168.1.20", False), ("100.64.0.3", False), ("::ffff:192.168.1.20", False), ("fe80::1%eth0", False), ("", False), (None, False), ("garbage", False),
])
def test_is_local(host, local):
    assert A.is_local(host) is local


def test_this_computer_is_the_analyst():
    w = A.identify("127.0.0.1", {}, TOKEN, MEMBERS)
    assert (w.role, w.can_edit, w.need) == ("analyst", True, None)
    assert A.identify("127.0.0.1", {A.MEMBER_COOKIE: "cccccccc"}, None, MEMBERS).member["nick"] == "coach"  # who writes the notes


def test_roles_of_remote_visitors():
    assert who(token=None).need == "token" and who(token=None).role is None
    assert who(token="x" * 24).need == "token"  # a wrong token
    assert who().need == "member" and who().role is None  # the token alone is not enough
    assert who(member="nobody00").need == "member"
    assert who(member="bbbbbbbb").role == "player" and not who(member="bbbbbbbb").can_edit
    assert who(member="aaaaaaaa").role == "staff"  # the IGL draws the tactics
    assert who(member="cccccccc").role == "staff" and who(member="cccccccc").can_edit
    # a member cookie without the token says nothing, and no token on the server means no way in
    assert who(token=None, member="cccccccc").member is None
    assert who(server_token=None, member="cccccccc").role is None


def test_without_team_mode_only_this_computer_gets_data():
    local, remote = A.identify("127.0.0.1", {}, None, MEMBERS), who(server_token=None)
    assert A.verdict(local, "DELETE", "/api/demos", False) is None
    assert A.verdict(remote, "GET", "/api/library", False) == (403, "access_local_only")
    assert A.verdict(remote, "GET", "/api/session", False) is None  # so the page can explain itself
    assert A.verdict(remote, "GET", "/assets/index.js", False) is None


def test_the_token_and_the_nick_come_first():
    assert A.verdict(who(token=None), "GET", "/api/library", True) == (401, "access_token")
    assert A.verdict(who(), "GET", "/api/library", True) == (401, "access_member")
    for w in (who(token=None), who()):
        assert A.verdict(w, "GET", "/api/session", True) is None
        assert A.verdict(w, "POST", "/api/session", True) is None
        assert A.verdict(w, "GET", "/", True) is None


@pytest.mark.parametrize("method, path", [
    ("GET", "/api/cs2"), ("POST", "/api/cs2/open"), ("POST", "/api/recorder/start"), ("GET", "/api/recorder"),
    ("POST", "/api/hlae/install"), ("POST", "/api/library/folders"), ("POST", "/api/extract"), ("DELETE", "/api/demos"),
    ("POST", "/api/session/token"),
])
def test_the_game_and_the_disk_answer_this_computer_only(method, path):
    for member in ("bbbbbbbb", "cccccccc"):
        assert A.verdict(who(member=member), method, path, True) == (403, "access_this_computer")
    assert A.verdict(A.identify("127.0.0.1", {}, TOKEN, MEMBERS), method, path, True) is None
    assert A.verdict(who(token=None), "POST", "/api/session/token", True) == (403, "access_this_computer")


def test_players_look_and_staff_changes():
    player, staff = who(member="bbbbbbbb"), who(member="cccccccc")
    for method, path in [("GET", "/api/library"), ("GET", "/api/matches/m/rounds/3/replay"), ("POST", "/api/aggregate"),
                         ("POST", "/api/pack/export"), ("POST", "/api/playbook/discover"), ("POST", "/api/notes"), ("DELETE", "/api/notes/abc"), ("PUT", "/api/playlists/abc")]:
        assert A.verdict(player, method, path, True) is None, (method, path)
    for method, path in [("PUT", "/api/upload"), ("DELETE", "/api/matches/m"), ("POST", "/api/boards"), ("PUT", "/api/team"),
                         ("PUT", "/api/pack/import"), ("POST", "/api/teams/alias"), ("POST", "/api/matches/m/highlights"),
                         ("POST", "/api/playbook/entries"), ("PUT", "/api/playbook/books/abc"), ("DELETE", "/api/playbook/entries/abc"),
                         ("POST", "/api/playbook/utility"), ("POST", "/api/notesXYZ")]:  # a prefix is a path segment, not a string match
        assert A.verdict(player, method, path, True) == (403, "access_staff"), (method, path)
        assert A.verdict(staff, method, path, True) is None, (method, path)


def test_tokens():
    a, b = A.new_token(), A.new_token()
    assert a != b and A.TOKEN_RE.fullmatch(a)
