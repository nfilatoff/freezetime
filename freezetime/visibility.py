"""Approximate "who sees whom" and reaction times, computed from geometry.

The demo does not say who spotted whom (``m_bSpottedByMask`` is not decoded; only "spotted by anyone" is),
so visibility is modelled: eye-to-eye line of sight over awpy's map collision mesh, the viewer's horizontal field of
view, and active smokes. Checked against the game's own "spotted" flag it finds roughly 65-90 % of the spotted
frames and adds some false positives (props the mesh lacks, partial exposure, the real field of view). Treat every
result as an estimate.

Nothing is downloaded: the mesh is read from awpy's local cache (``~/.awpy/<version>/geometry/<map>.mesh``) by an
explicit path, and without one every function that needs it is given ``None`` by ``checker`` and the callers skip.

A viewer or target is a tuple ``(x, y, z, yaw)`` (feet position in world units, yaw in degrees); ``smokes`` are
``(start_tick, end_tick, x, y)`` rows. Replay frames are a few ticks apart (4 ticks, ~62 ms, or 32 for old extracts
without ``replay.parquet``), so every tick found here is precise to one frame.
"""

from __future__ import annotations

import json
import logging
import math
from bisect import bisect_right
from functools import lru_cache
from pathlib import Path

import polars as pl

EYE_Z = 64.0  # eye height above the feet
EYE_Z_CROUCHED = 46.0
HALF_FOV_DEG = 53.0  # half of the horizontal field of view
SMOKE_R = 144.0  # a line of sight through this radius around a smoke centre is blocked
SMOKE_BLOOM_SEC = 3.0  # a smoke blocks vision only after it has bloomed
MAX_REACTION_SEC = 1.5  # an enemy in view longer than this before the first shot was not a reaction
LOOKBACK_SEC = 3.0  # how far back the start of a sighting is searched
NON_GUNS = ("knife", "bayonet", "grenade", "flashbang", "molotov", "incgrenade", "decoy", "c4", "inferno", "world", "taser")


def mesh_path(map_name: str) -> Path | None:
    """The newest locally cached collision mesh of a map, or None."""
    found = list(Path.home().glob(f".awpy/*/geometry/{map_name}.mesh"))
    found.sort(key=lambda p: (int(p.parents[1].name) if p.parents[1].name.isdigit() else -1, p.parents[1].name), reverse=True)
    return found[0] if found else None


def mesh_stamp(directory: Path) -> tuple[str, float] | None:
    """A match's cached visibility mesh (path, mtime) or None: the map comes from its ``manifest.json``.

    Shared by callers that must notice a mesh cached after they last looked (a result built without one
    is missing ``seen_by``/reaction and should be rebuilt once the mesh appears).
    """
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    path = mesh_path(str(manifest["header"].get("map_name", "")))
    return (str(path), path.stat().st_mtime) if path else None


log = logging.getLogger(__name__)


@lru_cache(maxsize=8)
def _load(path: Path, _mtime: float):
    from awpy import VisibilityChecker

    return VisibilityChecker(path)


def checker(map_name: str):
    """awpy's ``VisibilityChecker`` of a map (built once per mesh file), or None without a cached or loadable mesh.

    A missing mesh is looked up again on every call (it may be cached later); only loaded checkers are kept, keyed
    by the mesh file's mtime too, so a mesh replaced in place (not just a newly appearing one) is reloaded.
    """
    path = mesh_path(map_name)
    if path is None:
        return None
    try:
        return _load(path, path.stat().st_mtime)
    except Exception as e:  # a broken mesh or an awpy without the checker: visibility is unavailable
        log.warning("visibility mesh %s failed to load: %s", path, e)
        return None


