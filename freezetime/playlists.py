"""Playlists: rounds (or a stretch of a round) to watch in a row, stored in ``out/playlists.json``.

A playlist belongs to the member who made it; staff may change anybody's. Items may come from
different matches. The file::

    {"format": 1, "playlists": [
      {"id": "3f9c0a1b2c4d", "name": "B retakes", "folder": "Mirage", "owner": "a1b2c3d4", "owner_nick": "coach",
       "items": [{"id": "0a1b2c3d", "match": "...", "round": 7, "start": 12.0, "end": 31.5, "caption": "late rotate"}],
       "created": 1767225600, "updated": 1767225600}
    ]}

``start`` / ``end`` are seconds after the freeze end; None means from the freeze end / to the end
of the round.
"""

from __future__ import annotations

import json
import re
import threading
import time
import uuid
from pathlib import Path

from freezetime.notes import MATCH_RE, MEMBER_RE

FORMAT = 1
FILE = "playlists.json"
MAX_PLAYLISTS = 500
MAX_ITEMS = 500
ID_RE = re.compile(r"^[0-9a-f]{12}$")
ITEM_RE = re.compile(r"^[0-9a-f]{8}$")
_lock = threading.Lock()


class PlaylistError(ValueError):
    """A playlist that cannot be saved: the message says why."""


def playlists_path(out: str | Path) -> Path:
    return Path(out) / FILE


def load_playlists(out: str | Path) -> list[dict]:
    path = playlists_path(out)
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        found = data.get("playlists", []) if isinstance(data, dict) else []
        return [p for p in found if isinstance(p, dict) and ID_RE.fullmatch(str(p.get("id", "")))]
    except (ValueError, OSError):
        return []


def _save(out: str | Path, playlists: list[dict]) -> None:
    path = playlists_path(out)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"format": FORMAT, "playlists": playlists}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def _text(v, limit: int) -> str:
    return " ".join(str(v or "").split())[:limit]


def _sec(v) -> float | None:
    if v is None or v == "":
        return None
    if not isinstance(v, (int, float)) or isinstance(v, bool) or not -60 <= v <= 600:
        raise PlaylistError(f"bad second {v!r}")
    return round(float(v), 1)


def check_item(item: dict) -> dict:
    if not isinstance(item, dict):
        raise PlaylistError("an item is an object")
    match = str(item.get("match") or "")
    if not MATCH_RE.fullmatch(match) or ".." in match:
        raise PlaylistError(f"bad match {match!r}")
    rnd = item.get("round")
    if not isinstance(rnd, int) or isinstance(rnd, bool) or not 0 <= rnd <= 200:
        raise PlaylistError("bad round")
    start, end = _sec(item.get("start")), _sec(item.get("end"))
    if start is not None and end is not None and end <= start:
        raise PlaylistError("an item ends after it starts")
    item_id = str(item.get("id") or "")
    return {
        "id": item_id if ITEM_RE.fullmatch(item_id) else uuid.uuid4().hex[:8],
        "match": match, "round": rnd, "start": start, "end": end, "caption": _text(item.get("caption"), 200),
    }


def _check(pl: dict) -> dict:
    if not isinstance(pl, dict):
        raise PlaylistError("a playlist is an object")
    name = _text(pl.get("name"), 80)
    if not name:
        raise PlaylistError("a playlist needs a name")
    items = pl.get("items", [])
    if not isinstance(items, list):
        raise PlaylistError("items is a list")
    if len(items) > MAX_ITEMS:
        raise PlaylistError(f"a playlist has at most {MAX_ITEMS} items")
    checked, seen = [], set()
    for it in items:
        c = check_item(it)
        if c["id"] in seen:
            c["id"] = uuid.uuid4().hex[:8]
        seen.add(c["id"])
        checked.append(c)
    owner = str(pl.get("owner") or "")
    return {
        "name": name, "folder": _text(pl.get("folder"), 40), "owner": owner if MEMBER_RE.fullmatch(owner) else "",
        "owner_nick": _text(pl.get("owner_nick"), 32), "items": checked,
    }


