"""Notes with a timecode: a line about a moment of a match (match, round, second), stored in ``out/notes.json``.

A note is signed by the roster member who wrote it (``author`` is their member id; "" for the
analyst's computer when nobody is chosen there) and may mention teammates as ``@nick``. A mention
puts the note into that member's "For me" list until they have read it. The file::

    {"format": 1, "notes": [
      {"id": "3f9c0a1b2c4d", "match": "...", "round": 7, "sec": 23.5, "text": "@bravo too early here",
       "author": "a1b2c3d4", "author_nick": "coach", "mentions": ["e5f6a7b8"], "read_by": ["a1b2c3d4"],
       "created": 1767225600, "updated": 1767225600}
    ]}

Several teammates write at once on the team server, so every change reads, edits and writes the
file under one lock.
"""

from __future__ import annotations

import json
import re
import threading
import time
import uuid
from pathlib import Path

FORMAT = 1
FILE = "notes.json"
MAX_NOTES = 20000
TEXT_LEN = 2000
MATCH_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ +()-]{0,150}$")
ID_RE = re.compile(r"^[0-9a-f]{12}$")
MEMBER_RE = re.compile(r"^[0-9a-f]{8}$")
_lock = threading.Lock()


class NoteError(ValueError):
    """A note that cannot be saved: the message says why."""


def notes_path(out: str | Path) -> Path:
    return Path(out) / FILE


def load_notes(out: str | Path) -> list[dict]:
    """Every note, oldest first; a broken file reads as no notes rather than breaking the app."""
    path = notes_path(out)
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        notes = data.get("notes", []) if isinstance(data, dict) else []
        return [n for n in notes if isinstance(n, dict) and ID_RE.fullmatch(str(n.get("id", "")))]
    except (ValueError, OSError):
        return []


def _save(out: str | Path, notes: list[dict]) -> None:
    path = notes_path(out)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"format": FORMAT, "notes": notes}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def mentions(text: str, members: list[dict]) -> list[str]:
    """Ids of the roster members named as ``@nick`` (any case; a longer nick wins over its prefix)."""
    found: list[str] = []
    taken: list[tuple[int, int]] = []
    for m in sorted(members, key=lambda m: -len(m["nick"])):
        for hit in re.finditer("@" + re.escape(m["nick"]) + r"(?![\w-])", text, re.IGNORECASE):
            span = hit.span()
            if any(a < span[1] and span[0] < b for a, b in taken):
                continue
            taken.append(span)
            if m["id"] not in found:
                found.append(m["id"])
    return found


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _check(note: dict) -> dict:
    """The stored fields of a note, checked."""
    if not isinstance(note, dict):
        raise NoteError("a note is an object")
    match = str(note.get("match") or "")
    if not MATCH_RE.fullmatch(match) or ".." in match:
        raise NoteError(f"bad match {match!r}")
    rnd, sec = note.get("round"), note.get("sec", 0)
    if not isinstance(rnd, int) or isinstance(rnd, bool) or not 0 <= rnd <= 200:
        raise NoteError("bad round")
    if not _num(sec) or not -60 <= sec <= 600:
        raise NoteError("bad second")
    text = str(note.get("text") or "").strip()[:TEXT_LEN]
    if not text:
        raise NoteError("a note needs some text")
    ids = lambda v: [x for x in v if isinstance(x, str) and MEMBER_RE.fullmatch(x)][:50] if isinstance(v, list) else []  # noqa: E731
    author = str(note.get("author") or "")
    return {
        "match": match, "round": rnd, "sec": round(float(sec), 1), "text": text,
        "author": author if MEMBER_RE.fullmatch(author) else "",
        "author_nick": " ".join(str(note.get("author_nick") or "").split())[:32],
        "mentions": ids(note.get("mentions")), "read_by": ids(note.get("read_by")),
    }


