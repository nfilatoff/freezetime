import json
from concurrent.futures import ThreadPoolExecutor

import pytest

from freezetime import playbook as P
from freezetime.lineups import throws


def sample(**over):
    return {"name": "B split", "map": "de_dust2", "side": "terrorist", "steps": ["Take mid", "Split B"],
            "tasks": [{"slot": "bravo", "text": "Smoke doors", "utility": []}],
            "attachments": [{"kind": "round", "match": "dust2_mini", "round": 3, "start": 5, "end": 20}],
            "detector": {"site": "B", "core": [{"type": "smoke", "zone": "B Doors"}]}} | over


def test_shared_entries_order_and_delete(tmp_path):
    first = P.save_item(tmp_path, "entries", sample())
    second = P.save_item(tmp_path, "entries", sample(name="Retake", kind="setup", detector=None))
    a = P.save_item(tmp_path, "books", {"name": "Dust2", "entries": [first["id"], second["id"]]})
    b = P.save_item(tmp_path, "books", {"name": "Tournament", "entries": [first["id"]]})
    changed = P.save_item(tmp_path, "entries", sample(name="B split v2", pinned=True), first["id"])
    assert changed["created"] == first["created"] and changed["updated"] > first["updated"]
    assert changed["pinned"] and P.load_playbook(tmp_path)["entries"][0] == changed
    reordered = P.save_item(tmp_path, "books", a | {"entries": a["entries"][::-1]}, a["id"])
    assert reordered["entries"] == [second["id"], first["id"]]
    assert P.delete_item(tmp_path, "entries", first["id"])
    assert [book["entries"] for book in P.load_playbook(tmp_path)["books"]] == [[second["id"]], []]
    assert P.delete_item(tmp_path, "books", b["id"])
    assert len(P.load_playbook(tmp_path)["entries"]) == 1
    assert not P.delete_item(tmp_path, "entries", first["id"])
    assert P.save_item(tmp_path, "entries", sample(), first["id"]) is None


@pytest.mark.parametrize("over", [
    {"name": " "}, {"kind": "other"}, {"map": "../map"}, {"side": "ct"}, {"pinned": "yes"},
    {"steps": ["x"] * 51}, {"tasks": {"aabbccdd": {}}}, {"tasks": ["bad"]}, {"tasks": [{"slot": 5}]},
    {"tasks": [{"slot": "x"}] * 11},
    {"attachments": [{"kind": "round", "match": "../out", "round": 2}]},
    {"attachments": [{"kind": "round", "match": "x", "round": True}]},
    {"attachments": [{"kind": "round", "match": "x", "round": 1, "start": float("nan")}]},
    {"attachments": [{"kind": "recording", "match": "x", "file": "../x.mp4"}]},
    {"attachments": [{"kind": "board", "board": "../bad"}]},
    {"attachments": [{"kind": "url", "url": "javascript:alert(1)"}]},
    {"attachments": [{"kind": "url", "url": "https://youtube.com.evil.test/x"}]},
    {"attachments": [{"kind": "url", "url": "https://user@youtube.com/x"}]},
    {"attachments": [{"kind": "url", "url": "https://youtube.com:bad/x"}]},
    {"detector": {"site": "C"}}, {"detector": {"site": "A", "core": [{"type": "flash", "zone": "x"}]}},
])
def test_invalid_entry_preserves_file(tmp_path, over):
    P.save_item(tmp_path, "entries", sample())
    before = (tmp_path / P.FILE).read_bytes()
    with pytest.raises(P.PlaybookError):
        P.save_item(tmp_path, "entries", sample(**over))
    assert (tmp_path / P.FILE).read_bytes() == before


def test_references_and_supported_attachments(tmp_path):
    e = P.save_item(tmp_path, "entries", sample(attachments=[
        {"kind": "board", "board": "0" * 12}, {"kind": "playlist", "playlist": "1" * 12},
        {"kind": "recording", "match": "dust2_mini", "file": "round_3.mp4"},
        {"kind": "recording", "match": "dust2_mini", "file": "R3_Выход+на_B..mp4"},
        {"kind": "url", "url": "https://youtu.be/example"}, {"kind": "url", "url": "https://clips.twitch.tv/example"},
    ]))
    assert len(P.load_playbook(tmp_path)["entries"][0]["attachments"]) == 6
    with pytest.raises(P.PlaybookError, match="missing entry"):
        P.save_item(tmp_path, "books", {"name": "Bad", "entries": ["f" * 12]})
    with pytest.raises(P.PlaybookError, match="duplicate"):
        P.save_item(tmp_path, "books", {"name": "Bad", "entries": [e["id"], e["id"]]})


