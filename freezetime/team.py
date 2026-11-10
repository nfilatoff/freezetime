"""Our team's profile: its name and roster (nick, SteamID, role), stored in ``out/team.json``.

The profile says who "we" are for everything built for a team: names on the tactics board,
"my tasks", notes addressed to a player, signing in to the team server. The file::

    {
      "format": 1,
      "name": "Our Team",              # as in the demos (after aliases), or any name before the first demo
      "members": [
        {"id": "a1b2c3d4", "nick": "alpha", "steamid": "76561198000000001", "role": "igl"},
        {"id": "e5f6a7b8", "nick": "coach", "steamid": "", "role": "coach"}
      ],
      "updated": 1767225600
    }

``steamid`` is a string (64-bit ids don't survive JavaScript numbers) and may be empty: a coach
or an analyst is not in the demos. Nicks are unique without regard to case, because people are
picked by nick. ``id`` stays the same when a member is renamed, so what refers to a member
keeps pointing at them.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path

FORMAT = 1
FILE = "team.json"
MAX_MEMBERS = 20
NAME_LEN = 60
NICK_LEN = 32
PLAYER_ROLES = ("igl", "entry", "awp", "lurker", "support", "anchor", "rifler")
STAFF_ROLES = ("coach", "analyst", "manager")
ROLES = (*PLAYER_ROLES, *STAFF_ROLES)
STEAMID_RE = re.compile(r"^7656\d{13}$")  # SteamID64 of an individual account
ID_RE = re.compile(r"^[0-9a-f]{8}$")


class TeamError(ValueError):
    """A profile that cannot be saved: the message says why."""


def team_path(out: str | Path) -> Path:
    return Path(out) / FILE


def _text(v, limit: int) -> str:
    return " ".join(str(v or "").split())[:limit]


def empty_team() -> dict:
    return {"format": FORMAT, "name": "", "members": [], "updated": 0}


def check_team(team: dict) -> dict:
    """The parts of a profile we store, checked; raises TeamError."""
    if not isinstance(team, dict):
        raise TeamError("a team profile is an object")
    fmt = team.get("format", FORMAT)
    if fmt != FORMAT:
        raise TeamError(f"unsupported team format {fmt!r}")
    members = team.get("members", [])
    if not isinstance(members, list) or not all(isinstance(m, dict) for m in members):
        raise TeamError("members is a list of objects")
    if len(members) > MAX_MEMBERS:
        raise TeamError(f"a team has at most {MAX_MEMBERS} members")
    out, nicks, steamids, ids = [], set(), set(), set()
    for m in members:
        nick = _text(m.get("nick"), NICK_LEN)
        if not nick:
            raise TeamError("every member needs a nick")
        if nick.casefold() in nicks:
            raise TeamError(f"two members are called {nick!r}")
        nicks.add(nick.casefold())
        steamid = str(m.get("steamid") or "").strip()
        if steamid and not STEAMID_RE.fullmatch(steamid):
            raise TeamError(f"{nick}: {steamid!r} is not a SteamID64 (17 digits starting with 7656)")
        if steamid and steamid in steamids:
            raise TeamError(f"SteamID {steamid} is listed twice")
        steamids.add(steamid)
        role = str(m.get("role") or "")
        if role and role not in ROLES:
            raise TeamError(f"{nick}: unknown role {role!r}")
        member_id = str(m.get("id") or "")
        if not ID_RE.fullmatch(member_id) or member_id in ids:
            member_id = uuid.uuid4().hex[:8]
        ids.add(member_id)
        out.append({"id": member_id, "nick": nick, "steamid": steamid, "role": role})
    return {"format": FORMAT, "name": _text(team.get("name"), NAME_LEN), "members": out}


def load_team(out: str | Path) -> dict:
    """The saved profile, or an empty one; a broken file reads as empty rather than breaking the app."""
    path = team_path(out)
    if not path.exists():
        return empty_team()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return check_team(data) | {"updated": int(data.get("updated", 0))}
    except (ValueError, TypeError, OSError):
        return empty_team()


def save_team(out: str | Path, team: dict) -> dict:
    data = check_team(team) | {"updated": int(time.time())}
    path = team_path(out)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)
    return data


def rename_team(out: str | Path, name: str | None) -> dict | None:
    """Follow a change of "our team" made elsewhere; nothing is written while there is no profile."""
    if not team_path(out).exists():
        return None
    return save_team(out, load_team(out) | {"name": name or ""})


def candidates(matches: list[dict], team: str, aliases: dict[str, str], members: list[dict]) -> list[dict]:
    """Players seen playing for ``team`` who are not on the roster yet, the most frequent first.

    ``matches`` are ``{"teams": [raw names], "players": [{"steamid", "name", "team"}], "date"}``,
    newest first; a player's name is the one from their latest match.
    """
    listed = {m["steamid"] for m in members if m.get("steamid")}
    seen: dict[str, dict] = {}
    for match in matches:
        ours = {raw for raw in match["teams"] if aliases.get(raw, raw) == team}
        for p in match["players"]:
            sid = str(p.get("steamid") or "")
            if p.get("team") not in ours or not sid or sid in listed:
                continue
            e = seen.setdefault(sid, {"steamid": sid, "nick": p.get("name") or sid, "matches": 0})
            e["matches"] += 1
    return sorted(seen.values(), key=lambda e: (-e["matches"], e["nick"].lower()))
