import io
import json
import shutil
import zipfile

import pytest

from freezetime import board as B
from freezetime import pack as P
from freezetime import team as T
from tests.test_board import sample as board_sample
from tests.test_team import sample as team_sample


def library(tmp_path, name: str, dust2_mini=None):
    out = tmp_path / name
    out.mkdir()
    if dust2_mini is not None:
        shutil.copytree(dust2_mini, out / "dust2_mini")
    return out


def packed(out, **what) -> io.BytesIO:
    buf = io.BytesIO()
    P.export_pack(out, buf, **what)
    buf.seek(0)
    return buf


def test_boards_and_team_travel(tmp_path):
    a, b = library(tmp_path, "a"), library(tmp_path, "b")
    first, second = B.create_board(a, board_sample()), B.create_board(a, board_sample(name="A exec"))
    T.save_team(a, team_sample())
    buf = packed(a, team=True)
    assert P.read_manifest(buf) | {"created": 0} == {"format": 1, "created": 0, "boards": 2, "team": True, "matches": []}

    result = P.import_pack(b, buf)
    assert result["boards"] == {"added": 2, "updated": 0, "skipped": 0}
    assert result["team"] == "added"
    assert B.load_board(b, first["id"]) == first and B.load_board(b, second["id"]) == second
    assert T.load_team(b)["members"] == T.load_team(a)["members"]

    # again: nothing is newer, and our roster is not replaced by a copy
    again = P.import_pack(b, packed(a, team=True))
    assert again["boards"] == {"added": 0, "updated": 0, "skipped": 2} and again["team"] == "kept"


def test_a_newer_board_wins_and_an_older_one_does_not(tmp_path):
    a, b = library(tmp_path, "a"), library(tmp_path, "b")
    made = B.create_board(a, board_sample())
    P.import_pack(b, packed(a))
    # edited at b later: a's copy must not undo it
    path = b / "boards" / f"{made['id']}.json"
    path.write_text(json.dumps(made | {"name": "edited at b", "updated": made["updated"] + 100}), encoding="utf-8")
    assert P.import_pack(b, packed(a))["boards"]["skipped"] == 1
    assert B.load_board(b, made["id"])["name"] == "edited at b"
    # and b's newer copy replaces a's
    assert P.import_pack(a, packed(b))["boards"]["updated"] == 1
    assert B.load_board(a, made["id"])["name"] == "edited at b"


def test_chosen_boards_only(tmp_path):
    a = library(tmp_path, "a")
    first = B.create_board(a, board_sample())
    B.create_board(a, board_sample())
    assert P.read_manifest(packed(a, boards=[first["id"]]))["boards"] == 1
    assert P.read_manifest(packed(a, boards=[]))["boards"] == 0
    with pytest.raises(P.PackError, match="no board"):
        packed(a, boards=["0" * 12])


def test_a_parsed_match_travels_without_the_demo_path(tmp_path, dust2_mini):
    a, b = library(tmp_path, "a", dust2_mini), library(tmp_path, "b")
    (a / "dust2_mini" / "replay").mkdir()
    (a / "dust2_mini" / "replay" / "round_1.v5.json.gz").write_bytes(b"cache")
    buf = packed(a, boards=[], matches=["dust2_mini"])
    names = zipfile.ZipFile(buf).namelist()
    assert "matches/dust2_mini/kills.parquet" in names and not any("replay/" in n or n.endswith(".dem") for n in names)

    result = P.import_pack(b, buf)
    assert result["matches"] == {"added": ["dust2_mini"], "skipped": []}
    assert (b / "dust2_mini" / "kills.parquet").read_bytes() == (dust2_mini / "kills.parquet").read_bytes()
    assert json.loads((b / "dust2_mini" / "manifest.json").read_text(encoding="utf-8"))["demo_path"] is None
    assert not list(b.glob(".pack-*"))
    assert P.import_pack(b, packed(a, boards=[], matches=["dust2_mini"]))["matches"] == {"added": [], "skipped": ["dust2_mini"]}
    with pytest.raises(P.PackError, match="no parsed match"):
        packed(a, matches=["nope"])


def zip_of(files: dict[str, bytes | str]) -> io.BytesIO:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in files.items():
            z.writestr(name, data)
    buf.seek(0)
    return buf


MANIFEST = json.dumps({"format": 1})


@pytest.mark.parametrize("files, word", [
    ({}, "not a Freezetime pack"),
    ({P.MANIFEST: json.dumps({"format": 99})}, "unsupported"),
    ({P.MANIFEST: MANIFEST, "matches/../evil/manifest.json": "{}"}, "unexpected file"),
    ({P.MANIFEST: MANIFEST, "matches/m/../../evil.parquet": "x"}, "unexpected file"),
    ({P.MANIFEST: MANIFEST, "matches/m/run.exe": "x"}, "unexpected file"),
    ({P.MANIFEST: MANIFEST, "matches/boards/manifest.json": "{}"}, "unexpected file"),
    ({P.MANIFEST: MANIFEST, "matches/m/kills.parquet": "x"}, "no manifest"),
    ({P.MANIFEST: MANIFEST, "matches/m/manifest.json": "[]"}, "not a match manifest"),
    ({P.MANIFEST: MANIFEST, "boards/0123456789ab.json": json.dumps({"map": "../x"})}, "bad map"),
    ({P.MANIFEST: MANIFEST, "team.json": json.dumps({"members": [{"nick": ""}]})}, "nick"),
])
def test_bad_packs_are_refused_and_leave_nothing(tmp_path, files, word):
    out = library(tmp_path, "out")
    with pytest.raises(P.PackError, match=word):
        P.import_pack(out, zip_of(files))
    assert not [p for p in out.rglob("*") if p.is_file()]
    assert not (tmp_path / "evil").exists() and not (tmp_path / "evil.parquet").exists()


def test_not_a_zip(tmp_path):
    with pytest.raises(P.PackError, match="not a zip"):
        P.import_pack(tmp_path, io.BytesIO(b"hello"))
