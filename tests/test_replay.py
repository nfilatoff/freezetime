import gzip
import json
import shutil

import polars as pl

from freezetime.context import load_match
from freezetime.extract import REPLAY_COLUMNS, write_replay
from freezetime.replay import _state_flags, build_round, round_payload


def test_round_document(dust2_mini):
    m = load_match(dust2_mini, extra_tables=("smokes", "fires", "grenades", "blinds", "shots"))
    doc = build_round(m, 5)
    n = len(doc["ticks"])
    assert doc["low_res"]  # the fixture has no replay.parquet, so 0.5 s snapshots are used
    assert len(doc["players"]) == 10
    assert {p["side"] for p in doc["players"]} == {"terrorist", "counter-terrorist"}
    for p in doc["players"]:
        assert all(len(p[k]) == n for k in ("x", "y", "yaw", "hp", "weapon", "bomb"))
    if doc["has_player_states"]:
        assert all(len(p[k]) == n for p in doc["players"] for k in ("scoped", "reloading", "walking", "crouched", "jumping"))
    assert doc["start_tick"] <= doc["freeze_end_tick"] < doc["end_tick"] <= doc["last_tick"]
    assert all(doc["start_tick"] <= k["tick"] <= doc["last_tick"] for k in doc["kills"])
    assert any(b["event"] == "finish_plant" and b["site"] == "A" for b in doc["bomb"])
    json.dumps(doc)  # serialisable as is


def test_write_replay_captures_nullable_player_states(tmp_path):
    values = {column: 1 for column in REPLAY_COLUMNS}
    values.update(tick=4, steamid=123, name="player", side="terrorist", active_weapon="awp")
    values.update(is_scoped=True, is_reloading=None, is_walking=False, is_crouched=True, is_jumping=False)

    class Demo:
        header = {"playback_ticks": 4}

        def snapshots(self, **_kwargs):
            return pl.DataFrame([values])

    assert write_replay(Demo(), tmp_path) == 1
    saved = pl.read_parquet(tmp_path / "replay.parquet").row(0, named=True)
    assert [saved[k] for k in REPLAY_COLUMNS[-5:]] == [True, None, False, True, False]


def test_replay_state_arrays_keep_false_and_unknown_values():
    frames = pl.DataFrame({"state": pl.Series([True, False, None], dtype=pl.Boolean)})
    assert _state_flags(frames, "state") == [1, 0, None]
    assert _state_flags(frames, "missing") is None


def test_legacy_dense_frames_leave_missing_states_unknown(dust2_mini, tmp_path):
    d = tmp_path / "m"
    shutil.copytree(dust2_mini, d)
    frames = pl.read_parquet(d / "snapshots.parquet")
    frames.write_parquet(d / "replay.parquet")
    doc = build_round(load_match(d, extra_tables=("smokes", "fires", "grenades", "blinds", "shots", "damages")), 5)
    assert not doc["has_player_states"]
    assert all(p[k] is None for p in doc["players"] for k in ("scoped", "reloading", "walking", "crouched", "jumping"))


def test_dense_player_states_align_true_false_and_null_frames(dust2_mini, tmp_path):
    d = tmp_path / "m"
    shutil.copytree(dust2_mini, d)
    frames = pl.read_parquet(d / "snapshots.parquet")
    states = ("is_scoped", "is_reloading", "is_walking", "is_crouched", "is_jumping")
    frames = frames.with_columns(
        pl.when(pl.col("tick") % 3 == 0).then(None)
        .when((pl.col("tick") + i) % 2 == 0).then(True)
        .otherwise(False).cast(pl.Boolean).alias(name)
        for i, name in enumerate(states)
    )
    frames.write_parquet(d / "replay.parquet")
    doc = build_round(load_match(d, extra_tables=("smokes", "fires", "grenades", "blinds", "shots", "damages")), 5)
    assert doc["has_player_states"]
    for player in doc["players"]:
        source = frames.filter(pl.col("steamid") == int(player["steamid"]))
        aligned = pl.DataFrame({"tick": doc["ticks"]}).join(source, on="tick", how="left")
        for column, key in zip(states, ("scoped", "reloading", "walking", "crouched", "jumping"), strict=True):
            expected = [None if value is None else int(value) for value in aligned[column].to_list()]
            assert player[key] == expected


def test_payload_is_cached(dust2_mini, tmp_path):
    d = tmp_path / "m"
    shutil.copytree(dust2_mini, d)
    first = round_payload(d, 3)
    assert list((d / "replay").glob("round_3.*.json.gz"))
    assert round_payload(d, 3) == first
    assert json.loads(gzip.decompress(first))["round"] == 3


def test_inventory_shots_and_duels(dust2_mini):
    m = load_match(dust2_mini, extra_tables=("smokes", "fires", "grenades", "blinds", "shots", "damages"))
    doc = build_round(m, 5)
    for p in doc["players"]:
        assert p["inv"] and all(0 <= i < len(doc["items"]) for _, i in p["inv"])
    assert any(len(inv) > 2 for inv in doc["items"])  # somebody carries grenades
    shots = doc["shots"]
    assert len({len(v) for v in shots.values()}) == 1
    assert any(h is not None for h in shots["hx"])  # some shots hit a player
    for k in doc["kills"]:
        assert set(k) >= {"dist", "attacker_hp", "victim_weapon", "given", "taken", "trade", "traded"}
        if k["attacker"] and k["weapon"] not in ("hegrenade", "inferno", "molotov"):
            assert k["given"][0] >= 1 and k["given"][1] > 0