def test_merge_validates_before_writing_and_keeps_newer(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    e = P.save_item(a, "entries", sample())
    book = P.save_item(a, "books", {"name": "A", "entries": [e["id"]]})
    incoming = P.load_playbook(a)
    assert P.merge_playbook(b, incoming) == {"added": 2, "updated": 0, "skipped": 0}
    assert P.merge_playbook(b, incoming)["skipped"] == 2
    P.save_item(a, "entries", sample(name="Changed"), e["id"])
    assert P.merge_playbook(b, P.load_playbook(a))["updated"] == 1
    before = (b / P.FILE).read_bytes()
    broken = P.load_playbook(a)
    broken["books"].append(book | {"id": "f" * 12, "entries": ["e" * 12]})
    with pytest.raises(P.PlaybookError):
        P.merge_playbook(b, broken)
    assert (b / P.FILE).read_bytes() == before


def test_broken_or_future_file_is_never_silently_overwritten(tmp_path):
    path = tmp_path / P.FILE
    for text in ("{", json.dumps({"format": 99, "entries": []})):
        path.write_text(text)
        with pytest.raises(P.PlaybookError):
            P.save_item(tmp_path, "entries", sample())
        assert path.read_text() == text


def test_concurrent_creates_do_not_lose_entries(tmp_path):
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda i: P.save_item(tmp_path, "entries", sample(name=str(i))), range(12)))
    assert {e["name"] for e in P.load_playbook(tmp_path)["entries"]} == {str(i) for i in range(12)}


def test_utility_copies_exact_throw_and_commands(dust2_mini, tmp_path):
    actual = throws(dust2_mini).row(0, named=True)
    copied = P.copy_utility(dust2_mini, "dust2_mini", actual["round_num"], str(actual["steamid"]), actual["sec"] - .1, actual["sec"] + .1)
    assert copied
    u = copied[0]
    assert [u[k] for k in ("x", "y", "z", "pitch", "yaw")] == [actual[k] for k in ("x", "y", "z", "pitch", "yaw")]
    assert u["commands"].startswith("setpos ") and "; setang " in u["commands"]
    assert u["source"]["steamid"] == str(actual["steamid"])
    saved = P.save_item(tmp_path, "entries", sample(tasks=[{"slot": "bravo", "text": "Throw", "utility": copied}]))
    assert saved["tasks"][0]["utility"] == copied
    with pytest.raises(P.PlaybookError):
        P.save_item(tmp_path, "entries", sample(tasks=[{"utility": [u | {"x": float("inf")}]}]))
    with pytest.raises(P.PlaybookError):
        P.save_item(tmp_path, "entries", sample(tasks=[{"utility": [u | {"weapon": []}]}]))


def format1(**tasks):
    return {"format": 1, "books": [], "entries": [
        {"id": "a" * 12, "name": "B split", "tasks": tasks, "created": 1, "updated": 1}]}


def test_format1_tasks_get_slots_from_the_old_roster(tmp_path):
    (tmp_path / P.FILE).write_text(json.dumps(format1(aabbccdd={"text": "Smoke doors"}, eeff0011={"text": "Flash"})), encoding="utf-8")
    (tmp_path / "team.json").write_text(json.dumps({"members": [{"id": "aabbccdd", "nick": "bravo"}]}), encoding="utf-8")
    entry = P.load_playbook(tmp_path)["entries"][0]
    assert entry["tasks"] == [{"slot": "bravo", "text": "Smoke doors", "utility": []}, {"slot": "", "text": "Flash", "utility": []}]
    before = (tmp_path / P.FILE).read_text(encoding="utf-8")
    assert json.loads(before)["format"] == 1  # reading changes nothing on disk
    P.save_item(tmp_path, "books", {"name": "Dust2", "entries": [entry["id"]]})
    assert json.loads((tmp_path / P.FILE).read_text(encoding="utf-8"))["format"] == P.FORMAT
    assert (tmp_path / "team.json").exists()  # the old profile is never deleted


def test_format1_from_a_pack_uses_its_nicks(tmp_path):
    counts = P.merge_playbook(tmp_path, format1(aabbccdd={"text": "Smoke"}), {"aabbccdd": "bravo"})
    assert counts["added"] == 1 and P.load_playbook(tmp_path)["entries"][0]["tasks"][0]["slot"] == "bravo"
    with pytest.raises(P.PlaybookError):
        P.merge_playbook(tmp_path, format1(**{f"{i:08x}": {} for i in range(P.MAX_TASKS + 1)}))
    assert P.roster_nicks({"members": [{"id": "x", "nick": "  a  b "}, {"id": "y", "nick": " "}, "bad"]}) == {"x": "a b"}
    assert P.roster_nicks("nope") == {}
