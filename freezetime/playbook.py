"""The playbook: strategies, protocols and setups, ordered books and tasks per player slot.

One entry may belong to several books. Attachments are references, never downloaded media.
A task belongs to a slot: a free label such as a nick or a position ("Entry", "B anchor").
All read/modify/write operations share a lock; replacing the file is atomic on Windows too.

Format 1 keyed tasks by roster member ids of the former team profile. It is still read: each
task gets the member's nick from ``out/team.json`` (or a pack's ``team.json``) as its slot, else
an empty slot (the page shows it as "Player N"); the file is written as format 2 on the next change.
"""

from __future__ import annotations

import json
import math
import re
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from freezetime.lineups import MAP_RE, WEAPON_TYPE, lineup_commands, throws
from freezetime.notes import MATCH_RE
from freezetime.playlists import PlaylistError, check_item

FORMAT = 2
FILE = "playbook.json"
MAX_TASKS = 10
SLOT_LEN = 40
MAX_ENTRIES = 1000
MAX_BOOKS = 100
MAX_BYTES = 8 << 20
ID_RE = re.compile(r"^[0-9a-f]{12}$")
_lock = threading.RLock()


class PlaybookError(ValueError):
    """Invalid playbook data; the existing library is left intact."""


def _text(value, limit: int, *, required: bool = False) -> str:
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise PlaybookError(f"expected text of at most {limit} characters")
    return value.strip()


def _id(value, pattern=ID_RE) -> str:
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise PlaybookError("invalid id")
    return value


def _list(value, limit: int) -> list:
    if not isinstance(value, list) or len(value) > limit:
        raise PlaybookError(f"expected a list of at most {limit} items")
    return value


def _number(value, limit: float = 100000) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or abs(value) > limit:
        raise PlaybookError("invalid coordinate or time")
    return float(value)


def _match(value) -> str:
    if not isinstance(value, str) or not MATCH_RE.fullmatch(value) or ".." in value:
        raise PlaybookError("invalid match")
    return value


def _round(item) -> dict:
    try:
        checked = check_item(item)
    except PlaylistError as e:
        raise PlaybookError(str(e)) from e
    return {k: v for k, v in checked.items() if k != "id"}


def check_attachment(a: dict) -> dict:
    if not isinstance(a, dict):
        raise PlaybookError("an attachment is an object")
    kind = a.get("kind")
    label = _text(a.get("label", ""), 200)
    if kind == "board":
        data = {"board": _id(a.get("board"))}
    elif kind == "playlist":
        data = {"playlist": _id(a.get("playlist"))}
    elif kind == "round":
        data = _round(a)
    elif kind == "recording":
        name = a.get("file")
        if not isinstance(name, str) or not re.fullmatch(r"[\w+-][\w .()+-]{0,199}\.mp4", name):
            raise PlaybookError("invalid recording filename")
        data = {"match": _match(a.get("match")), "file": name}
    elif kind == "url":
        url = _text(a.get("url"), 2000, required=True)
        try:
            parsed = urlsplit(url)
            valid = parsed.scheme == "https" and parsed.hostname in {
                "youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com", "twitch.tv", "www.twitch.tv", "clips.twitch.tv",
            } and not parsed.username and not parsed.password and parsed.port in (None, 443)
        except ValueError:
            valid = False
        if not valid:
            raise PlaybookError("use an HTTPS YouTube or Twitch URL")
        data = {"url": url}
    else:
        raise PlaybookError("unknown attachment kind")
    return {"kind": kind, "label": label, **data}


def _utility(u: dict) -> dict:
    if not isinstance(u, dict) or not isinstance(u.get("weapon"), str) or u["weapon"] not in WEAPON_TYPE:
        raise PlaybookError("invalid utility")
    data = {k: _number(u.get(k)) for k in ("x", "y", "z", "pitch", "yaw")}
    data |= {"weapon": u["weapon"], "type": WEAPON_TYPE[u["weapon"]], "label": _text(u.get("label", ""), 200)}
    source = u.get("source")
    if not isinstance(source, dict):
        raise PlaybookError("utility needs its source round and player")
    data["source"] = _round(source) | {"steamid": _text(source.get("steamid"), 20, required=True)}
    data["commands"] = "; ".join(lineup_commands(data)[:2])
    return data