def test_grenades_carry_the_release(dust2_mini):
    m = load_match(dust2_mini, extra_tables=("smokes", "fires", "grenades", "blinds", "shots", "damages"))
    doc = build_round(m, 5)
    thrown = [g for g in doc["grenades"] if g["throw"]]
    assert thrown and len(thrown) >= len(doc["grenades"]) // 2  # most paths find their weapon_fire
    for g in thrown:
        t = g["throw"]
        assert set(t) == {"x", "y", "z", "pitch", "yaw"}
        assert -90 <= t["pitch"] <= 90
        # the release is where the path starts: next to the thrower
        assert ((t["x"] - g["x"][0]) ** 2 + (t["y"] - g["y"][0]) ** 2) ** 0.5 <= 160
    json.dumps(doc["grenades"])


def test_smokes_and_fires_know_their_thrower_side(dust2_mini):
    m = load_match(dust2_mini, extra_tables=("smokes", "fires", "grenades", "blinds", "shots", "damages"))
    for rn in (3, 5):
        doc = build_round(m, rn)
        sides = {p["steamid"]: p["side"] for p in doc["players"]}
        for kind in ("smokes", "fires"):
            areas = doc[kind]
            assert areas and all({"thrower", "side"} <= set(a) for a in areas)
            # every area in the fixture rounds starts where a grenade's path ends, so each gets a side
            assert all(a["side"] in ("terrorist", "counter-terrorist") for a in areas)
            for a in areas:
                if a["thrower"] in sides:
                    assert sides[a["thrower"]] == a["side"]
    # a smoke with no grenade ending there stays unowned
    from freezetime.replay import _owned

    lone = _owned([{"start": 100, "end": 200, "x": 0, "y": 0, "z": 0}], [], {"smoke"}, 64)
    assert lone[0]["side"] is None and lone[0]["thrower"] is None


def test_money_follows_purchases(dust2_mini, tmp_path):
    import polars as pl

    d = tmp_path / "m"
    shutil.copytree(dust2_mini, d)
    freeze_end = pl.read_parquet(d / "rounds.parquet").filter(pl.col("round_num") == 5)["freeze_end_tick"][0]
    # replay frames with a balance: $4000 in the freeze time, $800 left after buying, one frame without a value
    snaps = pl.read_parquet(d / "snapshots.parquet")
    gap = snaps.filter(pl.col("tick") > freeze_end)["tick"].min()
    money = pl.when(pl.col("tick") < freeze_end - 640).then(4000).otherwise(800)
    frames = snaps.select(
        "tick", "steamid", "name", "side", "x", "y", "z", "yaw", "health", "armor", "has_bomb", "active_weapon",
        money=pl.when(pl.col("tick") == gap).then(None).otherwise(money),
    )
    frames.write_parquet(d / "replay.parquet")
    doc = build_round(load_match(d, extra_tables=("smokes", "fires", "grenades", "blinds", "shots", "damages")), 5)
    ticks = doc["ticks"]
    for p in doc["players"]:
        assert len(p["money"]) == len(ticks)
        assert p["money"][0] == 4000 and p["money"][-1] == 800  # the balance at each frame, not the round start
        assert p["money"][ticks.index(gap)] == 800  # a gap keeps the previous value


def test_hurts(dust2_mini):
    m = load_match(dust2_mini, extra_tables=("smokes", "fires", "grenades", "blinds", "shots", "damages"))
    doc = build_round(m, 5)
    h = doc["hurts"]
    assert len({len(v) for v in h.values()}) == 1 and h["tick"]
    assert h["tick"] == sorted(h["tick"])
    assert all(doc["start_tick"] <= t <= doc["last_tick"] for t in h["tick"])
    assert all(1 <= d <= 100 for d in h["dmg"])
    for v in set(h["victim"]):  # a player has 100 HP a round, so no more than that is ever taken
        assert sum(d for x, d in zip(h["victim"], h["dmg"]) if x == v) <= 100
    # a kill comes after enough damage: what the victim took up to the kill is about a full health bar
    kill = next(k for k in doc["kills"] if k["victim"] in h["victim"])
    taken = sum(d for t, v, d in zip(h["tick"], h["victim"], h["dmg"]) if v == kill["victim"] and t <= kill["tick"])
    assert taken >= 90
    json.dumps(doc)


def test_seen_by_and_reactions(dust2_mini):
    m = load_match(dust2_mini, extra_tables=("smokes", "fires", "grenades", "blinds", "shots", "damages"))
    doc = build_round(m, 5)
    n = len(doc["ticks"])
    for p in doc["players"]:
        if p["seen_by"] is not None:  # None without a cached map mesh
            assert len(p["seen_by"]) == n and all(0 <= x < 1 << len(doc["players"]) for x in p["seen_by"])
    for k in doc["kills"]:
        assert set(k) >= {"reaction", "victim_reaction"}
        assert all(k[r] is None or 0 <= k[r] <= 1.5 for r in ("reaction", "victim_reaction"))
