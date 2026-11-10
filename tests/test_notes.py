import json

import pytest

from freezetime import notes as N


def note(**over):
    return {"match": "m1", "round": 7, "sec": 23.46, "text": "  rotate earlier  "} | over


def test_add_and_load(tmp_path):
    made = N.add_note(tmp_path, note(author="bbbbbbbb", mentions=["bbbbbbbb"]))
    assert N.ID_RE.fullmatch(made["id"])
    assert made["text"] == "rotate earlier" and made["sec"] == 23.5
    assert set(made) == {"id", "match", "round", "sec", "text", "created", "updated"}  # no author or mentions any more
    assert N.load_notes(tmp_path) == [made]


@pytest.mark.parametrize("bad, word", [
    ({"match": "../etc"}, "match"), ({"round": -1}, "round"), ({"round": True}, "round"),
    ({"sec": 9999}, "second"), ({"text": "   "}, "text"),
])
def test_bad_notes(tmp_path, bad, word):
    with pytest.raises(N.NoteError, match=word):
        N.add_note(tmp_path, note(**bad))


def test_edit_and_delete(tmp_path):
    made = N.add_note(tmp_path, note())
    changed = N.update_note(tmp_path, made["id"], " new text ")
    assert changed["text"] == "new text" and changed["updated"] >= made["updated"]
    assert N.update_note(tmp_path, "0" * 12, "x") is None
    assert N.delete_note(tmp_path, made["id"])
    assert N.load_notes(tmp_path) == []
    assert not N.delete_note(tmp_path, made["id"])


def test_notes_from_the_team_server_keep_their_old_fields(tmp_path):
    old = {"id": "3f9c0a1b2c4d", "match": "m1", "round": 7, "sec": 1.0, "text": "@bravo look", "author": "a1b2c3d4",
           "author_nick": "coach", "mentions": ["e5f6a7b8"], "read_by": [], "created": 1, "updated": 1}
    (tmp_path / "notes.json").write_text(json.dumps({"format": 1, "notes": [old]}), encoding="utf-8")
    changed = N.update_note(tmp_path, old["id"], "look")
    assert changed == old | {"text": "look", "updated": changed["updated"]}
    assert N.load_notes(tmp_path) == [changed]


def test_merge(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    made = N.add_note(a, note())
    assert N.merge_notes(b, N.load_notes(a)) == {"added": 1, "updated": 0, "skipped": 0}
    assert N.merge_notes(b, N.load_notes(a)) == {"added": 0, "updated": 0, "skipped": 1}
    newer = made | {"text": "edited", "updated": made["updated"] + 5}
    assert N.merge_notes(b, [newer]) == {"added": 0, "updated": 1, "skipped": 0}
    assert N.load_notes(b)[0]["text"] == "edited"
    with pytest.raises(N.NoteError):
        N.merge_notes(b, [{"id": "nope"}])
    with pytest.raises(N.NoteError):
        N.merge_notes(b, "nope")


def test_broken_file(tmp_path):
    (tmp_path / "notes.json").write_text("{oops", encoding="utf-8")
    assert N.load_notes(tmp_path) == []
