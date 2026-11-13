import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type BoardMark, type BoardPos, type MatchOverview, type Note, type Replay, type ReplayPlayer, type TimelineRound } from "../api";
import { go } from "../router";
import { PEN_COLORS, PEN_WIDTHS, boardFromFrame, drawMarks, emptyBoard, hitTest, newId, startMark, stashDraft, strayMark, stretchMark } from "../board";
import { useFitHeight } from "../fit";
import { CT_COLOR, RADAR_SIZE, T_COLOR, levelLabel, levelOf, panelLevels, sideColor, sideShort, useMapAssets, worldToPx } from "../radar";
import {
  BOMB_TIME, NO_VIEW, attackerBlind, ROUND_TIME, bombState, drawRound, fmtClock, fmtMoney, frameAt, killAt, loadReplay, panBy, playerStates, throwAt, toRadar, weaponName, zoomAt,
  type PlayerState, type View,
} from "../replayDraw";
import { useCalloutMode } from "../callouts";
import { reasonLabel, t, td, type Key } from "../i18n";
import { buyLabel } from "../clipSummary";
import { CalloutToggle } from "./CalloutToggle";
import { ToolIcon } from "./Icons";
import { NadeIcon } from "./NadeIcon";
import { FeedIcon, WeaponIcon } from "./WeaponIcon";
import { KillCard } from "./KillCard";
import { shareUrl } from "../share";
import { NoteForm, RoundNotes, StarForm } from "./ReplayExtras";

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
const KILLFEED_SEC = 6;
const NOTE_MS = 3500;

// Sketching over the replay: the board's marks, kept in radar px so they stay put between rounds.
type SketchTool = "pen" | "arrow" | "eraser";
const SKETCH_TOOLS: [SketchTool, Key][] = [["pen", "board.tool.pen"], ["arrow", "board.tool.arrow"], ["eraser", "board.tool.eraser"]];
type Stroke = { mark: BoardMark | null; origin: [number, number]; start: BoardMark[] }; // mark null: erasing

const num = (v: number) => String(Math.round(v * 10) / 10);
/** Console line that puts you where somebody stood, looking the same way. */
const setpos = (x: number, y: number, z: number, pitch: number, yaw: number) =>
  `setpos ${num(x)} ${num(y)} ${num(z)}; setang ${num(pitch)} ${num(yaw)} 0`;

// ---- component ----
const ZOOM_STEP = 1.2; // per wheel notch
const PAN_START_PX = 4; // a press that moves less is a click

