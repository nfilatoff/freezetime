"""Per-player detail of one match: kills by weapon, accuracy (shots and hits) and flashes.

Only the match's real rounds count (warmup and knife rounds are dropped by ``with_round``).

Hits are tied to shots by time, not by weapon name: ``player_hurt`` names some guns differently from
``weapon_fire`` (an M4A1-S hit says ``m4a1``, like the M4A4; a USP-S hit says ``hkp2000``), so every
bullet hit is matched to the attacker's last shot at or before it (``HIT_WINDOW`` ticks). A shot that hit
anyone counts once, so shotgun pellets don't inflate accuracy. Damage is the health actually taken
(``replay.actual_damage``: no overkill); an armour-only hit still counts as a hit.

``reaction`` is the approximate time from an enemy coming into the player's view to their first shot at them
(``freezetime.visibility``); None when the map's mesh is not cached.
"""

from __future__ import annotations

from pathlib import Path
from statistics import mean, median

import polars as pl

from freezetime.context import load_match, pct, with_round
from freezetime.replay import actual_damage, round_frames
from freezetime.visibility import checker, reaction_times

HIT_WINDOW = 8  # ticks between a shot and its damage event
NOT_GUNS = ("knife", "bayonet", "grenade", "flashbang", "molotov", "incgrenade", "decoy", "c4", "inferno", "world", "taser")
LONG_BLIND = 2.0  # seconds: an enemy blinded this long can't fight back


def _weapon(col: str) -> pl.Expr:
    return pl.col(col).cast(pl.Utf8).str.replace(r"^weapon_", "").alias("weapon")


def _gun(col: str = "weapon") -> pl.Expr:
    name = pl.col(col)
    return ~pl.any_horizontal([name.str.contains(w, literal=True) for w in NOT_GUNS]) & name.is_not_null() & (name != "")


def _reactions(m) -> dict[str, list[float]] | None:
    """Every reaction time of the match's real rounds per attacker, or None without a visibility mesh."""
    chk = checker(m.map_name)
    if chk is None:
        return None
    out: dict[str, list[float]] = {}
    for r in m.rounds.iter_rows(named=True):
        lo, hi = int(r["freeze_end_tick"]), int(r["end_tick"])
        frames, _ = round_frames(m, lo, hi)
        smokes = m.data["smokes"].filter((pl.col("start_tick") <= hi) & (pl.col("end_tick") >= lo) & pl.col("x").is_not_null() & pl.col("y").is_not_null()).select("start_tick", "end_tick", "x", "y").rows()
        for e in reaction_times(frames, smokes, m.data["damages"].filter(pl.col("tick").is_between(lo, hi)),
                                m.data["shots"].filter(pl.col("tick").is_between(lo, hi)), chk, m.tick_rate):
            out.setdefault(e["attacker"], []).append(e["reaction"])
    return out