def add_note(out: str | Path, note: dict, author: dict | None, members: list[dict]) -> dict:
    """A new note by ``author`` (a roster member, or None for the analyst's computer)."""
    data = _check(note | {"author": author["id"] if author else "", "author_nick": author["nick"] if author else ""})
    data["mentions"] = mentions(data["text"], members)
    data["read_by"] = [data["author"]] if data["author"] else []
    now = int(time.time())
    data = {"id": uuid.uuid4().hex[:12], **data, "created": now, "updated": now}
    with _lock:
        notes = load_notes(out)
        if len(notes) >= MAX_NOTES:
            raise NoteError(f"too many notes (max {MAX_NOTES})")
        _save(out, [*notes, data])
    return data


def _owned(note: dict, who_id: str | None, can_edit: bool) -> bool:
    return can_edit or (bool(who_id) and note["author"] == who_id)


def update_note(out: str | Path, note_id: str, text: str, who_id: str | None, can_edit: bool, members: list[dict]) -> dict | None:
    """New text for a note: its author or staff only. None when there is no such note."""
    with _lock:
        notes = load_notes(out)
        note = next((n for n in notes if n["id"] == note_id), None)
        if note is None:
            return None
        if not _owned(note, who_id, can_edit):
            raise PermissionError("access_owner")
        changed = _check(note | {"text": text})
        note.update(text=changed["text"], mentions=mentions(changed["text"], members), updated=int(time.time()))
        # a changed note is news again for those it mentions
        note["read_by"] = [note["author"]] if note["author"] else []
        _save(out, notes)
    return note


def delete_note(out: str | Path, note_id: str, who_id: str | None, can_edit: bool) -> bool:
    with _lock:
        notes = load_notes(out)
        note = next((n for n in notes if n["id"] == note_id), None)
        if note is None:
            return False
        if not _owned(note, who_id, can_edit):
            raise PermissionError("access_owner")
        _save(out, [n for n in notes if n["id"] != note_id])
    return True


def mark_read(out: str | Path, note_ids: list[str], member_id: str) -> int:
    """Mark notes read by a member; returns how many changed."""
    if not MEMBER_RE.fullmatch(member_id or ""):
        return 0
    wanted, changed = set(note_ids), 0
    with _lock:
        notes = load_notes(out)
        for n in notes:
            if n["id"] in wanted and member_id not in n.get("read_by", []):
                n["read_by"] = [*n.get("read_by", []), member_id]
                changed += 1
        if changed:
            _save(out, notes)
    return changed


def unread_for(notes: list[dict], member_id: str | None) -> list[dict]:
    """Notes that mention a member and that they have not read."""
    if not member_id:
        return []
    return [n for n in notes if member_id in n.get("mentions", []) and member_id not in n.get("read_by", [])]


def merge_notes(out: str | Path, incoming) -> dict:
    """Notes from a pack: a note replaces ours of the same id only when it is newer."""
    if not isinstance(incoming, list):
        raise NoteError("notes is a list")
    counts = {"added": 0, "updated": 0, "skipped": 0}
    stamp = lambda v: int(v) if _num(v) and v > 0 else 0  # noqa: E731
    with _lock:
        notes = load_notes(out)
        by_id = {n["id"]: i for i, n in enumerate(notes)}
        for n in incoming:
            note_id = str(n.get("id", "")) if isinstance(n, dict) else ""
            if not ID_RE.fullmatch(note_id):
                raise NoteError("a note without an id")
            data = {"id": note_id, **_check(n), "created": stamp(n.get("created")), "updated": stamp(n.get("updated"))}
            if note_id not in by_id:
                by_id[note_id] = len(notes)
                notes.append(data)
                counts["added"] += 1
            elif stamp(notes[by_id[note_id]].get("updated")) < data["updated"]:
                notes[by_id[note_id]] = data
                counts["updated"] += 1
            else:
                counts["skipped"] += 1
        if len(notes) > MAX_NOTES:
            raise NoteError(f"too many notes (max {MAX_NOTES})")
        if counts["added"] or counts["updated"]:
            _save(out, notes)
    return counts
