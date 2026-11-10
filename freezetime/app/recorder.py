"""Automatic clip recording through HLAE: the game renders the frames and the sound itself.

``hlae.py`` starts CS2 with HLAE's hook and schedules every take on demo ticks; this module runs
one such session at a time, keeps its state for the app, encodes with the first working H.264
encoder (hardware when there is one) and cuts long pauses between kills out of each take.
Clips go to ``<extract>/recordings`` with an index for the gallery.

Screen and window capture of an open game were removed: they depended on the window being in
front and on timing over the console, while HLAE starts and ends every take on its exact tick.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from freezetime.app import hlae
from freezetime.app.cs2 import CS2Bridge, game_running, user_cvars
from freezetime.highlights import keep_ranges

PREROLL = 1.0  # seconds before the clip window that the game plays so the view settles (not recorded)
# What is on the screen besides the game, with the value the game has by default. Set to the hide
# value for a recording, then back to the player's own value (see overlay_commands).
OVERLAYS = {  # name: (hide, default)
    "cl_draw_only_deathnotices": ("1", "0"),
    "spec_show_xray": ("0", "1"),
    "r_show_build_info": ("0", "1"),
    "cl_trueview_show_status": ("0", "2"),
    "cl_hud_telemetry_frametime_show": ("0", "2"),
    "cl_hud_telemetry_net_misdelivery_show": ("0", "2"),
    "cl_hud_telemetry_ping_show": ("0", "2"),
}
INDEX = "recordings.json"
ENCODERS = ["h264_nvenc", "h264_amf", "h264_qsv", "libx264"]  # tried in this order
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
QUALITY = {
    "h264_nvenc": ["-preset", "p4", "-rc", "vbr", "-cq", "21", "-b:v", "0"],
    "h264_amf": ["-quality", "balanced", "-rc", "cqp", "-qp_i", "20", "-qp_p", "22"],
    "h264_qsv": ["-global_quality", "22"],
    "libx264": ["-preset", "veryfast", "-crf", "20"],
}


def find_ffmpeg() -> str | None:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:  # optional: pip install imageio-ffmpeg ships a binary
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except (ImportError, RuntimeError):
        return None


_encoder_cache: dict[str, str | None] = {}


def pick_encoder(ffmpeg: str) -> str | None:
    """The first H.264 encoder that really works here (a hardware one is listed only if its driver is present)."""
    if ffmpeg not in _encoder_cache:
        found = None
        for enc in ENCODERS:
            r = subprocess.run(
                [ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=s=256x256:d=0.2",
                 "-frames:v", "1", "-c:v", enc, "-pix_fmt", "nv12" if enc != "libx264" else "yuv420p", "-f", "null", "-"],
                capture_output=True, creationflags=NO_WINDOW, timeout=30,
            )
            if r.returncode == 0:
                found = enc
                break
        _encoder_cache[ffmpeg] = found  # only once known: status requests come in while this runs
    return _encoder_cache[ffmpeg]


@dataclass
class Clip:
    round: int
    start: float  # seconds after the freeze end
    end: float
    tick: int  # demo tick of start - PREROLL: the game seeks here and settles before the take
    player: str | None  # name for spec_player
    title: str
    kind: str
    steamid: str | None = None
    rate: float = 64.0  # ticks per second
    kill_secs: list[float] = field(default_factory=list)  # seconds after the freeze end
    cut_gap: float | None = None  # pauses between kills longer than this are cut out

    def ranges(self) -> list[tuple[float, float]]:
        return keep_ranges(self.start, self.end, self.kill_secs, self.cut_gap)

    @property
    def start_tick(self) -> int:
        return self.tick + round(PREROLL * self.rate)

    @property
    def end_tick(self) -> int:
        return self.start_tick + round((self.end - self.start) * self.rate)


def safe_name(text: str) -> str:
    return re.sub(r"[^\w.+-]+", "_", text, flags=re.UNICODE).strip("_")[:90] or "clip"


def load_index(folder: Path) -> list[dict]:
    p = folder / INDEX
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []
    except ValueError:
        return []


def save_index(folder: Path, items: list[dict]) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    tmp = folder / (INDEX + ".tmp")
    tmp.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(folder / INDEX)


def cut_video(ffmpeg: str, encoder: str, path: Path, ranges: list[tuple[float, float]]) -> None:
    """Keep only ``ranges`` of the video, joined into one. Cutting anywhere needs a new encode;
    the sound, if any, follows the picture exactly."""
    if len(ranges) < 2:
        return
    probe = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path)], capture_output=True, text=True, errors="ignore", creationflags=NO_WINDOW)
    sound = "Audio:" in probe.stderr
    parts, labels = [], ""
    for i, (a, b) in enumerate(ranges):
        parts.append(f"[0:v]trim={a}:{b},setpts=PTS-STARTPTS[v{i}]")
        labels += f"[v{i}]"
        if sound:
            parts.append(f"[0:a]atrim={a}:{b},asetpts=PTS-STARTPTS[a{i}]")
            labels += f"[a{i}]"
    parts.append(f"{labels}concat=n={len(ranges)}:v=1:a={int(sound)}" + ("[v][a]" if sound else "[v]"))
    tmp = path.with_name(f"_cut_{path.name}")
    subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(path), "-filter_complex", ";".join(parts), "-map", "[v]",
         *(["-map", "[a]", "-c:a", "aac", "-b:a", "192k"] if sound else []),
         "-c:v", encoder, *QUALITY[encoder], "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(tmp)],
        check=True, creationflags=NO_WINDOW, timeout=600,
    )
    tmp.replace(path)


class Cancelled(Exception):
    pass


def overlay_commands(saved: dict[str, str]) -> tuple[list[str], list[str]]:
    """Commands that clear the screen for a recording, and those that put the player's settings back."""
    hide = [f"{name} {value}" for name, (value, _) in OVERLAYS.items()]
    restore = [f"{name} {saved.get(name, default)}" for name, (_, default) in OVERLAYS.items()]
    return hide, restore


