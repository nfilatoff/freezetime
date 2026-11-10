import polars as pl

from freezetime.context import load_match, with_round
from freezetime.player_stats import _gun, player_stats


def test_player_stats(dust2_mini):
    stats = player_stats(dust2_mini)
    m = load_match(dust2_mini, ("damages",))
    assert set(stats) == set(m.teams["steamid"].cast(pl.Utf8).to_list())
    kills = with_round(m.data["kills"], m.rounds).filter(pl.col("attacker_side") != pl.col("victim_side"))
    assert sum(w["kills"] for p in stats.values() for w in p["weapons"]) == kills.height
    # every bullet of damage to an enemy found the shot it came from
    hurt = with_round(m.data["damages"], m.rounds).filter((pl.col("attacker_side") != pl.col("victim_side")) & _gun("weapon"))
    assert sum(w["damage"] for p in stats.values() for w in p["weapons"]) == hurt["dmg_health"].cast(pl.Int64).sum()
    for p in stats.values():
        a = p["accuracy"]
        assert 0 <= a["head_hits"] <= a["hits"] <= a["shots"]
        assert all(not any(x in w["weapon"] for x in ("knife", "grenade", "flashbang")) or w["shots"] == 0 for w in p["weapons"])
        f = p["flashes"]
        assert f["enemies_long"] <= f["enemies_blinded"] and f["thrown"] >= 0
        if f["enemies_blinded"]:
            assert 0 < f["enemy_blind_avg"] <= 6
    assert any(p["flashes"]["enemies_blinded"] for p in stats.values())
