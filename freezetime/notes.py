"""Notes with a timecode: a line about a moment of a match (match, round, second), stored in ``out/notes.json``.

The file::

    {"format": 1, "notes": [
      {"id": "3f9c0a1b2c4d", "match": "...", "round": 7, "sec": 23.5, "text": "too early here",
       "created": 1767225600, "updated": 1767225600}
    ]}

Notes written while the app had a team server may still carry ``author``, ``mentions`` and
``read_by``: they are kept as they are and no longer used. Every change reads, edits and writes the
file under one lock (the app serves requests from several threads).
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
    return {"match": match, "round": rnd, "sec": round(float(sec), 1), "text": text}


def add_note(out: str | Path, note: dict) -> dict:
    data = _check(note)
    now = int(time.time())
    data = {"id": uuid.uuid4().hex[:12], **data, "created": now, "updated": now}
    with _lock:
        notes = load_notes(out)
        if len(notes) >= MAX_NOTES:
            raise NoteError(f"too many notes (max {MAX_NOTES})")
        _save(out, [*notes, data])
    return data


def update_note(out: str | Path, note_id: str, text: str) -> dict | None:
    """New text for a note; None when there is no such note."""
    with _lock:
        notes = load_notes(out)
        note = next((n for n in notes if n["id"] == note_id), None)
        if note is None:
            return None
        changed = _check(note | {"text": text})
        note.update(text=changed["text"], updated=int(time.time()))
        _save(out, notes)
    return note


def delete_note(out: str | Path, note_id: str) -> bool:
    with _lock:
        notes = load_notes(out)
        if not any(n["id"] == note_id for n in notes):
            return False
        _save(out, [n for n in notes if n["id"] != note_id])
    return True


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
