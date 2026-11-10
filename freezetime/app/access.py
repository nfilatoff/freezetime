"""Who is asking and what they may do: the rules of the team server (``freezetime app --team``).

Without ``--team`` the app is one person's tool: it answers its own computer and nobody else.
With it, the analyst's computer serves the whole team over the LAN (or Tailscale, ZeroTier):

- a request from this computer is the analyst: everything is allowed;
- anyone else needs the team token (it travels in the link's ``#fragment``, so it is in no server
  log; the page trades it for a cookie) and says who they are by picking a nick from the roster.
  There are no passwords: the token keeps strangers out, the nick says who wrote a note;
- staff (analyst, coach, manager, IGL) may change shared things: upload and parse demos, save
  boards, edit the team. Players look, write notes and keep playlists;
- the game, the recorder and the server's own folders answer this computer only: nobody presses
  keys in somebody else's CS2 or walks the analyst's disk from across the network.

Everything here is plain data in, verdict out; ``server.py`` wires it into a middleware.
"""

from __future__ import annotations

import ipaddress
import re
import secrets
import socket
from dataclasses import dataclass

TOKEN_COOKIE = "ft_token"
MEMBER_COOKIE = "ft_member"
TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
STAFF_ROLES = {"analyst", "coach", "manager", "igl"}

# What only this computer may touch, whatever the method.
LOCAL_ONLY = ("/api/cs2", "/api/recorder", "/api/hlae", "/api/library/folders", "/api/extract", "/api/demos", "/api/session/token")
# Changes every signed-in member may make: their own notes and playlists, and saying who they are.
MEMBER_WRITES = ("/api/notes", "/api/playlists", "/api/session")
# POST requests that only read.
READ_POSTS = ("/api/aggregate", "/api/pack/export", "/api/playbook/discover")
# Reachable without the token: enough for the page to ask for it.
OPEN = ("/api/session", "/api/system")


def new_token() -> str:
    return secrets.token_urlsafe(18)


def is_local(host: str | None) -> bool:
    """A request from this computer itself (loopback), not merely from the same network."""
    if not host:
        return False
    if host == "localhost":
        return True
    try:
        addr = ipaddress.ip_address(host.split("%")[0])
    except ValueError:
        return False
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return addr.is_loopback


@dataclass(frozen=True)
class Who:
    """The sender of a request, as far as the rules care."""

    local: bool
    token_ok: bool  # presented the team token (always true for this computer)
    member: dict | None  # the roster entry they picked: {"id", "nick", "role", ...}

    @property
    def role(self) -> str | None:
        """``analyst`` (this computer), ``staff``, ``player``, or None while not let in."""
        if self.local:
            return "analyst"
        if not self.token_ok or self.member is None:
            return None
        return "staff" if self.member.get("role") in STAFF_ROLES else "player"

    @property
    def can_edit(self) -> bool:
        return self.role in ("analyst", "staff")

    @property
    def need(self) -> str | None:
        """What is missing before a remote visitor is let in: ``token``, then ``member``."""
        if self.local:
            return None
        if not self.token_ok:
            return "token"
        return "member" if self.member is None else None


def identify(host: str | None, cookies: dict[str, str], token: str | None, members: list[dict]) -> Who:
    """``token`` is the team token, or None when the server does not run in team mode."""
    local = is_local(host)
    presented = cookies.get(TOKEN_COOKIE) or ""
    token_ok = local or bool(token and presented and secrets.compare_digest(presented.encode(), token.encode()))
    member = next((m for m in members if m["id"] == cookies.get(MEMBER_COOKIE)), None) if token_ok else None
    return Who(local, token_ok, member)


def _under(path: str, prefixes: tuple[str, ...]) -> bool:
    return any(path == p or path.startswith(p + "/") for p in prefixes)


def verdict(who: Who, method: str, path: str, team_mode: bool) -> tuple[int, str] | None:
    """None when the request may go on, else the HTTP status and a reason code."""
    if who.local or not path.startswith("/api/"):
        return None  # the page itself (static files) holds no data
    if _under(path, OPEN):  # also without team mode, so the page can say why it shows nothing
        if path == "/api/session/token":
            return 403, "access_this_computer"
        return None
    if not team_mode:
        return 403, "access_local_only"
    if not who.token_ok:
        return 401, "access_token"
    if who.member is None:
        return 401, "access_member"
    if _under(path, LOCAL_ONLY):
        return 403, "access_this_computer"
    if method in ("GET", "HEAD", "OPTIONS") or _under(path, READ_POSTS) or _under(path, MEMBER_WRITES):
        return None
    return None if who.can_edit else (403, "access_staff")


def lan_addresses() -> list[str]:
    """IPv4 addresses of this computer that others may reach it by: the default route's first."""
    found: list[str] = []
    try:  # no packet is sent: connecting a UDP socket only picks the outgoing interface
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            found.append(s.getsockname()[0])
    except OSError:
        pass
    try:
        found += [info[4][0] for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)]
    except OSError:
        pass
    out = []
    for ip in found:
        if ip not in out and not is_local(ip) and not ip.startswith("169.254."):
            out.append(ip)
    return out