export function ReplayView({ match, round, at, until, onEnd, autoplay, onPrev, onNext }: {
  match: MatchOverview;
  round: number;
  at?: number;
  until?: number | null; // stop here (seconds after the freeze end) and call onEnd: playlist playback
  onEnd?: () => void;
  autoplay?: boolean;
  // playlist playback: [ and ] (and the arrow buttons) go to the previous / next item instead of the match's rounds
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const { assets, error: mapError } = useMapAssets(match.map);
  const [data, setData] = useState<Replay | null>(null);
  const [loadMs, setLoadMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [view, setView] = useState<number | "all">("all");
  const [opts, setOpts] = useState({ names: true, weapons: false, trails: true, shots: true, flashMarks: true, damage: true, spotted: true });
  const [zoom, setZoom] = useState<View>(NO_VIEW); // the same for every round of the match
  const [zoomLocked, setZoomLocked] = useState(false);
  const pan = useRef<{ x: number; y: number; from: View; moved: boolean } | null>(null);
  const panned = useRef(false); // the click that ends a drag does nothing
  const [hold, setHold] = useState<"back" | "fast" | null>(null); // Q held: play backwards, E held: twice as fast
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const callouts = useCalloutMode();
  const [hover, setHover] = useState<{ kill: number; x: number; y: number } | null>(null);
  const [hoverPlayer, setHoverPlayer] = useState<string | null>(null);
  const [hoverThrow, setHoverThrow] = useState<{ g: number; x: number; y: number } | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [tool, setTool] = useState<SketchTool>("pen");
  const [color, setColor] = useState(PEN_COLORS[1]);
  const [marks, setMarksState] = useState<BoardMark[]>([]);
  const marksRef = useRef(marks);
  const past = useRef<BoardMark[][]>([]);
  const stroke = useRef<Stroke | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [panel, setPanel] = useState<"note" | "star" | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const loadNotes = useCallback(() => {
    api.notes({ match: match.id }).then((d) => setNotes(d.notes)).catch(() => {});
  }, [match.id]);
  useEffect(loadNotes, [loadNotes]);
  const roundNotes = notes.filter((n) => n.round === round);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const noteTimer = useRef(0);
  const [uiTick, setUiTick] = useState(0);
  const tickRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(800);

  const rounds = match.timeline.map((r) => r.round);
  const roundIdx = rounds.indexOf(round);
  const prevRound = () => {
    if (onPrev) onPrev();
    else if (roundIdx > 0) go("match", match.id, "replay", rounds[roundIdx - 1]);
  };
  const nextRound = () => {
    if (onNext) onNext();
    else if (rounds[roundIdx + 1] !== undefined) go("match", match.id, "replay", rounds[roundIdx + 1]);
  };

  useEffect(() => {
    setData(null);
    setHoverPlayer(null);
    setError(null);
    const t0 = performance.now();
    loadReplay(match.id, round)
      .then((r) => {
        setLoadMs(Math.round(performance.now() - t0));
        tickRef.current = r.freeze_end_tick + (at ?? -1) * r.tick_rate;
        setUiTick(tickRef.current);
        setData(r);
        if (autoplay) setPlaying(true);
        const next = rounds[roundIdx + 1];
        if (next !== undefined) loadReplay(match.id, next).catch(() => {});
      })
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id, round]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- sketch ----
  const setMarks = useCallback((next: BoardMark[]) => {
    marksRef.current = next; // erasing reads it again before the next render
    setMarksState(next);
  }, []);
  const commitMarks = useCallback((next: BoardMark[], from: BoardMark[]) => {
    if (next === from) return;
    past.current.push(from);
    if (past.current.length > 200) past.current.shift();
    setMarks(next);
  }, [setMarks]);
  const undoMark = useCallback(() => {
    const prev = past.current.pop();
    if (prev) setMarks(prev);
  }, [setMarks]);
  const clearMarks = useCallback(() => commitMarks([], marksRef.current), [commitMarks]);
  useEffect(() => {
    // another map: the drawings mean nothing there
    past.current = [];
    setMarks([]);
  }, [match.map, setMarks]);

  const flash = useCallback((text: string) => {
    setNote(text);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(null), NOTE_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(noteTimer.current), []);
  const copy = useCallback(
    (text: string) => {
      // without clipboard access the line is still shown, to be copied by hand
      navigator.clipboard.writeText(text).then(() => flash(t("replay.copied", { text })), () => flash(text));
    },
    [flash],
  );

  const levels = assets ? panelLevels(assets.meta, assets.meta.levels.length > 1 ? view : 0) : [0];
  const fit = useFitHeight(canvasRef, ".replay");
  const size = Math.max(240, Math.min(Math.floor(boxWidth / levels.length), fit));

  const render = useCallback(() => {
    const c = canvasRef.current;
    if (!c || !assets || !data) return;
    const ctx = c.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawRound(ctx, assets, data, tickRef.current, levels, size, {
      ...opts, callouts: callouts !== "off", hoverKill: hover?.kill ?? -1, throwPoints: true, hoverThrow: hoverThrow?.g ?? -1, hoverPlayer: hoverPlayer ?? undefined, view: zoom,
    });
    const draft = stroke.current?.mark;
    drawMarks(ctx, assets.meta, draft ? [...marksRef.current, draft] : marksRef.current, levels, size, zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, data, size, levels.join(","), opts, callouts, hover?.kill, hoverThrow?.g, hoverPlayer, marks, zoom]);

  useEffect(render, [render, uiTick]);

  // playback loop
  useEffect(() => {
    if ((!playing && !hold) || !data) return;
    let raf = 0, last = performance.now(), lastUi = 0;
    const stop = until != null ? Math.min(data.last_tick, data.freeze_end_tick + until * data.tick_rate) : data.last_tick;
    const rate = (hold === "back" ? -1 : 1) * (hold === "fast" ? 2 : 1) * speed;
    const frame = (now: number) => {
      tickRef.current += ((now - last) / 1000) * data.tick_rate * rate;
      last = now;
      if (hold === "back" && tickRef.current <= data.start_tick) {
        tickRef.current = data.start_tick;
        render();
        setUiTick(tickRef.current);
        return; // stays at the start while Q is held
      }
      if (tickRef.current >= stop) {
        tickRef.current = stop;
        setPlaying(false);
        render();
        setUiTick(stop);
        onEndRef.current?.();
        return;
      }
      render();
      if (now - lastUi > 66) {
        setUiTick(tickRef.current);
        lastUi = now;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, hold, speed, data, render, until]);

  const seek = useCallback(
    (t: number) => {
      if (!data) return;
      tickRef.current = Math.max(data.start_tick, Math.min(data.last_tick, t));
      setUiTick(tickRef.current);
    },
    [data],
  );

  const stepFrame = useCallback(
    (dir: number) => {
      if (!data) return;
      setPlaying(false);
      const [i, f] = frameAt(data.ticks, tickRef.current);
      const target = dir > 0 ? Math.min(i + 1, data.ticks.length - 1) : f > 0 ? i : Math.max(i - 1, 0);
      seek(data.ticks[target]);
    },
    [data, seek],
  );

  const jumpKill = useCallback(
    (dir: number) => {
      if (!data) return;
      const now = tickRef.current;
      const lead = 2 * data.tick_rate; // land a little before the kill
      const list = dir > 0 ? data.kills.filter((k) => k.tick - lead > now + 1) : data.kills.filter((k) => k.tick - lead < now - 1).reverse();
      if (list[0]) seek(list[0].tick - lead);
    },
    [data, seek],
  );

  // death crosses and throw points under the pointer
  const onStageMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!assets || !data || drawing) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left, y = e.clientY - box.top;
    const panel = Math.floor(x / size);
    const li = levels[panel];
    if (li === undefined) {
      setHover(null);
      setHoverPlayer(null);
      return setHoverThrow(null);
    }
    const k = size / RADAR_SIZE;
    const multi = assets.meta.levels.length > 1;
    const P = (wx: number, wy: number) => worldToPx(assets.meta, wx, wy);
    const [rx, ry] = toRadar(zoom, k, x - panel * size, y);
    const s = 1 / (k * zoom.z);
    const i = killAt(data.kills, tickRef.current, P, rx, ry, s, (kill) => !multi || levelOf(assets.meta, kill.vz) === li);
    setHover(i >= 0 ? { kill: i, x, y } : null);
    const g = i >= 0 ? -1 : throwAt(data, tickRef.current, P, rx, ry, s, (z) => !multi || levelOf(assets.meta, z) === li);
    setHoverThrow(g >= 0 ? { g, x, y } : null);
    // a living player under the pointer: who sees whom
    let near: string | null = null, best = (12 * s) ** 2;
    if (i < 0 && g < 0) {
      for (const st of playerStates(data, tickRef.current)) {
        if (st.hp <= 0 || Number.isNaN(st.x) || (multi && levelOf(assets.meta, st.z) !== li)) continue;
        const [px, py] = P(st.x, st.y);
        const d = (px - rx) ** 2 + (py - ry) ** 2;
        if (d < best) { best = d; near = st.p.steamid; }
      }
    }
    setHoverPlayer(near);
  };
  const onStageClick = () => {
    if (panned.current) {
      panned.current = false;
      return;
    }
    if (drawing || !data) return;
    const thrown = hoverThrow && data.grenades[hoverThrow.g]?.throw;
    if (thrown) return copy(setpos(thrown.x, thrown.y, thrown.z, thrown.pitch, thrown.yaw));
    if (!hover) return;
    const kill = data.kills[hover.kill];
    setPlaying(false);
    seek(Math.min(kill.duel_start ?? kill.tick, kill.tick - data.tick_rate) - data.tick_rate);
  };

  // ---- drawing with the pointer ----
  const locate = (e: React.PointerEvent<HTMLDivElement>): BoardPos | null => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left, y = e.clientY - box.top;
    const panel = Math.floor(x / size);
    if (panel < 0 || panel >= levels.length || y < 0 || y > size) return null;
    const [rx, ry] = toRadar(zoom, size / RADAR_SIZE, x - panel * size, y);
    return { x: rx, y: ry, l: levels[panel] };
  };
  const eraseAt = (p: BoardPos) => {
    if (!assets) return;
    const h = hitTest({ ...emptyBoard(match.map), marks: marksRef.current }, assets.meta, 0, p.l, p.x, p.y, (8 * RADAR_SIZE) / (size * zoom.z), null);
    if (h) setMarks(marksRef.current.filter((m) => m.id !== h.id));
  };
  const multiLevel = !!assets && assets.meta.levels.length > 1;
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 1) {
      // middle button: the next level of a two-level map
      e.preventDefault();
      if (multiLevel) setView((v) => (v === "all" ? 0 : v === 0 ? 1 : "all"));
      return;
    }
    if (!drawing && e.button === 0 && zoom.z > 1 && !zoomLocked) {
      pan.current = { x: e.clientX, y: e.clientY, from: zoom, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (!drawing || (e.button !== 0 && e.button !== 2)) return;
    const p = locate(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.button === 2 || tool === "eraser") {
      stroke.current = { mark: null, origin: [p.x, p.y], start: marksRef.current };
      eraseAt(p);
    } else {
      stroke.current = { mark: startMark(tool, 0, p, color, PEN_WIDTHS[1]), origin: [p.x, p.y], start: marksRef.current };
      render();
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pn = pan.current;
    if (pn) {
      const dx = e.clientX - pn.x, dy = e.clientY - pn.y;
      if (!pn.moved && Math.hypot(dx, dy) < PAN_START_PX) return;
      pn.moved = true;
      setZoom(panBy(pn.from, dx, dy, size / RADAR_SIZE));
      return;
    }
    const st = stroke.current;
    const p = st && locate(e);
    if (!st || !p) return;
    if (!st.mark) return eraseAt(p);
    if (p.l !== st.mark.l) return;
    stretchMark(st.mark, st.origin, p.x, p.y, e.shiftKey);
    render();
  };
  const onPointerUp = () => {
    if (pan.current) {
      panned.current = pan.current.moved;
      pan.current = null;
      return;
    }
    const st = stroke.current;
    stroke.current = null;
    if (!st) return;
    if (!st.mark) {
      // erased marks are already gone; one undo step brings them all back
      if (marksRef.current !== st.start) past.current.push(st.start);
    } else if (strayMark(st.mark)) render();
    else commitMarks([...marksRef.current, st.mark], st.start);
  };

  // wheel: zoom around the pointer (a non-passive listener, so the page does not scroll)
  useEffect(() => {
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      if (zoomLocked || !assets) return;
      e.preventDefault();
      const box = stage.getBoundingClientRect();
      const x = e.clientX - box.left, y = e.clientY - box.top;
      const panel = Math.floor(x / size);
      if (panel < 0 || panel >= levels.length) return;
      const k = size / RADAR_SIZE;
      setZoom((v) => {
        const [rx, ry] = toRadar(v, k, x - panel * size, y);
        return zoomAt(v, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, rx, ry);
      });
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [stage, zoomLocked, assets, size, levels.length]);
  useEffect(() => setZoom(NO_VIEW), [match.map]);

  // Q / E held: backwards / twice as fast, until the key is let go
  useEffect(() => {
    const up = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === "q" || key === "e" || key === "й" || key === "у") setHold(null);
    };
    const blur = () => setHold(null);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const changeSpeed = (dir: number) =>
    setSpeed((s) => SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(s) + dir))]);

  // hotkeys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!data || (e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT") return;
      const sec = data.tick_rate;
      const key = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (key === "z" && drawing) {
          e.preventDefault();
          undoMark();
        }
        return;
      }
      if (key === "d") {
        e.preventDefault();
        return setDrawing((d) => !d);
      }
      // by the physical key, so the Russian layout works too
      if (e.code === "KeyQ" || e.code === "KeyE") {
        e.preventDefault();
        if (!e.repeat) setHold(e.code === "KeyQ" ? "back" : "fast");
        return;
      }
      if (drawing) {
        // while drawing, 1/2/3 pick a tool instead of a level
        const picked = SKETCH_TOOLS[["1", "2", "3"].indexOf(e.key)]?.[0];
        if (picked || key === "c" || e.key === "Escape") {
          e.preventDefault();
          if (picked) setTool(picked);
          else if (key === "c") clearMarks();
          else setDrawing(false);
          return;
        }
      }
      switch (e.key) {
        case " ": setPlaying((p) => !p); break;
        case "ArrowRight": e.shiftKey ? seek(tickRef.current + 5 * sec) : stepFrame(1); break;
        case "ArrowLeft": e.shiftKey ? seek(tickRef.current - 5 * sec) : stepFrame(-1); break;
        case ".": stepFrame(1); break;
        case ",": stepFrame(-1); break;
        case "ArrowUp": case "+": case "=": changeSpeed(1); break;
        case "ArrowDown": case "-": changeSpeed(-1); break;
        case "n": case "N": case "k": case "K": jumpKill(1); break;
        case "p": case "P": case "j": case "J": jumpKill(-1); break;
        case "Home": seek(data.freeze_end_tick); break;
        case "]": nextRound(); break;
        case "[": prevRound(); break;
        case "0": setZoom(NO_VIEW); break;
        case "1": setView(0); break;
        case "2": if (assets && assets.meta.levels.length > 1) setView(1); break;
        case "3": setView("all"); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, seek, stepFrame, jumpKill, roundIdx, assets, drawing, undoMark, clearMarks, onPrev, onNext]);

  const states = useMemo(() => (data ? playerStates(data, uiTick) : []), [data, uiTick]);
  // per player up to now: damage dealt to enemies and kills (team damage and team kills excluded)
  const tally = useMemo(() => {
    const out = new Map<string, { dmg: number; kills: number }>();
    if (!data) return out;
    const side = new Map(data.players.map((p) => [p.steamid, p.side]));
    const row = (id: string) => out.get(id) ?? out.set(id, { dmg: 0, kills: 0 }).get(id)!;
    const h = data.hurts;
    for (let i = 0; i < h.tick.length && h.tick[i] <= uiTick; i++) {
      const a = h.attacker[i];
      if (a && a !== h.victim[i] && side.get(a) !== side.get(h.victim[i])) row(a).dmg += h.dmg[i];
    }
    for (const k of data.kills) {
      if (k.tick <= uiTick && k.attacker && k.attacker !== k.victim && k.attacker_side !== k.victim_side) row(k.attacker).kills++;
    }
    return out;
  }, [data, uiTick]);
  // rounds won before this one, per team name
  const scores = useMemo(() => {
    const won: Record<string, number> = {};
    for (const r of match.timeline) if (r.round < round && r.winner) won[r.winner] = (won[r.winner] ?? 0) + 1;
    return won;
  }, [match, round]);
  const copyPlayer = (s: PlayerState) => copy(setpos(s.x, s.y, s.z, 0, s.yaw ?? 0));
  const thrower = hoverThrow && data ? data.players.find((p) => p.steamid === data.grenades[hoverThrow.g]?.thrower)?.name : undefined;
  if (error) return <div className="error">{error}</div>;
  if (mapError) return <div className="error">{mapError}</div>;

  const dpr = window.devicePixelRatio || 1;
  const width = size * levels.length;
  const roundInfo = match.timeline[roundIdx];
  // `data` still holds the previous round for a moment after a round change
  const live = data && data.round === round ? data : null;
  const ct = sideSummary(live ? states : null, "counter-terrorist", live, roundInfo, scores);
  const tr = sideSummary(live ? states : null, "terrorist", live, roundInfo, scores);

  return (
    <div className="replay">
      <div className="replay-top">
        <button disabled={!onPrev && roundIdx <= 0} onClick={prevRound} title={onPrev ? t("pl.prev") : undefined}>◀ [</button>
        {!onNext && <RoundStrip match={match} round={round} />}
        <button disabled={!onNext && roundIdx >= rounds.length - 1} onClick={nextRound} title={onNext ? t("pl.next") : undefined}>] ▶</button>
        {data && <Clock r={data} tick={uiTick} />}
        {live && (
          <span className="vs-alive" title={t("replay.aliveVsTitle")}>
            <b style={{ color: CT_COLOR }}>{ct.alive}</b> {t("replay.vs")} <b style={{ color: T_COLOR }}>{tr.alive}</b>
          </span>
        )}
        {loadMs !== null && <span className="muted small">{t("replay.loaded", { ms: loadMs })}{data?.low_res ? t("replay.lowRes") : ""}</span>}
        <span className="grow" />
        {assets && assets.meta.levels.length > 1 && (
          <span className="seg">
            {assets.meta.levels.map((_, i) => (
              <button key={i} className={view === i ? "on" : ""} onClick={() => setView(i)}>{levelLabel(assets.meta, i)}</button>
            ))}
            <button className={view === "all" ? "on" : ""} onClick={() => setView("all")}>{t("common.both")}</button>
          </span>
        )}
        <label className="small"><input type="checkbox" checked={opts.names} onChange={(e) => setOpts({ ...opts, names: e.target.checked })} /> {t("replay.names")}</label>
        <label className="small"><input type="checkbox" checked={opts.weapons} onChange={(e) => setOpts({ ...opts, weapons: e.target.checked })} /> {t("replay.weapons")}</label>
        <label className="small"><input type="checkbox" checked={opts.trails} onChange={(e) => setOpts({ ...opts, trails: e.target.checked })} /> {t("replay.trails")}</label>
        <label className="small"><input type="checkbox" checked={opts.shots} onChange={(e) => setOpts({ ...opts, shots: e.target.checked })} /> {t("replay.shots")}</label>
        <label className="small" title={t("replay.flashMarksTitle")}><input type="checkbox" checked={opts.flashMarks} onChange={(e) => setOpts({ ...opts, flashMarks: e.target.checked })} /> {t("replay.flashMarks")}</label>
        <label className="small" title={t("replay.damageNumsTitle")}><input type="checkbox" checked={opts.damage} onChange={(e) => setOpts({ ...opts, damage: e.target.checked })} /> {t("replay.damageNums")}</label>
        <label className="small" title={t("replay.spottedTitle")}><input type="checkbox" checked={opts.spotted} onChange={(e) => setOpts({ ...opts, spotted: e.target.checked })} /> {t("replay.spotted")}</label>
        <CalloutToggle meta={assets?.meta} />
        <span className="seg zoom-ctl">
          <button className={zoomLocked ? "on" : ""} title={t("replay.zoomLockTitle")} onClick={() => setZoomLocked((v) => !v)}>
            {zoomLocked ? "🔒" : "🔓"}
          </button>
          <button disabled={zoom.z === 1} title={t("replay.zoomResetTitle")} onClick={() => setZoom(NO_VIEW)}>
            {t("replay.zoomReset", { z: zoom.z.toFixed(1) })}
          </button>
        </span>
      </div>

      <div className="replay-body">
        <TeamPanel states={states.filter((s) => s.p.side === "counter-terrorist")} head={ct} title={ct.name ?? "CT"} color={CT_COLOR} onCopy={copyPlayer} tally={tally} height={size} all={data?.players ?? []} />
        <div className="replay-stage" ref={boxRef}>
          {!data || !assets ? (
            <div className="muted" style={{ height: size }}>{t("replay.loadingRound")}</div>
          ) : (
            <div
              ref={setStage}
              className={drawing ? "replay-canvas drawing" : "replay-canvas"}
              style={{
                position: "relative", width, height: size,
                cursor: drawing ? undefined : hover || hoverThrow ? "pointer" : zoom.z > 1 && !zoomLocked ? (pan.current?.moved ? "grabbing" : "grab") : undefined,
              }}
              onAuxClick={(e) => e.button === 1 && e.preventDefault()}
              onMouseMove={onStageMove}
              onMouseLeave={() => {
                setHover(null);
                setHoverPlayer(null);
                setHoverThrow(null);
              }}
              onClick={onStageClick}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onContextMenu={(e) => drawing && e.preventDefault()}
            >
              <canvas ref={canvasRef} width={width * dpr} height={size * dpr} style={{ width, height: size }} />
              <KillFeed r={data} tick={uiTick} />
              {hover && data.kills[hover.kill] && <KillCard r={data} kill={data.kills[hover.kill]} x={hover.x} y={hover.y} maxX={width} />}
              {hoverThrow && (
                <div className="replay-tip" style={{ left: Math.min(hoverThrow.x + 12, width - 230), top: hoverThrow.y + 14 }}>
                  {thrower ? `${thrower} · ` : ""}{t("replay.throwTip")}
                </div>
              )}
              {note && <div className="replay-note">{note}</div>}
            </div>
          )}
        </div>
        <TeamPanel states={states.filter((s) => s.p.side === "terrorist")} head={tr} title={tr.name ?? "T"} color={T_COLOR} onCopy={copyPlayer} tally={tally} height={size} all={data?.players ?? []} />
      </div>

      {data && (
        <>
          <Timeline r={data} tick={uiTick} onSeek={seek} notes={roundNotes} />
          <div className="controls">
            <button onClick={() => stepFrame(-1)} title={t("replay.prevFrame")}>⏮</button>
            <button className="play" onClick={() => setPlaying((p) => !p)} title={t("replay.space")}>{playing ? "⏸" : "▶"}</button>
            <button onClick={() => stepFrame(1)} title={t("replay.nextFrame")}>⏭</button>
            <button onClick={() => jumpKill(-1)} title={t("replay.prevKill")}>{t("replay.killPrev")}</button>
            <button onClick={() => jumpKill(1)} title={t("replay.nextKill")}>{t("replay.killNext")}</button>
            <span className="seg">
              {SPEEDS.map((s) => (
                <button key={s} className={speed === s ? "on" : ""} onClick={() => setSpeed(s)}>{s}×</button>
              ))}
            </span>
            <button
              title={t("replay.addHighlightTitle")}
              onClick={() => go("match", match.id, "highlights", round, Math.round((tickRef.current - data.freeze_end_tick) / data.tick_rate))}
            >
              {t("replay.addHighlight")}
            </button>
            <button
              title={t("replay.toBoardTitle")}
              disabled={!assets}
              onClick={() => {
                if (!assets) return;
                setPlaying(false);
                const sec = Math.round(((tickRef.current - data.freeze_end_tick) / data.tick_rate) * 10) / 10;
                const board = boardFromFrame(assets.meta, data, tickRef.current, { match: match.id, round, sec });
                board.marks.push(...marks.map((m) => ({ ...m, id: newId() }))); // the sketch comes along
                stashDraft(board);
                go("board", "draft");
              }}
            >
              {t("replay.toBoard")}
            </button>
            <button
              title={t("replay.openBoardTitle")}
              onClick={() => {
                setPlaying(false);
                const sec = Math.round(((tickRef.current - data.freeze_end_tick) / data.tick_rate) * 10) / 10;
                stashDraft({ ...emptyBoard(match.map), source: { match: match.id, round, sec } });
                go("board", "draft");
              }}
            >
              {t("replay.openBoard")}
            </button>
            <button className={panel === "note" ? "on" : ""} title={t("notes.addTitle")} onClick={() => { setPlaying(false); setPanel(panel === "note" ? null : "note"); }}>
              {t("notes.add")}
            </button>
            <button className={panel === "star" ? "on" : ""} title={t("pl.addTitle")} onClick={() => { setPlaying(false); setPanel(panel === "star" ? null : "star"); }}>
              {t("pl.star")}
            </button>
            <button
              title={t("replay.copyLinkTitle")}
              onClick={() => copy(shareUrl("match", match.id, "replay", round, Math.round(((tickRef.current - data.freeze_end_tick) / data.tick_rate) * 10) / 10))}
            >
              {t("common.link")}
            </button>
            <span className="sketch">
              <button className={drawing ? "on" : ""} title={t("replay.drawTitle")} onClick={() => setDrawing((d) => !d)}>{t("replay.draw")}</button>
              {drawing && (
                <>
                  <span className="seg">
                    {SKETCH_TOOLS.map(([k, label], i) => (
                      <button key={k} className={tool === k ? "on" : ""} title={`${t(label)} (${i + 1})`} onClick={() => setTool(k)}>
                        <ToolIcon tool={k} />
                      </button>
                    ))}
                  </span>
                  <span className="board-colors">
                    {PEN_COLORS.map((c) => (
                      <button key={c} className={color === c ? "on" : ""} style={{ background: c }} onClick={() => { setColor(c); if (tool === "eraser") setTool("pen"); }} />
                    ))}
                  </span>
                  <button disabled={!past.current.length} title="Ctrl+Z" onClick={undoMark}>{t("board.undo")}</button>
                  <button disabled={!marks.length} title={t("replay.drawClearTitle")} onClick={clearMarks}>{t("board.clear")}</button>
                </>
              )}
            </span>
            <span className="muted small hotkeys">
              {t("replay.hotkeys")}
              {assets && assets.meta.levels.length > 1 ? t("replay.hotkeysLevels") : ""}
              {t("replay.hotkeysDraw")}
            </span>
          </div>
          {panel === "note" && (
            <NoteForm match={match.id} round={round} sec={(tickRef.current - data.freeze_end_tick) / data.tick_rate}
              onDone={(saved) => { setPanel(null); if (saved) loadNotes(); }} />
          )}
          {panel === "star" && (
            <StarForm match={match.id} round={round} sec={(tickRef.current - data.freeze_end_tick) / data.tick_rate}
              onDone={(msg) => { setPanel(null); if (msg) flash(msg); }} />
          )}
          <RoundNotes notes={roundNotes} onChanged={loadNotes} onSeek={(sec) => { setPlaying(false); seek(data.freeze_end_tick + sec * data.tick_rate); }} />
          {roundInfo && (
            <div className="muted small">
              {t("replay.won", { winner: roundInfo.winner, side: sideShort(roundInfo.winner_side), reason: reasonLabel(roundInfo.reason) })}
              {roundInfo.plant_site ? t("replay.plantOn", { site: roundInfo.plant_site }) : ""}.
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Round buttons: the bar under each is the winner's side colour; a gap marks a side switch (halves, overtime). */
function RoundStrip({ match, round }: { match: MatchOverview; round: number }) {
  const tl = match.timeline;
  const switched = (i: number) => i > 0 && Object.keys(tl[i].teams).some((team) => tl[i - 1].teams[team] && tl[i - 1].teams[team].side !== tl[i].teams[team].side);
  return (
    <span className="round-strip">
      {tl.map((r, i) => (
        <button
          key={r.round}
          className={`${r.round === round ? "on" : ""} ${switched(i) ? "half" : ""}`}
          style={{ borderBottomColor: sideColor(r.winner_side) }}
          title={t("replay.roundOpt", { round: r.round, winner: r.winner ?? sideShort(r.winner_side), reason: reasonLabel(r.reason) })}
          onClick={() => go("match", match.id, "replay", r.round)}
        >
          {r.round}
        </button>
      ))}
    </span>
  );
}

function Clock({ r, tick }: { r: Replay; tick: number }) {
  const bomb = bombState(r, tick);
  if (tick < r.freeze_end_tick) return <span className="clock">{t("clock.freeze", { t: fmtClock((r.freeze_end_tick - tick) / r.tick_rate) })}</span>;
  if (bomb.planted && !bomb.defused) {
    const left = BOMB_TIME - (tick - bomb.planted.tick) / r.tick_rate;
    return <span className="clock bomb">💣 {bomb.planted.site} {fmtClock(left)}</span>;
  }
  if (bomb.defused) return <span className="clock defused">{t("replay.defused")}</span>;
  return <span className="clock">{fmtClock(ROUND_TIME - (tick - r.freeze_end_tick) / r.tick_rate)}</span>;
}

interface SideSummary { name: string | null; score: number; live: boolean; alive: number; total: number; money: number | null; buy: string | null; equip: number | null }

/** One side's header numbers: score before the round, players alive, money now (live frames only), buy and equipment at the round start. */
function sideSummary(states: PlayerState[] | null, side: string, data: Replay | null, info: TimelineRound | undefined, scores: Record<string, number>): SideSummary {
  const mine = (states ?? []).filter((s) => s.p.side === side);
  const moneys = mine.map((s) => s.money).filter((m): m is number => m !== null);
  // the timeline names are the keys of `scores`, so take the team from there first
  const entry = info ? Object.entries(info.teams).find(([, x]) => x.side === side) : undefined;
  const name = entry?.[0] ?? data?.teams[side as keyof Replay["teams"]] ?? null;
  return {
    name,
    score: name ? scores[name] ?? 0 : 0,
    live: states !== null,
    alive: mine.filter((s) => s.hp > 0).length,
    total: mine.length,
    money: moneys.length ? moneys.reduce((x, y) => x + y, 0) : null,
    buy: entry?.[1].buy ?? null,
    equip: entry?.[1].equip ?? null,
  };
}

/** Damage to enemies and kills so far: "87 ☠☠", or "☠×4" past three kills. */
function PlayerTally({ dmg, kills }: { dmg: number; kills: number }) {
  return (
    <span className="pl-tally">
      {dmg > 0 && <span title={t("pl.dealtTitle", { n: dmg })}>{dmg}</span>}
      {kills > 0 && <span title={t("pl.killsTitle", { n: kills })}>{kills > 3 ? `☠×${kills}` : "☠".repeat(kills)}</span>}
    </span>
  );
}

function TeamPanel({ states, head, title, color, onCopy, tally, height, all }: { states: PlayerState[]; head: SideSummary; title: string; color: string; onCopy: (s: PlayerState) => void; tally: Map<string, { dmg: number; kills: number }>; height: number; all: ReplayPlayer[] }) {
  // as tall as the radar at most, so the players never push the timeline and controls off the screen
  return (
    <div className="team-panel" style={{ maxHeight: height }}>
      <div className="team-title" style={{ color }}>
        <b className="team-score">{head.score}</b>
        <span className="team-name">{title}</span>
      </div>
      <div className="team-info muted small">
        {head.live && <span title={t("replay.aliveTitle")}>{head.alive}/{head.total}</span>}
        {head.money !== null && <span title={t("replay.teamMoneyTitle")}>{fmtMoney(head.money)}</span>}
        {(head.buy || head.equip !== null) && (
          <span title={t("replay.teamEquipTitle")}>{[head.buy ? buyLabel(head.buy) : null, head.equip !== null ? fmtMoney(head.equip) : null].filter(Boolean).join(" ")}</span>
        )}
      </div>
      {states.map((s) => (
        <div
          key={s.p.steamid}
          className={`pl ${s.hp <= 0 ? "dead" : "copy"}`}
          title={s.hp > 0 ? t("replay.copyPos", { name: s.p.name }) : undefined}
          onClick={() => s.hp > 0 && !Number.isNaN(s.x) && onCopy(s)}
        >
          <div className="pl-top">
            <span className="pl-name">{s.hp <= 0 && <span className="pl-dead" title={t("pl.dead")}>✕</span>}{s.p.name}</span>
            <span className="pl-icons">
              {s.hp > 0 && s.seen !== 0 && <FeedIcon id="spotted" color="#ffec78" size={11} title={t("pl.seenBy", { names: all.filter((_, j) => (s.seen >> j) & 1).map((q) => q.name).join(", ") })} />}
              {s.bomb && <span title={t("pl.bomb")}>💣</span>}
              {s.kit && <span title={t("pl.kit")}>✂</span>}
              {s.armor > 0 && <span title={t("pl.armor", { n: s.armor })}>{s.helmet ? "⛑" : "🛡"}</span>}
            </span>
          </div>
          <div className="hp"><div style={{ width: `${s.hp}%`, background: color }} /><span>{s.hp}</span></div>
          <div className="pl-weapon">
            <span className="pl-active">
              {/* the active gun is highlighted in the inventory line below; other active items show here */}
              {s.hp > 0 && s.weapon && !(s.p.inv && (s.weapon === s.primary || s.weapon === s.secondary)) && <WeaponIcon weapon={s.weapon} color="var(--text)" size={11} />}
              {s.money !== null && <span>${s.money}</span>}
            </span>
            <PlayerTally {...(tally.get(s.p.steamid) ?? { dmg: 0, kills: 0 })} />
          </div>
          {s.hp > 0 && (s.primary || s.secondary || s.nades.length > 0) && (
            <div className="pl-inv">
              {[s.primary, s.secondary].filter((w): w is string => !!w).map((w) => (
                <span key={w} className={w === s.weapon ? "wi on" : "wi"}><WeaponIcon weapon={w} color="var(--text)" size={11} /></span>
              ))}
              {s.nades.map((n, i) => <NadeIcon key={i} type={n} color="var(--text)" size={13} title={td(`board.nade.${n}`, n)} />)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function KillFeed({ r, tick }: { r: Replay; tick: number }) {
  const recent = r.kills.filter((k) => k.tick <= tick && tick - k.tick < KILLFEED_SEC * r.tick_rate).slice(-5);
  return (
    <div className="killfeed">
      {recent.map((k, i) => (
        <div key={i} className="kill">
          {attackerBlind(r, k) && <FeedIcon id="blind" color="#ddd" size={14} title={t("feed.blind")} />}
          <span style={{ color: sideColor(k.attacker_side) }}>{k.attacker_name ?? "World"}</span>
          {k.assister_name && (
            <>
              <span className="muted">+</span>
              {k.flashed && <FeedIcon id="flashassist" color="#fff" size={14} title={t("feed.flashAssist")} />}
              <span style={{ color: sideColor(k.attacker_side) }}>{k.assister_name}</span>
            </>
          )}
          <WeaponIcon weapon={k.weapon} color="#fff" size={14} />
          {k.noscope && <FeedIcon id="noscope" color="#fff" size={14} title={t("feed.noscope")} />}
          {k.wallbang && <FeedIcon id="wallbang" color="#fff" size={14} title={t("feed.wallbang")} />}
          {k.thrusmoke && <FeedIcon id="smoke" color="#fff" size={14} title={t("feed.smoke")} />}
          {k.headshot && <FeedIcon id="headshot" color="#fff" size={14} title={t("feed.headshot")} />}
          <span style={{ color: sideColor(k.victim_side) }}>{k.victim_name}</span>
        </div>
      ))}
    </div>
  );
}

function Timeline({ r, tick, onSeek, notes }: { r: Replay; tick: number; onSeek: (t: number) => void; notes: Note[] }) {
  const span = r.last_tick - r.start_tick;
  const pct = (t: number) => `${((t - r.start_tick) / span) * 100}%`;
  const ref = useRef<HTMLDivElement>(null);
  const seekAt = (clientX: number) => {
    const box = ref.current!.getBoundingClientRect();
    onSeek(r.start_tick + ((clientX - box.left) / box.width) * span);
  };
  return (
    <div
      className="timeline"
      ref={ref}
      onMouseDown={(e) => {
        seekAt(e.clientX);
        const move = (ev: MouseEvent) => seekAt(ev.clientX);
        const up = () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
    >
      <div className="tl-freeze" style={{ width: pct(r.freeze_end_tick) }} title={t("tl.freeze")} />
      <div className="tl-progress" style={{ width: pct(tick) }} />
      <div className="tl-mark end" style={{ left: pct(r.end_tick) }} title={t("tl.end")} />
      {r.kills.map((k, i) => (
        <div
          key={i}
          className="tl-kill"
          style={{ left: pct(k.tick), background: sideColor(k.attacker_side) }}
          title={`${k.attacker_name ?? "World"} → ${k.victim_name} (${weaponName(k.weapon)})`}
        />
      ))}
      {r.grenades.filter((g) => g.type !== "decoy").map((g, i) => (
        <div
          key={`g${i}`}
          className="tl-nade"
          style={{ left: pct(g.t[0]) }}
          title={t("tl.nade", { nade: td(`nade.${g.type}`, g.type), who: r.players.find((p) => p.steamid === g.thrower)?.name ?? "?" })}
        >
          <NadeIcon type={g.type} color={g.side ? sideColor(g.side) : "#888"} size={12} />
        </div>
      ))}
      {r.bomb.filter((b) => b.event === "finish_plant" || b.event === "defuse").map((b, i) => (
        <div key={i} className="tl-bomb" style={{ left: pct(b.tick) }} title={b.event === "defuse" ? t("tl.defuse") : t("tl.plant", { site: b.site })}>
          {b.event === "defuse" ? "✂" : "💣"}
        </div>
      ))}
      {notes.map((n) => (
        <div key={n.id} className="tl-note" style={{ left: pct(Math.max(r.start_tick, Math.min(r.last_tick, r.freeze_end_tick + n.sec * r.tick_rate))) }}
          title={n.text} />
      ))}
      <div className="tl-head" style={{ left: pct(tick) }} />
    </div>
  );
}
