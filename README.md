# Freezetime

**English** | [Español](README.es.md) | [Русский](README.ru.md)

A Counter-Strike 2 demo analyzer. It parses `.dem` files into Parquet tables (via [awpy](https://github.com/pnxenopoulos/awpy) 3), computes team stats and tactics (T executes, CT setups and rotations), draws visualizations on top of the radar and provides a local web app with a 2D round replay.

![2D round replay](docs/replay.gif)

Features:

- **Demo parsing** — every awpy dataset, every game event, player snapshots every 0.5 s and replay frames every 4 ticks.
- **Team stats** — score, sides, buys, win reasons, openings, trades, plants and retakes.
- **Tactics** — which site the T side goes for, when the execute starts, which grenades are thrown and where, where the entry comes from; how the CT side sets up and how fast it rotates.
- **Multiple matches** — totals with recalculated percentages, breakdowns by map and player, team name merging (aliases).
- **Opponent (dossier)** — pick a team and a map: 5–7 insights with round counts and links into the replay, "zone × second" timings, a playbook of recurring strats, a heatmap across several matches, economy after the pistol round and after loss streaks, players (weapons, trades, starting positions), export to Markdown and PDF.
- **Map configs** — bombsite polygons and callouts for the whole competitive map pool, levels for multi-level maps.
- **App** (`freezetime app`) — a demo library with map and team filters, `.dem` and archive upload, deletion and background parsing; a match page; a 2D replay with player weapons and grenades, shot tracers and duel details when hovering over a death spot; 11 heatmap types (movement, deaths, kills, openings, shooting, damage, flashes, plants, grenades) with round time filters; every grenade throw as a lineup with export and an "Open in CS2" button; GIF/MP4 clips of a player or a team over selected rounds of one or several demos, with a caption and a text summary; match highlights; aggregate over several matches. Runs locally in the browser, no internet required.
- **Highlights** — aces, 4K/3K, won 1vN clutches, quick doubles and special kills (no-scope, wallbang, through smoke, knife, zeus) are found from the kill feed automatically; custom highlights are set by round and time window or with the "★ Highlight" button in the 2D replay and are stored in `highlights.json` next to the parsed match. Each one downloads as MP4/GIF zoomed in on the action with a kill feed; selected ones download as a single zip.
- **Auto-recording in CS2** — like clip services, but on your own PC: a running CS2 (current game versions ignore `-netconport`, so commands go through a cfg and a key: type `bind f13 "exec freezetime_cmd"` in the game console once, and the app detects the bind by itself) plays the demo from the player's point of view while ffmpeg records the screen (Desktop Duplication) or the CS2 window with a hardware encoder (NVENC/AMF/QSV, otherwise x264). It records the selected highlights or all kills of the chosen player: close kills within one round become one clip, and your Steam account is selected by default. Clips are trimmed exactly to the window, saved to `<parsed match>/recordings` and can be watched and downloaded right on the page. Requires `ffmpeg` in PATH (`winget install Gyan.FFmpeg`) or the `imageio-ffmpeg` package.
- **Recording via HLAE** — the "HLAE (with sound)" mode in the same panel: the app closes a running CS2 (after confirmation), launches the game via [HLAE](https://github.com/advancedfx/advancedfx) with `-insecure`, records clips with sound exactly by ticks (`mirv_cmd addAtTick`, `mirv_streams`) and closes the game (`quit`). No keys are pressed, the game can stay in the background, no bind or `gameinfo.gi` edits are needed. HLAE is installed with a button in the app from official releases with a SHA-256 check into `%LOCALAPPDATA%\freezetime-tools\hlae`. A game launched via HLAE cannot join VAC servers.
- **Pause cutting** — while recording, gaps between kills longer than a threshold (3 s by default) are removed: in "all kills" mode such kills become separate clips, while a highlight stays one video that jumps to the next kill, together with the sound.
- **Interface languages** — English, Russian and Spanish. English by default; if the browser or Windows language is Russian or Spanish, that language is used. The choice in the sidebar is remembered in the browser.
- **Tactics board** — draw a tactic on any pool map in up to 4 steps (default, utility, entry, post-plant): CT/T players and C4 dragged from the toolbar, 6 grenades with their real radius and a throw point, pencil, arrows, shapes and text stickers. Dragging a player on a later step records the route they walk, and playback animates the players along their routes. Undo/redo, rebindable hotkeys, saved tactics with a map filter, export to PNG (one step or all steps in a grid), GIF and MP4. The "To board" button in the replay copies the current moment (players with names, smokes, fires, the bomb), and the board can take you back to that moment.

| Match overview | Tactics | Maps |
|---|---|---|
| ![](docs/overview.png) | ![](docs/tactics.png) | ![](docs/maps.png) |

## Installation

### One command (Windows)

The [`install.ps1`](install.ps1) script installs everything needed: if missing — Git, Python 3.13 and Node.js LTS (via winget), then clones the project, creates `.venv`, builds the frontend, downloads awpy radars and puts a `freezetime` shortcut on the desktop. How to update an installed app — see [Updating](#updating).

```powershell
irm https://raw.githubusercontent.com/nfilatoff/freezetime/main/install.ps1 -OutFile install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

By default the project is installed to `%LOCALAPPDATA%\freezetime`; for another folder use `-InstallDir 'D:\freezetime'`. If you run the script from an already cloned repository, it uses that one. Switches: `-CheckOnly` (check only), `-SkipRadars`, `-NoShortcut`, `-Dev` (with pytest), `-Launch` (start after installing).

### Updating

**Coming from cs2lens.** The project used to be called cs2lens. The script updates an old install in `%LOCALAPPDATA%\cs2lens` in place, removes the old package, launcher and desktop shortcut, and moves HLAE from `cs2lens-tools` on first use. Parsed matches are kept. Old links to `github.com/nfilatoff/cs2lens` redirect to the new repository. In CS2, bind the key once more: `bind f13 "exec freezetime_cmd"`.

Close the app first: a running `freezetime` prevents the package from being reinstalled. Parsed matches, clips, settings and HLAE are not touched by an update.

**If you installed with the script.** Run `install.ps1` again from the folder you downloaded it to. It will run `git pull`, update dependencies and rebuild the app:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

If you passed `-InstallDir` during installation, pass the same folder here too. Don't have the file at hand — download it again with the first command from the section above.

**If you cloned the project manually.** The script run from the project folder does not update the code by itself, so pull the changes first and only then run it:

```powershell
git pull
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -SkipRadars -NoShortcut
```

`-SkipRadars` and `-NoShortcut` skip steps that are already done. The update follows the current branch: for a new version it must be `main`.

### Manually

You need Python 3.13 (≥ 3.11 works) and Node.js (≥ 20) to build the frontend.

```powershell
git clone https://github.com/nfilatoff/freezetime.git
cd freezetime
python -m venv .venv
.venv\Scripts\activate
pip install -e ".[dev]"          # freezetime + awpy, polars, matplotlib, typer, fastapi, uvicorn, zstandard; dev — pytest

cd frontend
npm install
npm run build                    # builds the frontend into freezetime/app/static
cd ..
```

awpy downloads radars and `map_data.json` once into `~/.awpy/<version>/` (the `awpy get` command or the first `awpy.plot` call). The app itself downloads nothing: if a radar isn't in the cache, an empty background is shown instead.

In the Windows console, set `$env:PYTHONIOENCODING = "utf-8"` for Cyrillic and special characters in the output.

### First run

```powershell
freezetime app                      # http://127.0.0.1:8000, the browser opens by itself
```

In "Library", add a folder with demos (for example, `D:\Steam\steamapps\common\Counter-Strike Global Offensive\game\csgo`) or upload files with the "Upload .dem or archive…" button or by dragging them onto the page. Demos from folders are parsed with the "Parse" button, uploaded ones right away. Parsing runs in the background with progress; a 250–300 MB demo is parsed in 20–30 s. Already parsed demos are not parsed again.

### Library

- **Filters** — by map (also for unparsed demos: the map is read from the `.dem` header in milliseconds), by team, and search by name. The "hide already parsed" checkbox removes demos that are already among the matches from the list.
- **Upload** — `.dem` or an archive: `zip`, `rar`, `7z`, `tar` (including `.tar.gz`/`.tgz`/`.tar.bz2`/`.tar.xz`), single `.dem.gz`, `.dem.bz2`, `.dem.xz`, `.dem.zst`. Files are uploaded one at a time with progress. The request body is written to `.part` and renamed only after the upload completes, so an interrupted upload won't show up as a demo. A file with the same name and size as one already in the library is not uploaded or parsed again.
- **Archives** are extracted by a background job: only `.dem` files are taken from the archive (nested folders are allowed, paths inside the archive can't escape `out/_uploads/`), the archive itself is deleted after extraction, and each demo is queued for parsing. `zip`, `tar`, `gz`, `bz2`, `xz` are read with the Python standard library, `.zst` with the `zstandard` package, `rar` and `7z` with the system `tar.exe` (bsdtar/libarchive, included in Windows 10+).
- **Deletion** — the cross on a match card deletes the parsed output (tables, replay cache, images); a checkbox in the dialog also deletes the source `.dem`. The "delete" link in the demo list deletes the `.dem` file. The API only deletes `.dem` files from library and upload folders; a match or demo currently being processed can't be deleted.

For outputs created before replay frames existed, the match card has a "replay data" button. It adds `replay.parquet` from the source demo in a few seconds. The replay works without it too, but with a 0.5 s step.

## CLI commands

```powershell
freezetime extract demo.dem [--out out] [--snapshot-seconds 0.5]
```
Parses a demo into `out/<demo name>/`.

```powershell
freezetime report  out\Mirage_ArenaPro_vs_LosTopos     # or a path to a .dem: parses it if not parsed yet
freezetime tactics out\Mirage_ArenaPro_vs_LosTopos
```
Team and tactics reports in Markdown: printed to the console and saved as `team_report.md` / `tactics_report.md` in the output folder.

```powershell
freezetime batch D:\demos\week1 out\Dust2ArenaPro_vs_teamSirena some.dem --name week1 --alias "team_dr1amwtf=Arena Pro Team"
```
Aggregate over several matches. Sources are `.dem` files, folders with `.dem` files or output folders. The result is `out/<name>/aggregate_report.md` and `*.parquet` tables. `--alias OLD=NEW` can be repeated.

```powershell
freezetime viz kills   out\<match> [--side t|ct] [--attacker]   # heatmap of death spots (or killer positions)
freezetime viz utility out\<match> [--side t|ct] [--team NAME]  # where grenades landed
freezetime viz frame   out\<match> 7 --sec 40                   # frame of round 7, 40 s after freeze time
freezetime viz gif     out\<match> 7 [--step-sec 0.5] [--fps 4] # GIF replay of a round (matplotlib)
freezetime viz zones   de_nuke                                  # map config over the radar + plants from out/
```
PNG/GIF files are saved to `out/<match>/viz/` (`viz zones` — to `out/maps/`). On multi-level maps (Nuke) two panels are drawn: upper and lower level.

```powershell
freezetime maps list                                           # maps with a config, levels, zone count
freezetime maps derive a.dem b.dem [--output path.json]        # build/update a map config from demos
```

```powershell
freezetime app [--out out] [--host 127.0.0.1] [--port 8000] [--no-open-browser]
```
Starts the web app.

Frontend development: `freezetime app --port 8000` in one window and `cd frontend; npm run dev` in another. Vite proxies `/api` to port 8000.

Tests: `pytest`. The fixture is rounds 1–8 of one Dust2 match, built by `tests/make_fixture.py`.

## Where data lives

| Path | Contents |
|---|---|
| `out/<demo>/` | Output of one demo (see below). |
| `out/<demo>/replay/round_<n>.v<k>.json.gz` | Per-round replay data cache; created the first time a round is opened (replay or clip). When the format (`k`) changes, old files are ignored. |
| `out/<demo>/viz/` | `freezetime viz` images. |
| `out/<name>/` | `freezetime batch` result. |
| `out/maps/` | `freezetime viz zones` renders. |
| `out/library.json` | App settings: demo folders, CS2 folder and network console port, team names (`team_aliases`), own team (`own_team`). |
| `out/boards/<id>.json` | Saved tactics boards. |
| `<CS2>/game/csgo/cfg/freezetime_*.cfg` | Lineups and practice lists written by the "Open in CS2" and "Install in CS2" buttons. |
| `out/_uploads/` | Demos uploaded through the app (and extracted from archives). |
| `~/.awpy/<version>/` | awpy cache: radars (`radars/*.png`) and `map_data.json` (coordinate transform, levels). |
| `freezetime/maps/<map>.json` | Map configs (in the repository). |

Demos, outputs and `node_modules` are not committed to git (see `.gitignore`).

### Output format

`out/<demo>/`:

- `manifest.json` — demo header (`header.map_name`, …), `tick_rate`, `demo_path`, `replay_every` and the row count of each table.
- awpy datasets: `rounds`, `kills`, `damages`, `shots`, `grenades` (grenade position at every tick of flight), `smokes`, `fires`, `blinds`, `bomb`, `item_events`, `players`, `stats`, `round_economy`, `chat`.
- `snapshots.parquet` — state of all players every 0.5 s: position, view angles, HP, armor, weapon, money, flags.
- `replay.parquet` — the same for the replay: every 4 ticks, only the needed columns.
- `events/<event>.parquet` — all game events as is (`weapon_fire`, `smokegrenade_detonate`, …). **All fields are strings.**

## Supported maps

CS2 Active Duty map pool as of **2026-10-30**: Ancient, Anubis, Cache, Dust II, Inferno, Mirage, Nuke. Cache replaced Overpass in July 2026, Anubis replaced Train in January 2026. Sources: [Wikipedia](https://en.wikipedia.org/wiki/List_of_competitive_Counter-Strike_maps), [neuralboost.gg](https://neuralboost.gg/blog/cs2-maps-every-pool-the-rotation-history-and-what-each-map-demands). All seven maps have a radar and `map_data` in the awpy-data release in use (2000935); Nuke also has a lower radar.

| Map | Config | How it was built | Validation |
|---|---|---|---|
| de_ancient | ✓ | `maps derive`, 1 demo | real demos: 14/14 plants inside their site's polygon |
| de_anubis | ✓ | `maps derive`, 2 demos | real demos: 31/31, incl. 19/19 on a demo not used for building |
| de_dust2 | ✓ | `maps derive`, 3 demos | real demos: 28/28 |
| de_inferno | ✓ | `maps derive`, 1 demo | real demos: 6/6 |
| de_mirage | ✓ | `maps derive`, 2 demos | real demos: 22/22 |
| de_cache | ✓ | `maps derive`, 1 demo; zone groups by hand; sites: radar outline + demo | real demo: 10/10 plants inside their site's polygon, but it's the same demo used for building |
| de_nuke | ✓ (2 levels) | `maps derive`, 1 demo; zone groups by hand; sites: radar outline + demo | real demo: 6/6 plants inside their site's polygon, but it's the same demo used for building |

Cache and Nuke zone groups were set by hand based on map geometry and on who reaches a zone and when, so some disputed zones are worth re-checking (on Nuke these are Control and Admin). Once there are more demos, the config can be rebuilt: `freezetime maps derive <all demos of the map>`. Groups are kept by zone name, and new zones will need to be filled in by hand. Site polygons are rebuilt from demos only, so check them with `freezetime viz zones`: a single demo covers a site only partially.

Maps outside the pool (Overpass, Train, Vertigo, …) have no config. `tactics` uses a fallback heuristic for them and prints a warning. Visualizations work on all maps that have a radar.

| Mirage (built from demos) | Nuke (from a demo, two levels) |
|---|---|
| ![](docs/zones_mirage.png) | ![](docs/zones_nuke.png) |

## Project structure

```
.dem ──extract──▶ out/<demo>/*.parquet ──context──▶ Match ──▶ team_stats ─┐
                                                        ├──▶ tactics ◀── maps (map configs)
                                                        ├──▶ replay  ├──▶ report (Markdown), viz (PNG/GIF)
                                                        └──▶ aggregate ┘──▶ app (FastAPI + React)
```

| Module | What it does |
|---|---|
| `extract.py` | `.dem` → Parquet: awpy datasets, events, snapshots, `replay.parquet`, `manifest.json`. `add_replay()` adds replay frames to old outputs. |
| `context.py` | `load_match()` builds the shared context. Rounds without knife rounds. steamid → team (without coaches). Team side in every round. The `tr` table (round × team: side, win, buy, opponent buy). Snapshot step and offset. `with_round()` binds rows with a `tick` to a round. `round_context()`: what happened before the round (pistol, loss streak, alive at plant and at the end). `with_man_diff()`: man advantage or disadvantage at the moment of an event. |
| `team_stats.py` | Summary, sides, buys, win reasons, openings, trades, bomb on T and CT. |
| `tactics.py` | T executes, CT setups, rotations. `SiteZoner` classifies positions by the map config or by the fallback heuristic. |
| `maps/` | Map configs (`<map>.json`) and their loading; finding the zone, group and site of a point via a raster. |
| `mapgen.py` | Builds a map config from demos (`maps derive`). |
| `aggregate.py` | Aggregation across matches, team aliases. |
| `scout.py` | Opponent dossier: per-round match tables (`match_data`), selecting a team's rounds (`select_rounds`), report and insights (`dossier`), similar rounds, teams with a shared roster. |
| `replay.py` | Round replay document (JSON, gzip cache). |
| `board.py` | Tactics boards: checking, storing and listing `out/boards/<id>.json`. |
| `viz.py` | Images over the radar (matplotlib via `awpy.plot`), per-level panels. |
| `report.py` | Markdown reports. |
| `cli.py` | `freezetime` commands. |
| `app/server.py`, `app/jobs.py` | FastAPI: library (upload, delete), background queue (extraction, parsing, replay frames), match, replay, map and aggregate API, serving the frontend. Doesn't duplicate analysis — calls the modules above. |
| `app/archives.py` | Extracting `.dem` files from uploaded archives. |
| `lineups.py` | Grenade throws as lineups: position, aim, technique, landing; console commands and practice configs. |
| `app/cs2.py` | CS2 link: finding the game folder, writing `.cfg`, network console (`-netconport`), launching via Steam. |
| `frontend/` | React + TypeScript + Vite. The replay and clips are drawn on Canvas 2D. |
| `frontend/src/replayDraw.ts` | Shared by replay and clips: round cache, interpolation, player state with inventory, player icon, tracers, death crosses, grenades. |
| `frontend/src/board.ts`, `pages/Board.tsx` | Tactics board: model (steps, tokens with routes, marks), drawing, playback, replay frame → board; the editor page. |
| `frontend/src/components/ClipView.tsx`, `clipExport.ts` | Clip builder, frame layout, GIF (gifenc) and MP4 (WebCodecs + mp4-muxer) encoding, zip (fflate). |
| `frontend/src/clipSummary.ts`, `zones.ts` | Clip facts: zone of a point (by map config), caption and text file. |
| `frontend/src/heat.ts`, `components/MapsView.tsx` | Heatmap: accumulation on a 256×256 grid, blur, palettes, modes and filters. |
| `frontend/src/components/LineupsView.tsx` | Lineups: grouping throws, map, table, export, CS2 buttons. |
| `frontend/src/pages/Scout.tsx`, `components/InsightCards.tsx`, `scoutExport.ts` | "Opponent" page: context panel, report tabs, insight cards, export. |

### App: how the replay works

The backend assembles a round into one JSON document:

- a shared tick grid (4-tick step);
- per-player arrays: `x`, `y`, `z`, `yaw`, `hp`, `armor`, active weapon, bomb, kit, defuse;
- inventory: the moments it changes and its contents (primary, pistol, each grenade separately — two flashes give two entries); taken from 0.5 s snapshots;
- grenade trajectories with the thrower (the player closest to the first point);
- smokes and molotovs with their real lifetimes;
- flashes, bomb events;
- firearm shots: shooter, position, view direction and, if the shot hit, the position of the wounded player (damage in `damages` falls on the same tick as the shot);
- kills with duel details: damage and hit count in both directions over the round, killer HP after the kill, victim weapon, finishing hit, distance, time since first hit, assist, trades.

The document is cached compressed (60–90 KiB per round). A loaded match stays in server memory, so a cold round build takes about 0.1 s (20 rounds — under 2 s), a repeated load about 10 ms; the next round is preloaded. The client interpolates positions and view angles between frames.

What's on the map:

- **Player** — a circle in the side's color, an HP bar, a name. View cone: a gradient, bright edges and a white crosshair line. With the "weapons" checkbox (off by default so the icon isn't cluttered), the active weapon and colored equipment dots are shown under the icon: smoke (gray), flash (white), HE (red), molotov/incendiary (orange), decoy, bomb (red square), kit (green square); a grenade in hand is outlined in white. A red outline means the player has the bomb, a yellow flash means they're shooting.
- **Shot** — a tracer from the shooter: if the bullet hit, the line goes to the wounded player and ends with a red dot; if not, a ~900-unit ray along the view direction with an arrow that fades toward the end. The "shots" checkbox.
- **Death spot** — a cross in the victim side's color. On hover a duel card is shown (who, whom, with what, headshot/wallbang/through smoke/blinded, damage and hits in both directions, killer HP, victim weapon, distance, duration, assist, trades), and on the map — the killer's position and the shot line. A click rewinds to the start of the duel.
- Side panels — HP, armor, money, weapons (active one highlighted) and grenades of every player.

Replay controls:

| Key | Action |
|---|---|
| Space | play/pause |
| ← / → | frame back/forward |
| Shift + ← / → | ±5 s |
| ↑ / ↓ | speed (0.25×–8×) |
| N / P | next/previous kill |
| [ / ] | previous/next round |
| Home | end of freeze time |
| 1 / 2 / 3 | upper / lower / both levels (on Nuke) |

The link `#/match/<match>/replay/<round>/<second>` opens a round at the given moment.

### App: GIF/video clips

The "Clips" page (and the "Player clip" match tab, where that match is already selected) builds a video of one player or a whole team over selected rounds — from one or several demos of the same map.

- **Demos** — a map and checkboxes for the matches on that map; matches are numbered `M1`, `M2`… in the order selected.
- **Who to show** — a player (recognized by steamid across all demos; in parentheses — how many of the selected demos they played in) or a whole team (each player gets their own color).
- **Rounds** — filters by side (T by default), outcome and buy (full buy, force, eco, pistols) select rounds in all matches at once; per-match chips add or remove individual rounds (border — side, bold number — win).
- **How to show**: *overlay* — all rounds at once on a shared round timer; *sequential* — rounds one after another.
- **Window** — from which to which second after freeze time (empty — until the end of the longest round).
- **Layers** — paths, "where they look", shooting (tracers), grenades and C4, kills and deaths, other players (faint dots), grid.

The frame is laid out like this:

- **Header** — `player · side · main zone` (for example `dr1amwtf · T · Top of Mid`), below it the team, map, buy filter and opponents ("FUT Esports · Dust2 · full buy vs Team Vitality"), the number of overlaid rounds; on the right the round clock and "alive N/M · speed 2×".
- **Radar** with an A–P × 1–16 grid (for conversations like "stood at H15"). The player is a dot in the side's color with a line toward where they look, without weapons or equipment. A red dot is their kill (at the victim's spot), a white cross is their death; grenade spots: smoke — gray circle, molotov — orange, flash — white ring, HE — yellow ring, C4 plant — pink square.
- **Caption** — assembled by code, without a neural network, using the map's zone config (`freezetime/maps/<map>.json`): the player's most stable position (a zone outside spawn where they most often are at the same round time) and regular grenades (type and landing zone, median time, in at least 20% of rounds, at most three). Example: "Outside Tunnel at 1:50 in 5 of 10. Flash Lower Tunnel ~1:45 (2 of 10), molotov Short Stairs ~1:23 (2 of 10)". Maps without a zone config get no caption. In team mode — only grenades.
- **Legend** of the symbols.

**Export** — always a zip archive with two files:

- `<player>_<map>_<side>_<N>r_<mode>.mp4` or `.gif`. Frames are drawn one by one at the set rate (1 s of video = speed × 1 s of game), so the result doesn't depend on computer speed. **MP4** — WebCodecs (H.264, otherwise VP9 or AV1) and `mp4-muxer`, the software encoder is tried first; requires Chrome/Edge 94+ or Firefox 130+. **GIF** — `gifenc`, one shared palette for the whole video; GIF doesn't compress between frames, so the default is 512 px and 10 fps.
- `<same name>.txt` (UTF-8) — everything you need to write a caption in your own words and send it to the team chat: player, team, map, side, buy, opponents and matches; window and outcomes; the code-generated caption; position every 5 s (top zones and how many rounds alive); all grenades by type and zone with median time and round count; kills and deaths (time, from → to, weapon, headshot, trade); C4 plants; a line per round. The same text is shown under the export button ("Chat description").

### App: maps (heatmap)

The "Maps" match tab. Modes:

| Mode | What's on the map | Point weight |
|---|---|---|
| movement | positions of alive players, 16 times per second (`replay.parquet`; without it — 0.5 s snapshots); the server computes density on a 256×256 grid | time |
| where they died / where they killed from | victim / killer positions | 1 |
| first kills / first deaths | the same for the first cross-team kill of the round | 1 |
| where they shot from | shooter position for every bullet (no knife or grenades) | 1 |
| where they took damage / where they dealt damage from | wounded / attacker positions | damage |
| where they got flashed / where they flashed from | players blinded by an opponent / flash throwers | blind duration |
| plants | bomb plant spots | 1 |
| grenades | where a grenade went off (dots by type) | — |
| AWP zoom | where a sniper scoped in (`weapon_zoom` event, AWP and SSG 08; clicks less than 2 s apart count as one) | 1 |

Filters: team, side, player, weapon (for kills, shooting and damage — for example, AWP only), round range and round time ("whole round" — from the end of freeze time, "with freeze time", 0–20 s, 20–45 s, 45–75 s, 75+ s or custom bounds). Context: team buy, enemy buy, round after a lost or won pistol, man advantage, equal or disadvantage by alive players at the moment of the event. Display: blur radius, palette (fire, green, ice, red), logarithmic scale (rare spots are visible too) or linear (only the most frequent), opacity, dots on top, map zones. Clicking a dot opens its round in the replay.

### App: position names

The "positions" toggle overlays zone names from the map config onto the radar: in the replay, Heatmap, lineups and player starting positions. Three modes: off, names, names and zone borders. The mode is shared and remembered in the browser. In the clip builder it's a separate layer, because it ends up in the final video; its look follows the shared mode, and when the shared mode is off the layer draws names and borders. Highlight videos have no names. The "Positions" page shows all pool maps without demos and has its own toggle; hovering a name in the list highlights the zone in any mode. The names are the same ones the game shows next to the player on the radar (`m_szLastPlaceName`).

### App: tactics board

The "Board" page (`#/board`, `freezetime/board.py`, `frontend/src/board.ts`, `pages/Board.tsx`) is a whiteboard on the map radar for drawing a tactic and showing it to the team.

- **Steps** — up to 4: default, utility, entry, post-plant (double-click to rename). Grenades, drawings and texts belong to one step; the "previous step" checkbox shows the step before faded.
- **Players and the bomb** — drag CT, T or C4 from the toolbar onto the map (a click drops it in the middle). A player keeps their position on the next steps until moved. Dragging a player on steps 2–4 records the way they walk: that is their route, drawn as a dotted line with an arrow. "Clear path" makes it straight again, "Stay put" keeps the player where they were. Double-click renames a player.
- **Grenades** — smoke, molotov, incendiary, flashbang, HE and decoy are drawn with the radius the replay uses (smoke 144 units, fire 110). A selected grenade has an orange handle: drag it to where the grenade is thrown from, and the throw is drawn as an arc.
- **Drawing** — pencil (5 colours, 3 widths), arrow (Shift snaps to 45°), rectangle and ellipse (Shift makes a square or a circle), text sticker, eraser. Right click deletes whatever is under the cursor.
- **Multi-level maps** — on Nuke both levels are shown side by side (or one of them); a player can be dragged from one level to the other.
- **Playback** — "Play" (Space) holds each step and walks the players along their routes to the next one; the step's utility fades in.
- **Hotkeys** — V select, P pencil, A arrow, R rectangle, C ellipse, T text, E eraser, Space play, O previous step, Q/W step back/forward, 1–4 steps, Ctrl+Z / Ctrl+Shift+Z undo/redo, Del delete. The tool keys can be rebound in "Hotkeys" and are remembered in the browser.
- **Saving** — "Save" writes `out/boards/<id>.json` (format version inside), "Update" overwrites the loaded tactic, "Save as new" makes a copy. The list on the right shows the tactics of the map (or all maps). An unsaved board survives a page reload.
- **Export** — PNG of the current step or of all steps in a grid with a caption, GIF or MP4 of the playback (good for Discord).
- **From the replay** — "⧉ To board" in the replay copies the current moment to step 1: alive players with names and sides, smokes, fires and the bomb. "Board" opens an empty board of the same map. Both remember the moment, and "◀ Back to replay" returns to the same round and second.

### App: opponent (dossier)

The "Opponent" page: team, map, last N matches, side and round type are chosen once in the top panel and apply to all tabs. The selection is stored in the address (`#/scout/<team>/<map>/<tab>?last=&side=&buy=&rounds=`), so a link opens exactly the same view. Quick picks: last 10 pistols, full buys, force buys or ecos.

| Tab | Contents |
|---|---|
| Summary | Insights: favorite site, main strat, pace, main grenade, weak player, behavior after a lost pistol, CT setup. Each has a round count and links to example rounds; fewer than 5 rounds is marked "little data". Tables are hidden under "show data". |
| Timings | A "zone × second" grid (5 s step) of the team's grenades and first entries; clicking a cell shows the rounds. |
| Playbook | T rounds grouped into strats: one site and mostly the same smokes and molotovs (set similarity at least 0.5), at least 2 rounds. Below — all rounds and a search for similar ones across the whole library on this map. |
| Heatmap | The same modes as in a match, over the selected rounds of all matches. |
| Economy | Round after the pistol, buy by loss streak, wins by side and buy, site by round type. |
| Players | ADR, K/D, openings, trade rate, distance to the nearest teammate during the first minute of the round, weapons; where the player is at second 15 and which zones they never visit. |
| Grenades, Clips | Lineups and the clip builder with the team's matches already selected. |

**Team.** In a demo a team is named after its clan tag or captain (`team_<nick>` on FACEIT), so one team can have many names. On the "Opponent" page they can be given one name ("Team names…"); it's stored in `library.json`. The app itself suggests merging names with three or more shared players. The star next to a team marks it as your own: an "Us" item appears in the menu.

**Last matches.** The demo header has no date, so the order is taken from the demo file time, and if there's no file, from the parse time. For a demo uploaded through the browser this is the upload time, not the game time.

**Export.** The MD button downloads the dossier in Markdown, the PDF button opens the browser print dialog with a separate version of the page without the interface.

### App: grenades, lineups and CS2

The "Grenades and lineups" match tab and the "Lineups" page (throws from several demos of the same map). The approach to lineups and CS2 commands is taken from [cs2-meta-engine](https://github.com/Twoos123/cs2-meta-engine).

- **Throw** (`freezetime/lineups.py`) — a grenade `weapon_fire` from `shots`: the thrower's feet position, pitch/yaw at the moment of the throw, grenade type. A trajectory from `grenades` is matched to it that starts no later than 32 ticks after, of the same type and closest to the thrower (in 9 demos 3339 of 3349 throws were matched, 99.7%). This gives the spot where the grenade stopped and the time until it stopped.
- **Technique** — from replay frames around the throw: feet more than 8 units above ground before the throw — jump, speed above 170 units/s — run, above 40 — walk, otherwise standing (`jump`, `run + jump`, `running`, `walking`, `standing`). For jump throws the lineup stores the ground height they jumped from. Crouching isn't detected: it isn't in the replay frames.
- **Lineup** — a group of throws of the same grenade from positions within 64 units, with a view angle within ±8° and landing within 160 units. The group's representative is the throw closest to the others. "From" and "to" zones come from the map config.
- **Filters** — type, side, team, player, technique, landing zone, minimum number of throws in a lineup.
- **Map** — landing spots (size — number of throws), lines from the throw spot; clicking selects a lineup and shows all its throws, the position and the view direction.

**Export**:

- **CSV** (UTF-8 with BOM, opens in Excel) and **JSON** — all filtered throws: match, round, time, player, team, side, type, technique, zones, throw and landing coordinates, pitch/yaw, flight time and a ready console command.
- **.cfg** — a practice config: one throw per lineup, the `]` / `[` keys switch lineups, and the name is printed to the console on switching. At the top — local server settings: `sv_cheats 1`, infinite grenades, trajectory preview (`sv_grenade_trajectory_prac_pipreview 1`), 60-minute round, no freeze time, no bots.
- **Install in CS2** — the same config is written straight into `game/csgo/cfg` (`freezetime_<name>.cfg`); **Run list** loads the map and runs `exec`.

**Open in CS2** (`freezetime/app/cs2.py`) puts the player at the throw position: loads the map on a local server, enables practice settings, teleports (`setpos`), aims (`setang`) and gives the grenade (`give`, `use`).

- The game folder is found automatically — via the Steam registry and `libraryfolders.vdf`; it can be set manually in the "CS2" panel.
- Current CS2 versions ignore `-netconport`, so commands go through a key: type `bind f13 "exec freezetime_cmd"` in the game console once, and the app detects the bind in the game's saved keys. Commands are written to `cfg/freezetime_cmd.cfg` and run by pressing F13. Binds don't work in the main menu, so loading a demo types `exec freezetime_cmd` into the console by itself; the console must be closed beforehand. Keys are sent as messages straight to the game window (the game doesn't accept `SendInput`: Windows refuses it) and are sent only while the game window is in the foreground. `con_logfile` isn't available in the game: the game can confirm commands only with `-condebug` (writes `csgo/console.log`); without it the app uses measured pauses and reloads the map or demo on every click (about 30 s), because it doesn't know where the player is now. With `-condebug` a repeated click on the same map or demo works immediately. Recording has no sound.
- If CS2 isn't running, the browser opens it via `steam://run`; Steam asks to confirm the launch options. Without a configured link the game will only open the map or demo; the other commands have nowhere to go.
- **Copy command** — a `sv_cheats 1; setpos …; setang …; give …; use …` line for the console, if you don't need the network console.
- **demo in CS2** on each throw opens the source demo (`playdemo`) 5 s before the throw and switches the camera to the thrower (`spec_player`). Works if the demo is inside the game folder (for example, in `game/csgo`).
- Don't press these buttons during a matchmaking match: changing the map will disconnect you from the game.

## Methodology

All thresholds are constants at the top of the modules; change them there.

**Rounds.** Knife rounds are excluded. A row belongs to a round if its tick lies within `[start_tick, end_tick]` (`with_round`). Ticks between rounds are dropped. If the demo recording started in the middle of the first round, its `start_tick` is empty and replaced with 0.

**Sides.** A team's side in a round is the majority over its players' snapshots in that round. The team is `team_clan_name` from `players`. Coaches — `stats` rows with no kills, deaths, assists or damage — are excluded from players and averages.

**Trades and openings.** The `is_trade` and `victim_traded` flags come from awpy: a kill that avenged a teammate within 5.25 s. An opening is the first cross-team kill of the round.

**Map zones.** Each config zone belongs to a group:
- `A` / `B` — the site and CT positions around it (for example, Jungle and Stairs on Mirage);
- `A_approach` / `B_approach` — T paths to the site;
- `mid`, `t_spawn`, `ct_spawn`.

A point is looked up among the polygons of its level (by `z`). If zones overlap, the smaller one wins. Points within 64 units of a zone are assigned to the nearest one (`maps/__init__.py`: `CELL`, `SNAP`).

**How a config is built from demos** (`mapgen.py`):
- **Callouts.** Every player position is labeled by the game with a nav place name (`m_szLastPlaceName`). Positions are binned into 32-unit cells separately for each level. A cell gets its most frequent place. Small holes are filled, islands removed. Outlines are built with marching squares and simplified (`CELL`, `MIN_SAMPLES`, `MIN_CELLS`, `SIMPLIFY`).
- **Sites.** The `m_bInBombZone` flag (the same as `func_bomb_target`) is set only for T. A site is the convex hull of a cluster of such points. Plants of that site are added to it, and the hull is expanded by `ZONE_PAD` = 40 units. The site letter comes from the plants inside, otherwise from the place name.

**T executes** (`tactics.py`).
- A grenade counts if it landed in a zone of group `A`/`B`. A grenade in CT spawn counts toward the nearest site: these are CT smokes.
- **Target site** — the plant site; without a plant — the site where the most T grenades landed by the end of the round.
- **Execute start** — the first T grenade on the target site.
- **Pace** — by the start time from the end of freeze time: earlier than `EARLY_SEC` = 30 s — early, from 30 to `LATE_SEC` = 60 s — mid, later — late.
- **Package** — grenades onto the plant site from the execute start until the plant.
- **`entry`** — which zones alive T players were in at the execute start. If there's no start — `PACKAGE_SEC` = 25 s before the plant.
- **`package_zones`** — which callouts the package grenades landed in.
- **Who threw.** Grenades in these demos have an empty `thrower_*`. The thrower is restored like this: `events/weapon_fire.userid` is matched row by row with `shots.steamid` (`userid_map`). A molotov is bound to the last `grenade_thrown` no earlier than 6 s before ignition.

**CT setups.**
- Positions of alive CTs are taken `SETUP_SEC` = 15 s after freeze time or at the moment of first contact, if earlier. First contact is the first damage to an opponent.
- A CT in group `A` or `A_approach` counts as an A player, in `B` / `B_approach` as a B player, the rest as mid.
- Example record: `A2 B2 M1`.

**CT rotations** (rounds with a plant).
- The reference point is the execute start, otherwise the plant minus `PACKAGE_SEC`.
- Rotators are CTs who at that moment aren't in the plant site's group.
- A rotator has "arrived" when they first appear in the site's group before the end of the round.
- Computed: average number of rotators and arrivals (including before the plant), average rotation time and the percentage of retakes won.

**Fallback heuristic** — for maps without a config; a warning is printed when it's used.
- Site centers are the average plant positions in the demo, so at least one plant on each site is needed.
- "On site" — closer than `SITE_RADIUS` = 0.20 of the A–B distance.
- "Holding a site" — closer than `DEFEND_RADIUS` = 0.40 of the A–B distance.
- Tuned on de_anubis.

**Aggregation.** Counters are summed, percentages and ratios are recalculated from the sums. Averages (ADR, plant time, …) are weighted by their denominator. One demo added twice gives doubled counters and the same percentages (a test checks this). Tactics are always split by map.

## Limitations and data quirks

- **Grenades without a thrower.** `grenades`/`smokes`/`fires` have an empty `thrower_*`; the thrower is restored (see "T executes"). If `weapon_fire` and `shots` don't match row by row, tactics and the grenade map are unavailable for the match: the CLI shows an error, the app shows a message.
- **Empty `start_tick` of the first round** in some demos (recording started during the round) — replaced with 0.
- **Events store fields as strings**; `x`/`y`/`z` are cast to numbers.
- **Snapshots** come at a 0.5 s step (`Match.snap_step`, 32 ticks at 64 tick). In some demos snapshot ticks start at 1, not 0 (`Match.snap_offset`); previously this left setups, rotations and `viz frame/gif` empty on such demos.
- **Parsing progress.** awpy doesn't report progress inside parsing, so it's shown by stages. The first stage ("parsing demo") is the longest.
- **Sites built from demos are based on player positions**, so the edge of the plant zone can be off by up to ~40 units. Sites where T players rarely stand come out smaller than they really are.
- **Cache and Nuke aren't validated on demos**: names and borders of auxiliary zones may be inaccurate.
- **Grenade thrower in the replay** — the closest alive player to the first point of the trajectory (up to 120 units). Throws right next to a teammate can be mixed up. This also decides which grenades end up in a player's clip.
- **A miss tracer** doesn't know about walls: a fixed-length ray shows the shot direction, not where the bullet hit. A hit tracer is exact (up to the wounded player).
- **Inventory** comes from snapshots at a 0.5 s step: a thrown grenade may disappear from the icon with a delay of up to 0.5 s.
- **`rar` and `7z`** are extracted with the system `tar.exe` (bsdtar). Without it (Windows older than 10, Linux without `bsdtar`), such archives won't upload — extract them manually or use `zip`.
- **MP4** requires WebCodecs. In a browser without them the MP4 button is disabled and GIF remains.
- **Lineups**: the position is the thrower's feet at the moment of the throw (for a jump — the ground before the jump), so for running and jump throws the start point shows where the grenade left the hand, and you have to repeat the run-up yourself. Throw strength (left/right button) and crouching aren't detected.
- **CS2 network console** was tested on an emulator: commands, order, waiting for the `CS2_GAME_UI_STATE_INGAME` line after loading a map. If the game doesn't print this line, the commands go out after 90 s of waiting.
- **Coaches** are detected by a zero row in `stats`; a coach who actually played rounds counts as a player.

## License

Freezetime is source-available, not open source. You may read the code and run the unmodified app for non-commercial
purposes (for yourself or your team). Commercial use, modification, copying, redistribution and derivative works are
not allowed without the author's written permission. See [LICENSE](LICENSE) for the full terms.