def check_entry(entry: dict) -> dict:
    if not isinstance(entry, dict):
        raise PlaybookError("an entry is an object")
    kind = entry.get("kind", "strategy")
    if kind not in ("strategy", "protocol", "setup"):
        raise PlaybookError("unknown entry kind")
    map_name, side = entry.get("map", ""), entry.get("side", "")
    if not isinstance(map_name, str) or (map_name and not MAP_RE.fullmatch(map_name)):
        raise PlaybookError("invalid map")
    if side not in ("", "terrorist", "counter-terrorist"):
        raise PlaybookError("invalid side")
    checked_tasks = []
    for task in _list(entry.get("tasks", []), MAX_TASKS):
        if not isinstance(task, dict):
            raise PlaybookError("a task is an object")
        checked_tasks.append({
            "slot": " ".join(_text(task.get("slot", ""), SLOT_LEN * 4).split())[:SLOT_LEN],
            "text": _text(task.get("text", ""), 4000),
            "utility": [_utility(u) for u in _list(task.get("utility", []), 100)],
        })
    detector = entry.get("detector")
    if detector is not None:
        if not isinstance(detector, dict) or detector.get("site") not in ("A", "B") or not map_name or side == "counter-terrorist":
            raise PlaybookError("a detector needs a map, T side and site A or B")
        core = []
        for c in _list(detector.get("core", []), 100):
            if not isinstance(c, dict) or c.get("type") not in ("smoke", "molotov"):
                raise PlaybookError("invalid detector utility")
            core.append({"type": c["type"], "zone": _text(c.get("zone"), 100, required=True)})
        detector = {"site": detector["site"], "core": core}
    pinned = entry.get("pinned", False)
    if not isinstance(pinned, bool):
        raise PlaybookError("pinned is a boolean")
    return {
        "name": _text(entry.get("name"), 120, required=True), "kind": kind, "map": map_name, "side": side,
        "description": _text(entry.get("description", ""), 12000), "category": _text(entry.get("category", ""), 80),
        "pinned": pinned, "steps": [_text(s, 2000, required=True) for s in _list(entry.get("steps", []), 50)],
        "tasks": checked_tasks, "attachments": [check_attachment(a) for a in _list(entry.get("attachments", []), 100)],
        "detector": detector,
    }


def _book(book: dict) -> dict:
    if not isinstance(book, dict):
        raise PlaybookError("a book is an object")
    ids = [_id(i) for i in _list(book.get("entries", []), MAX_ENTRIES)]
    if len(set(ids)) != len(ids):
        raise PlaybookError("duplicate entries in a book")
    return {"name": _text(book.get("name"), 120, required=True), "entries": ids}


def _stamp(value) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise PlaybookError("invalid timestamp")
    return int(value)


def roster_nicks(team) -> dict[str, str]:
    """Member id -> nick from a former team profile (``team.json``); anything unreadable gives none."""
    members = team.get("members") if isinstance(team, dict) else None
    if not isinstance(members, list):
        return {}
    return {m["id"]: " ".join(m["nick"].split())[:SLOT_LEN] for m in members
            if isinstance(m, dict) and isinstance(m.get("id"), str) and isinstance(m.get("nick"), str) and m["nick"].strip()}