class Recorder:
    """One recording session at a time; its state is polled by the app."""

    def __init__(self, bridge: CS2Bridge) -> None:
        self.bridge = bridge
        self.state: dict = {"status": "idle"}
        self._cancel = threading.Event()
        self._lock = threading.Lock()

    def running(self) -> bool:
        return self.state.get("status") == "running"

    def cancel(self) -> None:
        self._cancel.set()

    def start(self, match_id: str, folder: Path, playdemo: str, game_dir: Path, hlae_exe: Path, clips: list[Clip], fps: int, clean: bool, width: int = 1920, height: int = 1080) -> dict:
        """Record through HLAE: starts the game itself and closes it when the clips are done."""
        ffmpeg = find_ffmpeg()
        if ffmpeg is None:
            raise RuntimeError("ffmpeg not found: install it (winget install Gyan.FFmpeg) or pip install imageio-ffmpeg")
        encoder = pick_encoder(ffmpeg)
        if encoder is None:
            raise RuntimeError("no working H.264 encoder in this ffmpeg")
        with self._lock:
            if self.running():
                raise RuntimeError("a recording is already running")
            self._cancel.clear()
            self.state = {
                "status": "running", "match_id": match_id, "i": 0, "n": len(clips), "phase": "launch",
                "encoder": encoder, "files": [], "error": None, "started": time.time(),
            }
        args = (ffmpeg, encoder, folder, playdemo, game_dir, hlae_exe, clips, fps, clean, width, height)
        threading.Thread(target=self._run, args=args, daemon=True, name="freezetime-hlae").start()
        return {"steam_url": None}

    def _run(self, ffmpeg, encoder, folder: Path, playdemo, game_dir, hlae_exe, clips: list[Clip], fps, clean, width, height) -> None:
        folder = folder.resolve()
        work = folder / "_hlae"  # absolute: the game resolves a relative path against its own folder
        try:
            with self.bridge._io:
                self.bridge.claim()
                self.bridge.loaded = None
                hlae.configure_ffmpeg(hlae_exe, ffmpeg)
                _, restore = overlay_commands(user_cvars())
                hide = overlay_commands({})[0] if clean else []
                # HLAE pipes yuv420p into any encoder; the same quality options are used for cutting
                encoder_args = ["-c:v", encoder, *QUALITY[encoder], "-pix_fmt", "yuv420p"]
                done = 0
                for batch in hlae.session_batches(clips):
                    shutil.rmtree(work, ignore_errors=True)
                    work.mkdir(parents=True)
                    self._phase("launch")
                    cfgs = hlae.session_cfgs(batch, work, encoder_args, fps, hide, restore if clean else [])

                    def on_log(text: str, base: int = done) -> None:
                        # the game logs "execing <cfg>" for every scheduled step (an echo in them is not logged)
                        started = re.findall(rf"execing {hlae.CFG_PREFIX}_(\d+)_rec", text)
                        if started:
                            self.state.update(i=base + int(started[-1]) + 1, phase="record")
                        elif f"execing {hlae.CFG_PREFIX}_start" in text:
                            self.state.update(i=base + 1, phase="seek")
                        elif self.state.get("phase") == "launch" and text:
                            self.state.update(phase="loading")

                    hlae.run_session(hlae_exe, game_dir, playdemo, batch, cfgs, width, height, game_running, on_log, self._cancel.is_set)
                    if self._cancel.is_set():
                        raise Cancelled
                    self._phase("finish")
                    for k, clip in enumerate(batch):
                        out = self._new_path(folder, clip)
                        if not hlae.mux_take(ffmpeg, work / f"clip{k}", out):
                            raise RuntimeError("cs2_hlae_no_video")
                        cut_video(ffmpeg, encoder, out, clip.ranges())
                        self.state["files"].append(self._index(folder, clip, out))
                    done += len(batch)
            self.state.update(status="done", phase="done", finished=time.time())
        except Cancelled:
            self.state.update(status="cancelled", phase="cancelled", finished=time.time())
        except (OSError, RuntimeError, subprocess.SubprocessError) as e:
            self.state.update(status="error", error=str(e), finished=time.time())
        finally:
            shutil.rmtree(work, ignore_errors=True)

    @staticmethod
    def _new_path(folder: Path, clip: Clip) -> Path:
        name = safe_name(f"R{clip.round}_{clip.title}")
        out = folder / f"{name}.mp4"
        for k in range(2, 1000):
            if not out.exists():
                break
            out = folder / f"{name}_{k}.mp4"
        return out

    @staticmethod
    def _index(folder: Path, clip: Clip, out: Path) -> str:
        items = load_index(folder)
        items.append({
            "file": out.name, "title": clip.title, "kind": clip.kind, "round": clip.round, "steamid": clip.steamid,
            "seconds": round(sum(b - a for a, b in clip.ranges()), 1), "size": out.stat().st_size, "created": int(time.time()),
        })
        save_index(folder, items)
        return out.name

    # ---- the session ----
    def _phase(self, phase: str, **kw) -> None:
        self.state.update(phase=phase, **kw)
        if self._cancel.is_set():
            raise Cancelled
