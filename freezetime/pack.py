"""Packs: a ``.zip`` to hand team work to somebody without a server.

A pack holds any of: tactics boards, the team profile, notes, playlists, playbooks and whole parsed matches
(the Parquet tables, never the ``.dem``, the replay cache or recordings). Layout::

    freezetime-pack.json            {"format": 1, "created": ..., "boards": n, "matches": [...], ...}
    boards/<id>.json
    team.json
    notes.json
    playlists.json
    playbook.json
    matches/<match id>/manifest.json, *.parquet, events/*.parquet, highlights.json

Importing merges and never destroys: a board, note or playlist replaces the local one of the
same id only when it is newer; a match that is already parsed stays as it is; the team profile
is taken only while there is no local roster. A pack comes from somebody else's computer, so
every name in it is checked against what a pack may contain before anything is written.
"""

from __future__ import annotations

import json
import re
import shutil
import time
import zipfile
from pathlib import Path
from typing import BinaryIO

from freezetime import board as boards_mod
from freezetime import notes as notes_mod
from freezetime import playlists as playlists_mod
from freezetime import playbook as playbook_mod
from freezetime.team import TeamError, load_team, save_team, team_path

FORMAT = 1
MANIFEST = "freezetime-pack.json"
MAX_FILES = 5000
MAX_JSON = 8 << 20  # one JSON member, unpacked
MAX_TABLE = 1 << 30  # one Parquet member, unpacked
MATCH_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ +()-]{0,150}$")
MATCH_FILE_RE = re.compile(r"^(manifest\.json|highlights\.json|[A-Za-z0-9_]+\.parquet|events/[A-Za-z0-9_]+\.parquet)$")
RESERVED = {boards_mod.DIR, "_uploads", "matches"}


class PackError(ValueError):
    """A file that is not a pack we can read: the message says why."""


def _match_dir(out: Path, match_id: str) -> Path | None:
    d = out / match_id
    ok = MATCH_ID_RE.fullmatch(match_id) and ".." not in match_id and match_id not in RESERVED
    return d if ok and (d / "manifest.json").is_file() else None


def export_pack(
    out: str | Path, target: str | Path | BinaryIO, *, boards: list[str] | None = None, team: bool = False,
    notes: bool = False, playlists: bool = False, playbook: bool = False, matches: list[str] | tuple[str, ...] = (),
) -> dict:
    """Write a pack; ``boards=None`` takes every board, ``[]`` none. Returns its manifest."""
    out = Path(out)
    board_ids = [b["id"] for b in boards_mod.list_boards(out)] if boards is None else list(boards)
    info: dict = {"format": FORMAT, "created": int(time.time()), "boards": 0, "team": False, "notes": 0, "playlists": 0, "playbook": 0, "matches": []}
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        for board_id in board_ids:
            b = boards_mod.load_board(out, board_id)
            if b is None:
                raise PackError(f"no board {board_id}")
            z.writestr(f"boards/{board_id}.json", json.dumps(b, ensure_ascii=False))
            info["boards"] += 1
        if team and team_path(out).exists():
            z.writestr("team.json", json.dumps(load_team(out), ensure_ascii=False))
            info["team"] = True
        if notes:
            found = notes_mod.load_notes(out)
            z.writestr("notes.json", json.dumps(found, ensure_ascii=False))
            info["notes"] = len(found)
        if playlists:
            found = playlists_mod.load_playlists(out)
            z.writestr("playlists.json", json.dumps(found, ensure_ascii=False))
            info["playlists"] = len(found)
        if playbook:
            try:
                found = playbook_mod.load_playbook(out)
            except playbook_mod.PlaybookError as e:
                raise PackError(str(e)) from e
            z.writestr("playbook.json", json.dumps(found, ensure_ascii=False, separators=(",", ":")))
            info["playbook"] = len(found["entries"]) + len(found["books"])
        for match_id in matches:
            d = _match_dir(out, match_id)
            if d is None:
                raise PackError(f"no parsed match {match_id}")
            for p in sorted([*d.glob("*.parquet"), *d.glob("events/*.parquet"), d / "manifest.json", d / "highlights.json"]):
                rel = p.relative_to(d).as_posix()
                if not p.is_file() or not MATCH_FILE_RE.fullmatch(rel):
                    continue
                name = f"matches/{match_id}/{rel}"
                if rel == "manifest.json":
                    # the path of the demo on the sender's disk means nothing elsewhere
                    manifest = json.loads(p.read_text(encoding="utf-8")) | {"demo_path": None}
                    z.writestr(name, json.dumps(manifest, indent=2))
                else:
                    z.write(p, name, compress_type=zipfile.ZIP_DEFLATED if rel.endswith(".json") else zipfile.ZIP_STORED)
            info["matches"].append(match_id)
        z.writestr(MANIFEST, json.dumps(info, indent=2))
    return info


