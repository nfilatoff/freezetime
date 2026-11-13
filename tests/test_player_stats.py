import polars as pl

from freezetime.context import load_match, with_round
from freezetime.player_stats import _gun, player_stats
from freezetime.replay import actual_damage


def test_player_stats(dust2_mini):
    stats = player_stats(dust2_mini)
    m = load_match(dust2_mini, ("damages",))
    assert set(stats) == set(m.teams["steamid"].cast(pl.Utf8).to_list())
    kills = with_round(m.data["kills"], m.rounds).filter(pl.col("attacker_side") != pl.col("victim_side"))
    assert sum(w["kills"] for p in stats.values() for w in p["weapons"]) == kills.height
    # every bullet of damage to an enemy found the shot it came from
    hurt = actual_damage(with_round(m.data["damages"], m.rounds), ("round_num",)).filter((pl.col("attacker_side") != pl.col("victim_side")) & _gun("weapon"))
    total = sum(w["damage"] for p in stats.values() for w in p["weapons"])
    assert total == hurt["dmg"].sum() < hurt["dmg_health"].cast(pl.Int64).sum()  # health actually taken: lethal hits lose their overkill
    for p in stats.values():
        a = p["accuracy"]
        assert 0 <= a["head_hits"] <= a["hits"] <= a["shots"]
        assert all(not any(x in w["weapon"] for x in ("knife", "grenade", "flashbang")) or w["shots"] == 0 for w in p["weapons"])
        f = p["flashes"]
        assert f["enemies_long"] <= f["enemies_blinded"] and f["thrown"] >= 0
        if f["enemies_blinded"]:
            assert 0 < f["enemy_blind_avg"] <= 6
    assert any(p["flashes"]["enemies_blinded"] for p in stats.values())


def test_damage_has_no_overkill(dust2_mini):
    m = load_match(dust2_mini, ("damages",))
    d = actual_damage(with_round(m.data["damages"], m.rounds), ("round_num",))
    assert d.height == with_round(m.data["damages"], m.rounds).filter(pl.col("dmg_health").is_not_null()).height
    assert (d["dmg"] >= 0).all() and (d["dmg"] <= d["dmg_health"]).all()
    # nobody loses more than a full health bar a round, and a lethal overkill hit counts only the HP that was left
    assert d.group_by("round_num", "victim_steamid").agg(pl.col("dmg").sum())["dmg"].max() <= 100
    lethal = d.filter((pl.col("health_post") == 0) & (pl.col("dmg_health") > pl.col("dmg")))
    assert lethal.height
    # the HP before a lethal hit is what the victim had left: 100 minus what they took earlier that round
    for r in lethal.head(5).iter_rows(named=True):
        earlier = d.filter((pl.col("round_num") == r["round_num"]) & (pl.col("victim_steamid") == r["victim_steamid"]) & (pl.col("tick") < r["tick"]))
        assert r["dmg"] == 100 - earlier["dmg"].sum()


def test_reaction_block(dust2_mini):
    for p in player_stats(dust2_mini).values():
        r = p["reaction"]  # None without a cached map mesh
        if r is not None:
            assert set(r) == {"count", "median", "mean"}
            assert (r["count"] == 0) == (r["median"] is None)
            assert r["median"] is None or 0 <= r["median"] <= 1.5