def get_playlist(out: str | Path, playlist_id: str) -> dict | None:
    return next((p for p in load_playlists(out) if p["id"] == playlist_id), None)


def create_playlist(out: str | Path, pl: dict, owner: dict | None) -> dict:
    data = _check(pl | {"owner": owner["id"] if owner else "", "owner_nick": owner["nick"] if owner else ""})
    now = int(time.time())
    data = {"id": uuid.uuid4().hex[:12], **data, "created": now, "updated": now}
    with _lock:
        found = load_playlists(out)
        if len(found) >= MAX_PLAYLISTS:
            raise PlaylistError(f"too many playlists (max {MAX_PLAYLISTS})")
        _save(out, [*found, data])
    return data


def _owned(pl: dict, who_id: str | None, can_edit: bool) -> bool:
    return can_edit or (bool(who_id) and pl["owner"] == who_id)


def update_playlist(out: str | Path, playlist_id: str, pl: dict, who_id: str | None, can_edit: bool) -> dict | None:
    """Replace name, folder and items; the owner stays. Owner or staff only; None when there is no such playlist."""
    with _lock:
        found = load_playlists(out)
        i = next((k for k, p in enumerate(found) if p["id"] == playlist_id), None)
        if i is None:
            return None
        old = found[i]
        if not _owned(old, who_id, can_edit):
            raise PermissionError("access_owner")
        data = _check(pl | {"owner": old["owner"], "owner_nick": old["owner_nick"]})
        found[i] = {"id": playlist_id, **data, "created": old.get("created", 0), "updated": int(time.time())}
        _save(out, found)
    return found[i]


def add_item(out: str | Path, playlist_id: str, item: dict, who_id: str | None, can_edit: bool) -> dict | None:
    """Append one item (the star in the replay)."""
    with _lock:
        found = load_playlists(out)
        pl = next((p for p in found if p["id"] == playlist_id), None)
        if pl is None:
            return None
        if not _owned(pl, who_id, can_edit):
            raise PermissionError("access_owner")
        if len(pl["items"]) >= MAX_ITEMS:
            raise PlaylistError(f"a playlist has at most {MAX_ITEMS} items")
        pl["items"] = [*pl["items"], check_item({k: v for k, v in item.items() if k != "id"})]
        pl["updated"] = int(time.time())
        _save(out, found)
    return pl


def delete_playlist(out: str | Path, playlist_id: str, who_id: str | None, can_edit: bool) -> bool:
    with _lock:
        found = load_playlists(out)
        pl = next((p for p in found if p["id"] == playlist_id), None)
        if pl is None:
            return False
        if not _owned(pl, who_id, can_edit):
            raise PermissionError("access_owner")
        _save(out, [p for p in found if p["id"] != playlist_id])
    return True


def merge_playlists(out: str | Path, incoming) -> dict:
    """Playlists from a pack: one replaces ours of the same id only when it is newer."""
    if not isinstance(incoming, list):
        raise PlaylistError("playlists is a list")
    counts = {"added": 0, "updated": 0, "skipped": 0}
    stamp = lambda v: int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else 0  # noqa: E731
    with _lock:
        found = load_playlists(out)
        by_id = {p["id"]: i for i, p in enumerate(found)}
        for p in incoming:
            pid = str(p.get("id", "")) if isinstance(p, dict) else ""
            if not ID_RE.fullmatch(pid):
                raise PlaylistError("a playlist without an id")
            data = {"id": pid, **_check(p), "created": stamp(p.get("created")), "updated": stamp(p.get("updated"))}
            if pid not in by_id:
                by_id[pid] = len(found)
                found.append(data)
                counts["added"] += 1
            elif stamp(found[by_id[pid]].get("updated")) < data["updated"]:
                found[by_id[pid]] = data
                counts["updated"] += 1
            else:
                counts["skipped"] += 1
        if len(found) > MAX_PLAYLISTS:
            raise PlaylistError(f"too many playlists (max {MAX_PLAYLISTS})")
        if counts["added"] or counts["updated"]:
            _save(out, found)
    return counts