def _smoked(a: tuple, b: tuple, smokes: list[tuple], tick: int) -> bool:
    """Whether the horizontal segment a-b passes through a bloomed, still burning smoke."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = dx * dx + dy * dy or 1.0
    for start, end, sx, sy in smokes:
        if sx is None or sy is None or not start <= tick <= end:
            continue
        u = max(0.0, min(1.0, ((sx - a[0]) * dx + (sy - a[1]) * dy) / length))
        px, py = a[0] + u * dx - sx, a[1] + u * dy - sy
        if px * px + py * py <= SMOKE_R * SMOKE_R:
            return True
    return False


def sees(chk, viewer: tuple, target: tuple, smokes: list[tuple], tick: int, viewer_crouched: bool = False, target_crouched: bool = False) -> bool:
    """Whether ``viewer`` can see ``target`` at ``tick`` (approximate, see the module docstring).

    ``smokes`` are ``(bloom_tick, end_tick, x, y)``: already shifted by ``SMOKE_BLOOM_SEC`` (see ``bloomed``).
    """
    angle = math.atan2(target[1] - viewer[1], target[0] - viewer[0]) - math.radians(viewer[3])
    angle = (angle + math.pi) % (2 * math.pi) - math.pi
    if abs(angle) > math.radians(HALF_FOV_DEG):
        return False
    if _smoked(viewer, target, smokes, tick):
        return False
    viewer_eye = EYE_Z_CROUCHED if viewer_crouched else EYE_Z
    target_eye = EYE_Z_CROUCHED if target_crouched else EYE_Z
    return bool(chk.is_visible((viewer[0], viewer[1], viewer[2] + viewer_eye), (target[0], target[1], target[2] + target_eye)))


def bloomed(smokes: list[tuple], rate: float) -> list[tuple]:
    """Smokes with the start moved to the tick they begin to block vision."""
    return [(s + SMOKE_BLOOM_SEC * rate, e, x, y) for s, e, x, y in smokes]


def _positions(frames: pl.DataFrame, only: set[int] | None = None) -> dict[int, dict[int, tuple]]:
    """``{tick: {steamid: (side, x, y, z, yaw, crouched)}}`` for living players."""
    f = frames.filter((pl.col("health") > 0) & pl.col("x").is_not_null() & pl.col("yaw").is_not_null())
    if only is not None:
        f = f.filter(pl.col("steamid").is_in(list(only)))
    out: dict[int, dict[int, tuple]] = {}
    columns = ["tick", "steamid", "side", "x", "y", "z", "yaw"]
    has_crouch = "is_crouched" in f.columns
    if has_crouch:
        columns.append("is_crouched")
    for row in f.select(columns).iter_rows():
        tick, sid, side, x, y, z, yaw = row[:7]
        crouched = bool(row[7]) if has_crouch and row[7] is not None else False
        out.setdefault(tick, {})[sid] = (side, x, y, z, yaw, crouched)
    return out


def round_visibility(frames: pl.DataFrame, smokes: list[tuple], chk, rate: float, order: list[int]) -> dict[int, list[int]]:
    """For each player in ``order`` and every frame tick of the round, a bitmask of who sees them.

    Bit ``i`` is set when the living enemy ``order[i]`` sees the player at that tick. Dead players get 0.
    The lists are aligned with the sorted unique ``tick`` values of ``frames``. Approximate (module docstring).
    """
    idx = {sid: i for i, sid in enumerate(order)}
    smokes = bloomed(smokes, rate)
    pos = _positions(frames, set(order))
    ticks = frames["tick"].unique().sort().to_list()
    out = {sid: [0] * len(ticks) for sid in order}
    for i, tick in enumerate(ticks):
        players = list(pos.get(tick, {}).items())
        for a, (a_side, *a_pt) in players:
            for b, (b_side, *b_pt) in players:
                if a_side != b_side and sees(chk, a_pt[:4], b_pt[:4], smokes, tick, a_pt[4], b_pt[4]):
                    out[b][i] |= 1 << idx[a]
    return out


def reaction_times(
    frames: pl.DataFrame, smokes: list[tuple], damages: pl.DataFrame, shots: pl.DataFrame, chk, rate: float
) -> list[dict]:
    """The reaction of every attacker to every enemy they damaged in a round (approximate, one frame precise).

    An engagement is an attacker's first gun damage to one enemy. Walking back over the frames from that damage
    gives ``seen_tick``, when the victim came into the attacker's view; the first gun shot between ``seen_tick`` and
    the damage is ``shot_tick``; the reaction is their distance in seconds. Dropped: the victim was not in view at the
    damage (wallbang, smoke), no shot was found, or the sighting began more than ``MAX_REACTION_SEC`` before the shot.
    Steamids in the result are strings. Frames, damages and shots belong to the one round.
    """
    smokes = bloomed(smokes, rate)
    pos = _positions(frames)
    ticks = sorted(pos)
    guns = ~pl.any_horizontal([pl.col("weapon").cast(pl.Utf8).str.contains(w, literal=True) for w in NON_GUNS])
    first: dict[tuple[int, int], int] = {}
    for tick, a, v in (
        damages.filter(pl.col("attacker_steamid").is_not_null() & (pl.col("attacker_side") != pl.col("victim_side")) & guns)
        .sort("tick").select("tick", "attacker_steamid", "victim_steamid").iter_rows()
    ):
        first.setdefault((a, v), tick)
    fired: dict[int, list[int]] = {}
    for tick, sid in shots.filter(guns).sort("tick").select("tick", "steamid").iter_rows():
        fired.setdefault(sid, []).append(tick)

    def view(i: int, a: int, v: int) -> bool:
        p = pos[ticks[i]]
        return a in p and v in p and sees(chk, p[a][1:5], p[v][1:5], smokes, ticks[i], p[a][5], p[v][5])

    out = []
    for (a, v), damage in first.items():
        i = bisect_right(ticks, damage) - 1
        if i < 0 or not view(i, a, v):
            continue
        j = i
        while j > 0 and ticks[j - 1] >= damage - LOOKBACK_SEC * rate and view(j - 1, a, v):
            j -= 1
        seen = ticks[j]
        shot = next((t for t in fired.get(a, []) if seen <= t <= damage), None)
        if shot is None or (shot - seen) / rate > MAX_REACTION_SEC:
            continue
        out.append({"attacker": str(a), "victim": str(v), "seen_tick": seen, "shot_tick": shot, "damage_tick": damage,
                    "reaction": round((shot - seen) / rate, 3)})
    return out