def _local_nicks(out: str | Path) -> dict[str, str]:
    try:
        return roster_nicks(json.loads((Path(out) / "team.json").read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return {}


def upgrade(data, nicks: dict[str, str] | None = None):
    """Format 1 (tasks keyed by roster member id) as format 2 (tasks per slot); other data as it is."""
    if not isinstance(data, dict) or data.get("format") != 1:
        return data
    entries = []
    for entry in data.get("entries", []) if isinstance(data.get("entries"), list) else []:
        tasks = entry.get("tasks") if isinstance(entry, dict) else None
        if isinstance(tasks, dict):
            if len(tasks) > MAX_TASKS:
                raise PlaybookError(f"an entry has at most {MAX_TASKS} tasks")
            entry = entry | {"tasks": [(task if isinstance(task, dict) else {}) | {"slot": (nicks or {}).get(member, "")}
                                       for member, task in tasks.items()]}
        entries.append(entry)
    return data | {"format": FORMAT, "entries": entries}


def check_playbook(data, nicks: dict[str, str] | None = None) -> dict:
    data = upgrade(data, nicks)
    if not isinstance(data, dict) or data.get("format") != FORMAT:
        raise PlaybookError("unsupported playbook format")
    result = {"format": FORMAT}
    for key, limit, check in (("entries", MAX_ENTRIES, check_entry), ("books", MAX_BOOKS, _book)):
        found, seen = [], set()
        for value in _list(data.get(key, []), limit):
            if not isinstance(value, dict):
                raise PlaybookError("an entry or book is an object")
            ident = _id(value.get("id"))
            if ident in seen:
                raise PlaybookError("duplicate id")
            seen.add(ident)
            found.append({"id": ident, **check(value), "created": _stamp(value.get("created", 0)), "updated": _stamp(value.get("updated", 0))})
        result[key] = found
    ids = {e["id"] for e in result["entries"]}
    if any(set(b["entries"]) - ids for b in result["books"]):
        raise PlaybookError("a book references a missing entry")
    return result


def load_playbook(out: str | Path) -> dict:
    path = Path(out) / FILE
    if not path.exists():
        return {"format": FORMAT, "entries": [], "books": []}
    try:
        if path.stat().st_size > MAX_BYTES:
            raise PlaybookError("playbook is too big")
        return check_playbook(json.loads(path.read_text(encoding="utf-8")), _local_nicks(out))
    except (OSError, ValueError) as e:
        raise PlaybookError(f"cannot read playbook: {e}") from e


def _save(out: str | Path, data: dict) -> None:
    text = json.dumps(check_playbook(data), ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise PlaybookError("playbook is too big")
    path = Path(out) / FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(text, encoding="utf-8")
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)


def save_item(out: str | Path, collection: str, item: dict, item_id: str | None = None) -> dict | None:
    """Create or replace an entry/book."""
    if collection not in ("entries", "books"):
        raise PlaybookError("unknown collection")
    checked = check_entry(item) if collection == "entries" else _book(item)
    with _lock:
        data = load_playbook(out)
        old = next((e for e in data[collection] if e["id"] == item_id), None)
        if item_id is not None and old is None:
            return None
        now = max(int(time.time()), old["updated"] + 1 if old else 0)
        saved = {"id": item_id or uuid.uuid4().hex[:12], **checked, "created": old["created"] if old else now, "updated": now}
        data[collection] = [saved if e["id"] == item_id else e for e in data[collection]] if old else [*data[collection], saved]
        _save(out, data)
        return saved


def delete_item(out: str | Path, collection: str, item_id: str) -> bool:
    if collection not in ("entries", "books"):
        raise PlaybookError("unknown collection")
    with _lock:
        data = load_playbook(out)
        if not any(e["id"] == item_id for e in data[collection]):
            return False
        data[collection] = [e for e in data[collection] if e["id"] != item_id]
        if collection == "entries":
            for book in data["books"]:
                if item_id in book["entries"]:
                    book["entries"].remove(item_id)
                    book["updated"] = max(int(time.time()), book["updated"] + 1)
        _save(out, data)
    return True


def merge_playbook(out: str | Path, incoming, nicks: dict[str, str] | None = None) -> dict:
    """Validate the whole incoming file before merging newer entries and books by stable id.

    ``nicks`` names the slots of format 1 tasks (the roster of the computer the pack came from)."""
    checked = check_playbook(incoming, nicks)
    counts = {"added": 0, "updated": 0, "skipped": 0}
    with _lock:
        data = load_playbook(out)
        for key in ("entries", "books"):
            by_id = {e["id"]: i for i, e in enumerate(data[key])}
            for value in checked[key]:
                i = by_id.get(value["id"])
                if i is None:
                    by_id[value["id"]] = len(data[key])
                    data[key].append(value)
                    counts["added"] += 1
                elif data[key][i]["updated"] < value["updated"]:
                    data[key][i] = value
                    counts["updated"] += 1
                else:
                    counts["skipped"] += 1
        _save(out, data)
    return counts


def copy_utility(directory: str | Path, match_id: str, rnd: int, steamid: str, start=None, end=None) -> list[dict]:
    """Copy a demo player's real throws, including ground position and view angles, into a task."""
    source = _round({"match": match_id, "round": rnd, "start": start, "end": end})
    found = throws(directory)
    found = found.filter((found["round_num"] == rnd) & (found["steamid"].cast(str) == steamid))
    if start is not None:
        found = found.filter(found["sec"] >= start)
    if end is not None:
        found = found.filter(found["sec"] <= end)
    return [_utility(r | {"label": f"{r['type']} {r.get('land_zone') or ''}".strip(),
                          "source": source | {"steamid": steamid, "start": r["sec"], "end": None}}) for r in found.to_dicts()]
