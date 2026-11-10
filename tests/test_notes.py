import pytest

from freezetime import notes as N

ROSTER = [
    {"id": "aaaaaaaa", "nick": "alpha"},
    {"id": "bbbbbbbb", "nick": "bravo"},
    {"id": "cccccccc", "nick": "coach"},
    {"id": "dddddddd", "nick": "alpha2"},
]
COACH, BRAVO = ROSTER[2], ROSTER[1]


def note(**over):
    return {"match": "m1", "round": 7, "sec": 23.46, "text": "  @bravo rotate earlier, @ALPHA  "} | over


def test_mentions():
    assert sorted(N.mentions("@bravo and @Alpha", ROSTER)) == ["aaaaaaaa", "bbbbbbbb"]
    assert N.mentions("@alpha2 only", ROSTER) == ["dddddddd"]  # the longer nick wins
    assert N.mentions("@bravo, again @bravo", ROSTER) == ["bbbbbbbb"]  # once
    assert N.mentions("@bravos", ROSTER) == []
    assert N.mentions("no one", ROSTER) == []


def test_add_and_load(tmp_path):
    made = N.add_note(tmp_path, note(), COACH, ROSTER)
    assert N.ID_RE.fullmatch(made["id"])
    assert made["text"] == "@bravo rotate earlier, @ALPHA" and made["sec"] == 23.5
    assert made["author"] == "cccccccc" and made["author_nick"] == "coach"
    assert sorted(made["mentions"]) == ["aaaaaaaa", "bbbbbbbb"]
    assert made["read_by"] == ["cccccccc"]
    assert N.load_notes(tmp_path) == [made]
    # the analyst's computer with nobody chosen
    anon = N.add_note(tmp_path, note(text="plain"), None, ROSTER)
    assert anon["author"] == "" and anon["read_by"] == []


def test_author_cannot_be_forged(tmp_path):
    made = N.add_note(tmp_path, note(author="bbbbbbbb", author_nick="bravo"), COACH, ROSTER)
    assert made["author"] == "cccccccc"


@pytest.mark.parametrize("bad, word", [
    ({"match": "../etc"}, "match"), ({"round": -1}, "round"), ({"round": True}, "round"),
    ({"sec": 9999}, "second"), ({"text": "   "}, "text"),
])
def test_bad_notes(tmp_path, bad, word):
    with pytest.raises(N.NoteError, match=word):
        N.add_note(tmp_path, note(**bad), COACH, ROSTER)


def test_unread_and_read(tmp_path):
    made = N.add_note(tmp_path, note(), COACH, ROSTER)
    notes = N.load_notes(tmp_path)
    assert [n["id"] for n in N.unread_for(notes, "bbbbbbbb")] == [made["id"]]
    assert N.unread_for(notes, "cccccccc") == []  # the author's own note
    assert N.unread_for(notes, None) == []
    assert N.mark_read(tmp_path, [made["id"]], "bbbbbbbb") == 1
    assert N.mark_read(tmp_path, [made["id"]], "bbbbbbbb") == 0
    assert N.mark_read(tmp_path, [made["id"]], "") == 0
    assert N.unread_for(N.load_notes(tmp_path), "bbbbbbbb") == []


def test_only_the_author_or_staff_edit(tmp_path):
    made = N.add_note(tmp_path, note(), COACH, ROSTER)
    N.mark_read(tmp_path, [made["id"]], "bbbbbbbb")
    with pytest.raises(PermissionError):
        N.update_note(tmp_path, made["id"], "mine now", "bbbbbbbb", False, ROSTER)
    with pytest.raises(PermissionError):
        N.delete_note(tmp_path, made["id"], None, False)
    changed = N.update_note(tmp_path, made["id"], "@bravo new text", "cccccccc", False, ROSTER)
    assert changed["text"] == "@bravo new text" and changed["mentions"] == ["bbbbbbbb"]
    assert changed["read_by"] == ["cccccccc"]  # news again for bravo
    assert N.update_note(tmp_path, made["id"], "by staff", "bbbbbbbb", True, ROSTER)["text"] == "by staff"
    assert N.update_note(tmp_path, "0" * 12, "x", "cccccccc", True, ROSTER) is None
    assert N.delete_note(tmp_path, made["id"], "cccccccc", False)
    assert N.load_notes(tmp_path) == []
    assert not N.delete_note(tmp_path, made["id"], "cccccccc", True)


def test_merge(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    made = N.add_note(a, note(), COACH, ROSTER)
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