def _json(z: zipfile.ZipFile, name: str):
    if z.getinfo(name).file_size > MAX_JSON:
        raise PackError(f"{name} is too big")
    try:
        return json.loads(z.read(name).decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as e:
        raise PackError(f"{name} is not JSON") from e


def read_manifest(source: str | Path | BinaryIO) -> dict:
    try:
        with zipfile.ZipFile(source) as z:
            return _manifest(z)
    except zipfile.BadZipFile as e:
        raise PackError("not a zip file") from e


def _manifest(z: zipfile.ZipFile) -> dict:
    if MANIFEST not in z.namelist():
        raise PackError("not a Freezetime pack (no freezetime-pack.json)")
    info = _json(z, MANIFEST)
    if not isinstance(info, dict) or info.get("format") != FORMAT:
        raise PackError(f"unsupported pack format {info.get('format') if isinstance(info, dict) else info!r}")
    if len(z.infolist()) > MAX_FILES:
        raise PackError("too many files in the pack")
    return info


def import_pack(out: str | Path, source: str | Path | BinaryIO) -> dict:
    """Merge a pack into ``out``; returns what was added, updated and left alone."""
    out = Path(out)
    try:
        z = zipfile.ZipFile(source)
    except zipfile.BadZipFile as e:
        raise PackError("not a zip file") from e
    with z:
        _manifest(z)
        names = [i.filename for i in z.infolist() if not i.is_dir()]
        result: dict = {
            "boards": {"added": 0, "updated": 0, "skipped": 0}, "team": None,
            "notes": {"added": 0, "updated": 0, "skipped": 0}, "playlists": {"added": 0, "updated": 0, "skipped": 0},
            "playbook": {"added": 0, "updated": 0, "skipped": 0},
            "matches": {"added": [], "skipped": []},
        }
        for name in names:
            m = re.fullmatch(r"boards/([0-9a-f]{12})\.json", name)
            if not m:
                continue
            try:
                result["boards"][boards_mod.import_board(out, _json(z, name) | {"id": m.group(1)})] += 1
            except boards_mod.BoardError as e:
                raise PackError(f"{name}: {e}") from e
        if "team.json" in names:
            if load_team(out)["members"]:
                result["team"] = "kept"  # ours is not overwritten by somebody's copy
            else:
                try:
                    save_team(out, _json(z, "team.json"))
                except TeamError as e:
                    raise PackError(f"team.json: {e}") from e
                result["team"] = "added"
        if "notes.json" in names:
            try:
                result["notes"] = notes_mod.merge_notes(out, _json(z, "notes.json"))
            except notes_mod.NoteError as e:
                raise PackError(f"notes.json: {e}") from e
        if "playlists.json" in names:
            try:
                result["playlists"] = playlists_mod.merge_playlists(out, _json(z, "playlists.json"))
            except playlists_mod.PlaylistError as e:
                raise PackError(f"playlists.json: {e}") from e
        if "playbook.json" in names:
            try:
                result["playbook"] = playbook_mod.merge_playbook(out, _json(z, "playbook.json"))
            except playbook_mod.PlaybookError as e:
                raise PackError(f"playbook.json: {e}") from e

        by_match: dict[str, list[tuple[str, str]]] = {}
        for name in names:
            parts = name.split("/", 2)
            if parts[0] != "matches":
                continue
            if len(parts) != 3 or not MATCH_ID_RE.fullmatch(parts[1]) or ".." in parts[1] or parts[1] in RESERVED or not MATCH_FILE_RE.fullmatch(parts[2]):
                raise PackError(f"unexpected file in the pack: {name}")
            by_match.setdefault(parts[1], []).append((name, parts[2]))
        for match_id, files in by_match.items():
            target = out / match_id
            if target.exists():
                result["matches"]["skipped"].append(match_id)
                continue
            if "manifest.json" not in {rel for _, rel in files}:
                raise PackError(f"match {match_id} has no manifest.json")
            # unpack beside the library and move in whole: a broken pack leaves no half a match
            tmp = out / f".pack-{match_id}"
            shutil.rmtree(tmp, ignore_errors=True)
            try:
                for name, rel in files:
                    info = z.getinfo(name)
                    if info.file_size > (MAX_JSON if rel.endswith(".json") else MAX_TABLE):
                        raise PackError(f"{name} is too big")
                    dest = tmp / rel
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    with z.open(info) as src, dest.open("wb") as dst:
                        shutil.copyfileobj(src, dst, 1 << 20)
                manifest = json.loads((tmp / "manifest.json").read_text(encoding="utf-8"))
                if not isinstance(manifest, dict) or "header" not in manifest:
                    raise PackError(f"match {match_id}: manifest.json is not a match manifest")
                tmp.replace(target)
            except (ValueError, OSError) as e:
                shutil.rmtree(tmp, ignore_errors=True)
                raise e if isinstance(e, PackError) else PackError(f"match {match_id}: {e}") from e
            result["matches"]["added"].append(match_id)
    return result