def player_stats(directory: str | Path) -> dict[str, dict]:
    """``{steamid: {"weapons": [...], "accuracy": {...}, "flashes": {...}, "reaction": {...}}}`` for every player of the match."""
    m = load_match(directory, ("shots", "damages", "blinds", "smokes"))
    sid = lambda c: pl.col(c).cast(pl.Utf8)  # noqa: E731
    out: dict[str, dict] = {}

    kills = with_round(m.data["kills"], m.rounds).filter(
        sid("attacker_steamid").is_not_null() & (pl.col("attacker_side") != pl.col("victim_side"))
    ).select(sid("attacker_steamid").alias("steamid"), _weapon("weapon"), pl.col("headshot").fill_null(False))
    by_weapon_kills = kills.group_by("steamid", "weapon").agg(kills=pl.len(), headshots=pl.col("headshot").sum())

    shots = with_round(m.data["shots"], m.rounds).select(
        "tick", sid("steamid").alias("steamid"), _weapon("weapon")
    ).filter(_gun()).sort("tick")
    # damage as actually taken (no overkill) is worked out over every hit of the round, the world's included
    hurt = actual_damage(with_round(m.data["damages"], m.rounds), ("round_num",)).filter(sid("attacker_steamid").is_not_null()).select(
        "tick", sid("attacker_steamid").alias("steamid"), sid("victim_steamid").alias("victim"),
        pl.col("weapon").cast(pl.Utf8).alias("hurt_weapon"), pl.col("hitgroup_name").cast(pl.Utf8).alias("hitgroup"),
        pl.col("dmg").alias("damage"),
        (pl.col("attacker_side") != pl.col("victim_side")).alias("enemy"),
    ).filter(_gun("hurt_weapon")).sort("tick")
    # the shot each bullet hit came from: the attacker's last shot within HIT_WINDOW ticks
    hits = hurt.join_asof(
        shots.with_columns(shot_tick=pl.col("tick")), on="tick", by="steamid", strategy="backward", tolerance=HIT_WINDOW, check_sortedness=False,
    ).filter(pl.col("shot_tick").is_not_null())
    shot_hits = hits.group_by("steamid", "weapon", "shot_tick").agg(
        enemy=pl.col("enemy").any(), head=(pl.col("enemy") & (pl.col("hitgroup") == "head")).any(),
        damage=pl.when(pl.col("enemy")).then(pl.col("damage")).otherwise(0).sum(),
    )
    acc = (
        shots.group_by("steamid", "weapon").agg(shots=pl.len())
        .join(shot_hits.group_by("steamid", "weapon").agg(
            hits=pl.col("enemy").sum(), head_hits=pl.col("head").sum(), damage=pl.col("damage").sum()),
            on=["steamid", "weapon"], how="left")
        .with_columns(pl.col("hits", "head_hits", "damage").fill_null(0))
    )
    weapons = (
        acc.join(by_weapon_kills, on=["steamid", "weapon"], how="full", coalesce=True)
        .with_columns(pl.col("shots", "hits", "head_hits", "damage", "kills", "headshots").fill_null(0))
        .with_columns(accuracy=pct(pl.col("hits"), pl.col("shots")), hs_accuracy=pct(pl.col("head_hits"), pl.col("hits")))
        .sort(["steamid", "kills", "shots"], descending=[False, True, True])
    )

    blinds = with_round(m.data["blinds"], m.rounds).filter(sid("attacker_steamid").is_not_null()).select(
        sid("attacker_steamid").alias("steamid"), sid("victim_steamid").alias("victim"),
        pl.col("duration").cast(pl.Float64), (pl.col("attacker_side") != pl.col("victim_side")).alias("enemy"),
    ).filter(pl.col("steamid") != pl.col("victim"))  # being blinded by one's own flash is not "flashing" anyone
    flashes = blinds.group_by("steamid").agg(
        enemies_blinded=pl.col("enemy").sum(),
        enemy_blind_avg=pl.col("duration").filter(pl.col("enemy")).mean().round(2),
        enemy_blind_total=pl.col("duration").filter(pl.col("enemy")).sum().round(1),
        enemies_long=(pl.col("enemy") & (pl.col("duration") >= LONG_BLIND)).sum(),
        teammates_blinded=(~pl.col("enemy")).sum(),
        teammate_blind_avg=pl.col("duration").filter(~pl.col("enemy")).mean().round(2),
    )
    thrown = m.data["shots"].filter(pl.col("weapon").cast(pl.Utf8) == "weapon_flashbang")
    thrown = with_round(thrown, m.rounds).group_by(sid("steamid").alias("steamid")).agg(thrown=pl.len())

    reactions = _reactions(m)
    players = m.teams.select(sid("steamid").alias("steamid"))["steamid"].to_list()
    for steamid in players:
        w = weapons.filter(pl.col("steamid") == steamid).drop("steamid")
        guns = w.filter(_gun())
        total_shots, total_hits = int(guns["shots"].sum()), int(guns["hits"].sum())
        head = int(guns["head_hits"].sum())
        f = flashes.filter(pl.col("steamid") == steamid)
        n = thrown.filter(pl.col("steamid") == steamid)
        fl = f.drop("steamid").row(0, named=True) if f.height else {
            "enemies_blinded": 0, "enemy_blind_avg": None, "enemy_blind_total": 0.0, "enemies_long": 0,
            "teammates_blinded": 0, "teammate_blind_avg": None}
        fl["thrown"] = int(n["thrown"][0]) if n.height else 0
        out[steamid] = {
            "weapons": w.to_dicts(),
            "accuracy": {
                "shots": total_shots, "hits": total_hits, "head_hits": head,
                "accuracy": round(total_hits / total_shots * 100, 1) if total_shots else None,
                "hs_accuracy": round(head / total_hits * 100, 1) if total_hits else None,
            },
            "flashes": fl,
            "reaction": None if reactions is None else {
                "count": len(times := reactions.get(steamid, [])),
                "median": round(median(times), 3) if times else None,
                "mean": round(mean(times), 3) if times else None,
            },
        }
    return out
