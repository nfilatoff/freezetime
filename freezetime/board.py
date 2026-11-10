"""Tactics boards: tactics drawn on a map radar in steps, stored as JSON in ``out/boards``.

The frontend owns the drawing (``frontend/src/board.ts``); this module stores, lists and
checks boards. One file per board, ``<id>.json``::

    {
      "format": 1,
      "id": "3f9c0a1b2c4d",
      "name": "B split",
      "map": "de_mirage",
      "author": "coach",
      "steps": ["", "", "Go B", ""],     # 1-4 step names, "" = the default name of that step
      "tokens": [...],                   # players and the bomb: one position per step, routes between steps
      "marks": [...],                    # grenades, drawings and text, each on one step
      "source": {"match": "...", "round": 7, "sec": 23.5},   # optional: the replay frame it came from
      "created": 1767225600,
      "updated": 1767225600
    }

Coordinates are radar pixels (0-1024) of the level a point is on (``l``, an index into the
map's levels), so boards don't depend on world units. Bump ``FORMAT`` when the layout of
tokens or marks changes, and teach the frontend to read the older one.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path

FORMAT = 1
DIR = "boards"
MAX_STEPS = 4
MAX_ITEMS = 2000  # tokens + marks
MAX_POINTS = 20000  # all points of all marks and routes
MAX_BYTES = 2 << 20
ID_RE = re.compile(r"^[0-9a-f]{12}$")
MAP_RE = re.compile(r"^[a-z0-9_]{1,40}$")
TOKEN_TYPES = {"player", "bomb"}
MARK_TYPES = {"nade", "pen", "arrow", "rect", "circle", "text"}
NADE_KINDS = {"smoke", "molotov", "incendiary", "flashbang", "he", "decoy"}


class BoardError(ValueError):
    """A board that cannot be saved: the message says why."""


def board_dir(out: str | Path) -> Path:
    return Path(out) / DIR


def _path(out: str | Path, board_id: str) -> Path:
    if not ID_RE.fullmatch(board_id or ""):
        raise BoardError(f"bad board id {board_id!r}")
    return board_dir(out) / f"{board_id}.json"


def _text(v, limit: int) -> str:
    return " ".join(str(v or "").split())[:limit]


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and -5000 <= v <= 5000


def _pos(p) -> bool:
    return isinstance(p, dict) and _num(p.get("x")) and _num(p.get("y")) and isinstance(p.get("l", 0), int)


def _check(board: dict) -> dict:
    """The parts of a board we store, checked; raises BoardError."""
    if not isinstance(board, dict):
        raise BoardError("a board is an object")
    fmt = board.get("format", FORMAT)
    if fmt != FORMAT:
        raise BoardError(f"unsupported board format {fmt!r}")
    map_name = str(board.get("map") or "")
    if not MAP_RE.fullmatch(map_name):
        raise BoardError(f"bad map {map_name!r}")
    steps = board.get("steps")
    if not isinstance(steps, list) or not 1 <= len(steps) <= MAX_STEPS:
        raise BoardError(f"a board has 1-{MAX_STEPS} steps")
    steps = [_text(s, 40) for s in steps]
    tokens, marks = board.get("tokens", []), board.get("marks", [])
    if not isinstance(tokens, list) or not isinstance(marks, list):
        raise BoardError("tokens and marks are lists")
    if len(tokens) + len(marks) > MAX_ITEMS:
        raise BoardError(f"too many elements (max {MAX_ITEMS})")
    points = 0
    for tok in tokens:
        if not isinstance(tok, dict) or tok.get("type") not in TOKEN_TYPES or not isinstance(tok.get("id"), str):
            raise BoardError("bad token")
        pos, route = tok.get("pos"), tok.get("route", [])
        if not isinstance(pos, list) or len(pos) != len(steps) or not any(p is not None for p in pos):
            raise BoardError("a token has one position (or null) per step and at least one position")
        if not all(p is None or _pos(p) for p in pos):
            raise BoardError("bad token position")
        if not isinstance(route, list) or len(route) > len(steps) or not all(isinstance(r, list) and all(_pos(p) for p in r) for r in route):
            raise BoardError("bad token route")
        if tok["type"] == "player" and tok.get("side") not in ("ct", "t"):
            raise BoardError("a player token is ct or t")
        if "label" in tok:
            tok["label"] = _text(tok["label"], 24)
        points += sum(len(r) for r in route)
    for mark in marks:
        if not isinstance(mark, dict) or mark.get("type") not in MARK_TYPES or not isinstance(mark.get("id"), str):
            raise BoardError("bad mark")
        step = mark.get("step")
        if not isinstance(step, int) or not 0 <= step < len(steps):
            raise BoardError("a mark is on one of the board's steps")
        pts = mark.get("pts")
        if not isinstance(pts, list) or not pts or not all(isinstance(p, list) and len(p) == 2 and _num(p[0]) and _num(p[1]) for p in pts):
            raise BoardError("bad mark points")
        if mark["type"] == "nade" and mark.get("kind") not in NADE_KINDS:
            raise BoardError("unknown grenade")
        if mark["type"] == "text":
            mark["text"] = str(mark.get("text") or "")[:200]
        points += len(pts)
    if points > MAX_POINTS:
        raise BoardError(f"too many points (max {MAX_POINTS})")
    out = {
        "format": FORMAT,
        "name": _text(board.get("name"), 80),
        "map": map_name,
        "author": _text(board.get("author"), 40),
        "steps": steps,
        "tokens": tokens,
        "marks": marks,
    }
    src = board.get("source")
    if isinstance(src, dict) and isinstance(src.get("match"), str) and isinstance(src.get("round"), int) and _num(src.get("sec", 0)):
        out["source"] = {"match": src["match"][:200], "round": src["round"], "sec": float(src.get("sec", 0))}
    return out


def _write(path: Path, board: dict) -> None:
    text = json.dumps(board, ensure_ascii=False, separators=(",", ":"))
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise BoardError("the board is too big")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def load_board(out: str | Path, board_id: str) -> dict | None:
    p = _path(out, board_id)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except ValueError:
        return None


def summary(board: dict) -> dict:
    return {k: board.get(k) for k in ("id", "name", "map", "author", "created", "updated")} | {
        "steps": len(board.get("steps", [])),
        "players": sum(1 for t in board.get("tokens", []) if t.get("type") == "player"),
        "source": board.get("source"),
    }


def list_boards(out: str | Path, map_name: str | None = None) -> list[dict]:
    """Summaries of the stored boards, the last updated first; a broken file is skipped."""
    found = []
    folder = board_dir(out)
    for p in folder.glob("*.json") if folder.is_dir() else []:
        if not ID_RE.fullmatch(p.stem):
            continue
        try:
            b = json.loads(p.read_text(encoding="utf-8"))
        except ValueError:
            continue
        if map_name and b.get("map") != map_name:
            continue
        found.append(summary(b))
    return sorted(found, key=lambda b: -(b.get("updated") or 0))


def create_board(out: str | Path, board: dict) -> dict:
    data = _check(board)
    now = int(time.time())
    data = {"id": uuid.uuid4().hex[:12], **data, "created": now, "updated": now}
    _write(_path(out, data["id"]), data)
    return data


def update_board(out: str | Path, board_id: str, board: dict) -> dict | None:
    """Replace a stored board, keeping its id and creation time; None when there is no such board."""
    old = load_board(out, board_id)
    if old is None:
        return None
    data = {"id": board_id, **_check(board), "created": old.get("created") or int(time.time()), "updated": int(time.time())}
    _write(_path(out, board_id), data)
    return data


def delete_board(out: str | Path, board_id: str) -> bool:
    p = _path(out, board_id)
    if not p.exists():
        return False
    p.unlink()
    return True


def import_board(out: str | Path, board: dict) -> str:
    """Store a board that came with its own id (from a pack): ``added``, ``updated`` when it is
    newer than ours, else ``skipped``. Its id and times are kept, so packs can be merged again."""
    board_id = str(board.get("id") or "")
    path = _path(out, board_id)
    data = _check(board)
    stamp = lambda v: int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else 0  # noqa: E731
    updated = stamp(board.get("updated")) or int(time.time())
    old = load_board(out, board_id)
    if old is not None and stamp(old.get("updated")) >= updated:
        return "skipped"
    _write(path, {"id": board_id, **data, "created": stamp(board.get("created")) or updated, "updated": updated})
    return "added" if old is None else "updated"
