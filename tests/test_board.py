import json

import pytest

from freezetime import board as B


def sample(**over) -> dict:
    b = {
        "format": 1,
        "name": "  B   split ",
        "map": "de_mirage",
        "author": "coach",
        "steps": ["", "", "Go B", ""],
        "tokens": [
            {"id": "p1", "type": "player", "side": "t", "label": "alpha", "pos": [{"x": 100, "y": 200, "l": 0}, None, {"x": 300, "y": 220, "l": 0}, None],
             "route": [[], [], [{"x": 150, "y": 205, "l": 0}, {"x": 250, "y": 210, "l": 0}], []]},
            {"id": "c4", "type": "bomb", "pos": [{"x": 105, "y": 205, "l": 0}, None, None, None], "route": []},
        ],
        "marks": [
            {"id": "m1", "type": "nade", "kind": "smoke", "step": 1, "l": 0, "pts": [[400, 300], [120, 210]]},
            {"id": "m2", "type": "pen", "step": 2, "l": 0, "color": "#ff0000", "width": 3, "pts": [[1, 2], [3, 4], [5, 6]]},
            {"id": "m3", "type": "text", "step": 0, "l": 0, "text": "wait for flash", "pts": [[500, 500]]},
        ],
        "source": {"match": "some-match", "round": 7, "sec": 23.5},
    }
    return b | over


def test_create_load_list_update_delete(tmp_path):
    made = B.create_board(tmp_path, sample())
    assert B.ID_RE.fullmatch(made["id"])
    assert made["name"] == "B split"  # whitespace collapsed
    assert made["created"] == made["updated"]
    assert (tmp_path / "boards" / f"{made['id']}.json").exists()

    loaded = B.load_board(tmp_path, made["id"])
    assert loaded == made
    assert loaded["source"] == {"match": "some-match", "round": 7, "sec": 23.5}

    other = B.create_board(tmp_path, sample(map="de_nuke", name="nuke"))
    assert [b["id"] for b in B.list_boards(tmp_path, "de_mirage")] == [made["id"]]
    assert {b["id"] for b in B.list_boards(tmp_path)} == {made["id"], other["id"]}
    s = B.list_boards(tmp_path, "de_nuke")[0]
    assert s["steps"] == 4 and s["players"] == 1 and s["name"] == "nuke"

    upd = B.update_board(tmp_path, made["id"], sample(name="B split v2", id="ffffffffffff", created=1))
    assert upd["id"] == made["id"] and upd["created"] == made["created"] and upd["name"] == "B split v2"
    assert B.update_board(tmp_path, "0" * 12, sample()) is None

    assert B.delete_board(tmp_path, made["id"])
    assert not B.delete_board(tmp_path, made["id"])
    assert B.load_board(tmp_path, made["id"]) is None


def test_list_skips_broken_and_foreign_files(tmp_path):
    B.create_board(tmp_path, sample())
    (tmp_path / "boards" / "abcdefabcdef.json").write_text("{not json", encoding="utf-8")
    (tmp_path / "boards" / "notes.json").write_text(json.dumps(sample()), encoding="utf-8")
    assert len(B.list_boards(tmp_path)) == 1
    assert B.list_boards(tmp_path / "nowhere") == []


@pytest.mark.parametrize("bad_id", ["../etc", "ABCDEFABCDEF", "abc", ""])
def test_bad_ids_are_refused(tmp_path, bad_id):
    with pytest.raises(B.BoardError):
        B.load_board(tmp_path, bad_id)
    with pytest.raises(B.BoardError):
        B.delete_board(tmp_path, bad_id)


@pytest.mark.parametrize(
    "over",
    [
        {"format": 2},
        {"map": "../de_mirage"},
        {"steps": []},
        {"steps": ["", "", "", "", ""]},
        {"tokens": [{"id": "p", "type": "player", "side": "x", "pos": [{"x": 1, "y": 1}, None, None, None]}]},
        {"tokens": [{"id": "p", "type": "player", "side": "t", "pos": [None, None, None, None]}]},
        {"tokens": [{"id": "p", "type": "player", "side": "t", "pos": [{"x": 1, "y": 1}]}]},  # not one per step
        {"tokens": [{"id": "p", "type": "ghost", "pos": [{"x": 1, "y": 1}, None, None, None]}]},
        {"marks": [{"id": "m", "type": "nade", "kind": "flare", "step": 0, "pts": [[1, 1]]}]},
        {"marks": [{"id": "m", "type": "pen", "step": 4, "pts": [[1, 1]]}]},
        {"marks": [{"id": "m", "type": "pen", "step": 0, "pts": []}]},
        {"marks": [{"id": "m", "type": "pen", "step": 0, "pts": [[1, "x"]]}]},
        {"marks": [{"id": "m", "type": "pen", "step": 0, "pts": [[1, 1e9]]}]},
    ],
)
def test_bad_boards_are_refused(tmp_path, over):
    with pytest.raises(B.BoardError):
        B.create_board(tmp_path, sample(**over))
    assert B.list_boards(tmp_path) == []


def test_limits(tmp_path):
    many = [{"id": f"m{i}", "type": "pen", "step": 0, "pts": [[1, 1]]} for i in range(B.MAX_ITEMS + 1)]
    with pytest.raises(B.BoardError, match="too many elements"):
        B.create_board(tmp_path, sample(marks=many))
    long_stroke = [{"id": "m", "type": "pen", "step": 0, "pts": [[1, 1]] * (B.MAX_POINTS + 1)}]
    with pytest.raises(B.BoardError, match="too many points"):
        B.create_board(tmp_path, sample(marks=long_stroke))
    made = B.create_board(tmp_path, sample(name="x" * 500, marks=[{"id": "t", "type": "text", "step": 0, "pts": [[1, 1]], "text": "y" * 500}]))
    assert len(made["name"]) == 80 and len(made["marks"][0]["text"]) == 200


def test_source_is_optional_and_checked(tmp_path):
    assert "source" not in B.create_board(tmp_path, sample(source=None))
    assert "source" not in B.create_board(tmp_path, sample(source={"match": "m", "round": "7"}))
