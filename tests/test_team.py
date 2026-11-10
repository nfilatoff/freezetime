import json

import pytest

from freezetime import team as T


def sample(**over) -> dict:
    t = {
        "name": "  Our   Team ",
        "members": [
            {"nick": " alpha ", "steamid": "76561198000000001", "role": "igl"},
            {"nick": "bravo", "steamid": "76561198000000002", "role": "awp"},
            {"nick": "coach", "steamid": "", "role": "coach"},
        ],
    }
    return t | over


def test_missing_profile_is_empty(tmp_path):
    assert T.load_team(tmp_path) == T.empty_team()


def test_save_and_load(tmp_path):
    saved = T.save_team(tmp_path, sample())
    assert saved["name"] == "Our Team"  # whitespace collapsed
    assert [m["nick"] for m in saved["members"]] == ["alpha", "bravo", "coach"]
    assert all(T.ID_RE.fullmatch(m["id"]) for m in saved["members"])
    assert len({m["id"] for m in saved["members"]}) == 3
    assert saved["updated"] > 0
    assert T.load_team(tmp_path) == saved
    assert json.loads((tmp_path / "team.json").read_text(encoding="utf-8"))["format"] == T.FORMAT


def test_member_ids_survive_a_rename(tmp_path):
    saved = T.save_team(tmp_path, sample())
    saved["members"][0]["nick"] = "alpha2"
    again = T.save_team(tmp_path, saved)
    assert again["members"][0] == saved["members"][0]
    assert [m["id"] for m in again["members"]] == [m["id"] for m in saved["members"]]


def test_duplicate_member_id_gets_a_new_one(tmp_path):
    saved = T.save_team(tmp_path, sample())
    saved["members"][1]["id"] = saved["members"][0]["id"]
    again = T.save_team(tmp_path, saved)
    assert again["members"][1]["id"] != again["members"][0]["id"]


@pytest.mark.parametrize("members, word", [
    ([{"nick": ""}], "nick"),
    ([{"nick": "a"}, {"nick": "A"}], "called"),
    ([{"nick": "a", "steamid": "123"}], "SteamID64"),
    ([{"nick": "a", "steamid": "76561198000000001"}, {"nick": "b", "steamid": "76561198000000001"}], "twice"),
    ([{"nick": "a", "role": "boss"}], "role"),
    ([{"nick": f"p{i}"} for i in range(T.MAX_MEMBERS + 1)], "at most"),
    ("nope", "list"),
])
def test_bad_profiles_are_refused(tmp_path, members, word):
    with pytest.raises(T.TeamError, match=word):
        T.save_team(tmp_path, {"name": "x", "members": members})
    assert not (tmp_path / "team.json").exists()


def test_several_members_without_steamid(tmp_path):
    saved = T.save_team(tmp_path, {"name": "x", "members": [{"nick": "coach"}, {"nick": "analyst"}]})
    assert [m["steamid"] for m in saved["members"]] == ["", ""]


def test_broken_file_reads_as_empty(tmp_path):
    (tmp_path / "team.json").write_text("{not json", encoding="utf-8")
    assert T.load_team(tmp_path) == T.empty_team()


def test_rename_follows_only_an_existing_profile(tmp_path):
    assert T.rename_team(tmp_path, "New") is None
    assert not (tmp_path / "team.json").exists()
    T.save_team(tmp_path, sample())
    assert T.rename_team(tmp_path, "New")["name"] == "New"
    assert T.rename_team(tmp_path, None)["name"] == ""
    assert len(T.load_team(tmp_path)["members"]) == 3


def test_candidates():
    def player(sid, name, team):
        return {"steamid": sid, "name": name, "team": team}

    matches = [  # newest first
        {"teams": ["team_alpha", "Enemy"], "players": [player(1, "alpha", "team_alpha"), player(2, "bravo!", "team_alpha"), player(9, "foe", "Enemy")]},
        {"teams": ["Our Team", "Other"], "players": [player(2, "bravo", "Our Team"), player(3, "charlie", "Our Team"), player(8, "x", "Other")]},
    ]
    found = T.candidates(matches, "Our Team", {"team_alpha": "Our Team"}, [{"steamid": "1"}])
    assert found == [
        {"steamid": "2", "nick": "bravo!", "matches": 2},  # the latest name, both matches counted
        {"steamid": "3", "nick": "charlie", "matches": 1},
    ]
    assert T.candidates(matches, "Nobody", {}, []) == []
