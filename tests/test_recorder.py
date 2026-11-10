"""The recorder runs one HLAE session at a time (the session itself: test_hlae.py)."""
import threading

import pytest

from freezetime.app import recorder as rec
from freezetime.app.cs2 import CS2Bridge
from tests.test_lineups import _wait

ffmpeg = rec.find_ffmpeg()
pytestmark = pytest.mark.skipif(ffmpeg is None, reason="ffmpeg is not installed")


def clip():
    return rec.Clip(round=1, start=0, end=5, tick=1, player=None, title="x", kind="kills")


def test_screen_and_window_capture_are_gone():
    assert not hasattr(rec, "capture_command")
    assert "capture" not in rec.Recorder.start.__code__.co_varnames


def test_cancel_and_one_session_at_a_time(tmp_path, monkeypatch):
    launched = threading.Event()

    def fake_session(_hlae, _game, _demo, _clips, _cfgs, _w, _h, _running, _on_log, cancelled):
        launched.set()
        _wait(cancelled, 10)  # the game would be killed here
        return ""

    monkeypatch.setattr(rec.hlae, "run_session", fake_session)
    monkeypatch.setattr(rec.hlae, "configure_ffmpeg", lambda *_a: None)
    monkeypatch.setattr(rec, "user_cvars", lambda: {})
    game = tmp_path / "csgo"
    (game / "cfg").mkdir(parents=True)
    settings = {}
    r = rec.Recorder(CS2Bridge(settings.get, settings.__setitem__))
    assert r.start("m", tmp_path / "rec", "d", game, tmp_path / "HLAE.exe", [clip()], 30, False) == {"steam_url": None}
    assert launched.wait(10)
    with pytest.raises(RuntimeError, match="already running"):
        r.start("m", tmp_path / "rec", "d", game, tmp_path / "HLAE.exe", [clip()], 30, False)
    r.cancel()
    _wait(lambda: r.state["status"] != "running", 10)
    assert r.state["status"] == "cancelled" and r.state["files"] == []
    assert not (tmp_path / "rec" / "_hlae").exists()
