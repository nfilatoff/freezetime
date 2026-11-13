import polars as pl
import pytest

from freezetime.context import load_match
from freezetime.replay import round_frames
from freezetime.visibility import MAX_REACTION_SEC, bloomed, checker, mesh_path, reaction_times, round_visibility, sees


class Fake:
    """A checker whose line of sight is a fixed answer."""

    def __init__(self, los=True):
        self.los = los

    def is_visible(self, a, b):
        return self.los


VIEWER = (0.0, 0.0, 0.0, 0.0)  # looks along +x


def test_sees_needs_the_target_in_front():
    assert sees(Fake(), VIEWER, (500.0, 0.0, 0.0, 0.0), [], 100)
    assert sees(Fake(), VIEWER, (500.0, 300.0, 0.0, 0.0), [], 100)  # ~31 degrees off
    assert not sees(Fake(), VIEWER, (-500.0, 0.0, 0.0, 0.0), [], 100)  # behind
    assert not sees(Fake(), VIEWER, (0.0, 500.0, 0.0, 0.0), [], 100)  # 90 degrees off
    assert not sees(Fake(False), VIEWER, (500.0, 0.0, 0.0, 0.0), [], 100)  # a wall


def test_crouched_eye_height_is_used_for_both_players():
    class Eyes:
        points = None

        def is_visible(self, viewer, target):
            self.points = viewer, target
            return True

    chk = Eyes()
    assert sees(chk, VIEWER, (500.0, 0.0, 0.0, 0.0), [], 100, True, True)
    assert chk.points == ((0.0, 0.0, 46.0), (500.0, 0.0, 46.0))


def test_sees_through_a_smoke_only_while_it_burns():
    smokes = bloomed([(1000, 2000, 250.0, 20.0)], 64.0)  # blocks from tick 1192
    target = (500.0, 0.0, 0.0, 0.0)
    assert sees(Fake(), VIEWER, target, smokes, 1100)  # still blooming
    assert not sees(Fake(), VIEWER, target, smokes, 1500)
    assert sees(Fake(), VIEWER, target, smokes, 2100)  # expired
    assert sees(Fake(), VIEWER, target, bloomed([(1000, 2000, 250.0, 400.0)], 64.0), 1500)  # a smoke off to the side


def test_mesh_path_for_an_unknown_map():
    assert mesh_path("de_nonexistent_map") is None
    assert checker("de_nonexistent_map") is None


def test_round_visibility_and_reactions_with_the_real_mesh(dust2_mini):
    if mesh_path("de_dust2") is None:
        pytest.skip("no cached Dust2 mesh")
    chk = checker("de_dust2")
    m = load_match(dust2_mini, ("smokes", "shots", "damages"))
    info = m.rounds.filter(pl.col("round_num") == 5).row(0, named=True)
    lo, hi = int(info["freeze_end_tick"]), int(info["end_tick"])
    frames, _ = round_frames(m, lo, hi)
    order = sorted(frames.filter(pl.col("health") > 0)["steamid"].unique().to_list())[:10]
    vis = round_visibility(frames, [], chk, m.tick_rate, order)
    n = frames["tick"].n_unique()
    assert set(vis) == set(order) and all(len(v) == n for v in vis.values())
    assert all(0 <= x < 1 << len(order) for v in vis.values() for x in v)
    assert any(x for v in vis.values() for x in v)
    # a player never sees a teammate or themselves
    side = dict(frames.group_by("steamid").agg(pl.col("side").drop_nulls().first()).iter_rows())
    for target, masks in vis.items():
        for x in masks:
            assert all(side[order[i]] != side[target] for i in range(len(order)) if x >> i & 1)
    found = reaction_times(frames, [], m.data["damages"].filter(pl.col("tick").is_between(lo, hi)),
                           m.data["shots"].filter(pl.col("tick").is_between(lo, hi)), chk, m.tick_rate)
    assert found
    for r in found:
        assert 0 <= r["reaction"] <= MAX_REACTION_SEC
        assert r["seen_tick"] <= r["shot_tick"] <= r["damage_tick"]


def test_without_a_mesh_nothing_fails(dust2_mini, monkeypatch):
    from freezetime.player_stats import player_stats
    from freezetime.replay import build_round

    monkeypatch.setattr("freezetime.visibility.mesh_path", lambda name: None)
    m = load_match(dust2_mini, ("smokes", "fires", "grenades", "blinds", "shots", "damages"))
    doc = build_round(m, 5)
    assert all(p["seen_by"] is None for p in doc["players"])
    assert doc["kills"] and all(k["reaction"] is None and k["victim_reaction"] is None for k in doc["kills"])
    assert all(p["reaction"] is None for p in player_stats(dust2_mini).values())


def test_a_smoke_without_a_centre_is_skipped():
    assert sees(Fake(), VIEWER, (500.0, 0.0, 0.0, 0.0), [(0, 9999, None, None)], 100)
