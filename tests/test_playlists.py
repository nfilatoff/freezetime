import pytest

from freezetime import playlists as L


def pl(**over):
    return {"name": "  B   retakes ", "folder": "Mirage", "items": [
        {"match": "m1", "round": 3, "start": 5, "end": 20.04, "caption": "late"},
        {"match": "m2", "round": 9},
    ]} | over


def test_create_and_load(tmp_path):
    made = L.create_playlist(tmp_path, pl(owner="bbbbbbbb"))
    assert L.ID_RE.fullmatch(made["id"]) and made["name"] == "B retakes" and made["folder"] == "Mirage"
    assert "owner" not in made
    first, second = made["items"]
    assert (first["start"], first["end"], first["caption"]) == (5.0, 20.0, "late")
    assert (second["start"], second["end"], second["caption"]) == (None, None, "")
    assert all(L.ITEM_RE.fullmatch(i["id"]) for i in made["items"])
    assert L.get_playlist(tmp_path, made["id"]) == made and L.load_playlists(tmp_path) == [made]


@pytest.mark.parametrize("bad, word", [
    ({"name": " "}, "name"),
    ({"items": [{"match": "../x", "round": 1}]}, "match"),
    ({"items": [{"match": "m", "round": "1"}]}, "round"),
    ({"items": [{"match": "m", "round": 1, "start": 10, "end": 5}]}, "ends after"),
    ({"items": [{"match": "m", "round": 1, "start": 9999}]}, "second"),
    ({"items": [{"match": "m", "round": 1}] * (L.MAX_ITEMS + 1)}, "at most"),
    ({"items": "x"}, "list"),
])
def test_bad_playlists(tmp_path, bad, word):
    with pytest.raises(L.PlaylistError, match=word):
        L.create_playlist(tmp_path, pl(**bad))
    assert not (tmp_path / "playlists.json").exists()


def test_reorder_add_and_delete(tmp_path):
    made = L.create_playlist(tmp_path, pl())
    swapped = made | {"items": made["items"][::-1], "name": "renamed"}
    done = L.update_playlist(tmp_path, made["id"], swapped)
    assert done["name"] == "renamed"
    assert [i["id"] for i in done["items"]] == [i["id"] for i in made["items"][::-1]]  # item ids survive a reorder
    added = L.add_item(tmp_path, made["id"], {"id": done["items"][0]["id"], "match": "m3", "round": 1, "start": 2})
    assert len(added["items"]) == 3 and added["items"][-1]["match"] == "m3"
    assert len({i["id"] for i in added["items"]}) == 3  # a fresh id, not the one sent
    assert L.update_playlist(tmp_path, "0" * 12, pl()) is None
    assert L.add_item(tmp_path, "0" * 12, {"match": "m", "round": 1}) is None
    assert L.delete_playlist(tmp_path, made["id"])
    assert not L.delete_playlist(tmp_path, made["id"])
    assert L.load_playlists(tmp_path) == []


def test_merge(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    made = L.create_playlist(a, pl())
    assert L.merge_playlists(b, L.load_playlists(a)) == {"added": 1, "updated": 0, "skipped": 0}
    assert L.merge_playlists(b, [made | {"name": "newer", "updated": made["updated"] + 1}])["updated"] == 1
    assert L.merge_playlists(b, [made])["skipped"] == 1
    assert L.load_playlists(b)[0]["name"] == "newer"
    with pytest.raises(L.PlaylistError):
        L.merge_playlists(b, [{"name": "x"}])
