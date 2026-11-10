import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type BoardMark, type BoardPos, type MatchOverview, type Note, type Replay } from "../api";
import { go } from "../router";
import { PEN_COLORS, PEN_WIDTHS, boardFromFrame, drawMarks, emptyBoard, hitTest, newId, startMark, stashDraft, strayMark, stretchMark } from "../board";
import { useFitHeight } from "../fit";
import { CT_COLOR, RADAR_SIZE, T_COLOR, levelLabel, levelOf, panelLevels, sideColor, sideShort, useMapAssets, worldToPx } from "../radar";
import {
  BOMB_TIME, NADE_COLORS, ROUND_TIME, bombState, drawRound, fmtClock, frameAt, killAt, loadReplay, playerStates, throwAt, weaponName, type PlayerState,
} from "../replayDraw";
import { useCalloutMode } from "../callouts";
import { reasonLabel, t, type Key } from "../i18n";
import { CalloutToggle } from "./CalloutToggle";
import { ToolIcon } from "./Icons";
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
export function ReplayView({ match, round, at, until, onEnd, autoplay }: {
  match: MatchOverview;
  round: number;
  at?: number;
  until?: number | null; // stop here (seconds after the freeze end) and call onEnd: playlist playback
  onEnd?: () => void;
  autoplay?: boolean;
}) {
  const { assets, error: mapError } = useMapAssets(match.map);
  const [data, setData] = useState<Replay | null>(null);
  const [loadMs, setLoadMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [view, setView] = useState<number | "all">("all");
  const [opts, setOpts] = useState({ names: true, weapons: false, trails: true, shots: true });
  const callouts = useCalloutMode();
  const [hover, setHover] = useState<{ kill: number; x: number; y: number } | null>(null);
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

  useEffect(() => {
    setData(null);
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
      ...opts, callouts: callouts !== "off", hoverKill: hover?.kill ?? -1, throwPoints: true, hoverThrow: hoverThrow?.g ?? -1,
    });
    const draft = stroke.current?.mark;
    drawMarks(ctx, assets.meta, draft ? [...marksRef.current, draft] : marksRef.current, levels, size);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, data, size, levels.join(","), opts, callouts, hover?.kill, hoverThrow?.g, marks]);

  useEffect(render, [render, uiTick]);

  // playback loop
  useEffect(() => {
    if (!playing || !data) return;
    let raf = 0, last = performance.now(), lastUi = 0;
    const stop = until != null ? Math.min(data.last_tick, data.freeze_end_tick + until * data.tick_rate) : data.last_tick;
    const frame = (now: number) => {
      tickRef.current += ((now - last) / 1000) * data.tick_rate * speed;
      last = now;
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
  }, [playing, speed, data, render, until]);

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
      return setHoverThrow(null);
    }
    const k = size / RADAR_SIZE;
    const multi = assets.meta.levels.length > 1;
    const P = (wx: number, wy: number) => worldToPx(assets.meta, wx, wy);
    const i = killAt(data.kills, tickRef.current, P, (x - panel * size) / k, y / k, 1 / k, (kill) => !multi || levelOf(assets.meta, kill.vz) === li);
    setHover(i >= 0 ? { kill: i, x, y } : null);
    const g = i >= 0 ? -1 : throwAt(data, tickRef.current, P, (x - panel * size) / k, y / k, 1 / k, (z) => !multi || levelOf(assets.meta, z) === li);
    setHoverThrow(g >= 0 ? { g, x, y } : null);
  };
  const onStageClick = () => {
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
    const k = size / RADAR_SIZE;
    return { x: (x - panel * size) / k, y: y / k, l: levels[panel] };
  };
  const eraseAt = (p: BoardPos) => {
    if (!assets) return;
    const h = hitTest({ ...emptyBoard(match.map), marks: marksRef.current }, assets.meta, 0, p.l, p.x, p.y, 8 * (RADAR_SIZE / size), null);
    if (h) setMarks(marksRef.current.filter((m) => m.id !== h.id));
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
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
    const st = stroke.current;
    const p = st && locate(e);
    if (!st || !p) return;
    if (!st.mark) return eraseAt(p);
    if (p.l !== st.mark.l) return;
    stretchMark(st.mark, st.origin, p.x, p.y, e.shiftKey);
    render();
  };
  const onPointerUp = () => {
    const st = stroke.current;
    stroke.current = null;
    if (!st) return;
    if (!st.mark) {
      // erased marks are already gone; one undo step brings them all back
      if (marksRef.current !== st.start) past.current.push(st.start);
    } else if (strayMark(st.mark)) render();
    else commitMarks([...marksRef.current, st.mark], st.start);
  };

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
        case "]": if (rounds[roundIdx + 1] !== undefined) go("match", match.id, "replay", rounds[roundIdx + 1]); break;
        case "[": if (roundIdx > 0) go("match", match.id, "replay", rounds[roundIdx - 1]); break;
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
  }, [data, seek, stepFrame, jumpKill, roundIdx, assets, drawing, undoMark, clearMarks]);

  const states = useMemo(() => (data ? playerStates(data, uiTick) : []), [data, uiTick]);
  const copyPlayer = (s: PlayerState) => copy(setpos(s.x, s.y, s.z, 0, s.yaw ?? 0));
  const thrower = hoverThrow && data ? data.players.find((p) => p.steamid === data.grenades[hoverThrow.g]?.thrower)?.name : undefined;
  if (error) return <div className="error">{error}</div>;
  if (mapError) return <div className="error">{mapError}</div>;

  const dpr = window.devicePixelRatio || 1;
  const width = size * levels.length;
  const roundInfo = match.timeline[roundIdx];

  return (
    <div className="replay">
      <div className="replay-top">
        <button disabled={roundIdx <= 0} onClick={() => go("match", match.id, "replay", rounds[roundIdx - 1])}>◀ [</button>
        <select value={round} onChange={(e) => go("match", match.id, "replay", e.target.value)}>
          {match.timeline.map((r) => (
            <option key={r.round} value={r.round}>
              {t("replay.roundOpt", { round: r.round, winner: r.winner ?? sideShort(r.winner_side), reason: reasonLabel(r.reason) })}
            </option>
          ))}
        </select>
        <button disabled={roundIdx >= rounds.length - 1} onClick={() => go("match", match.id, "replay", rounds[roundIdx + 1])}>] ▶</button>
        {data && <Clock r={data} tick={uiTick} />}
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
        <CalloutToggle meta={assets?.meta} />
      </div>

      <div className="replay-body">
        <TeamPanel states={states.filter((s) => s.p.side === "counter-terrorist")} title={data?.teams["counter-terrorist"] ?? "CT"} color={CT_COLOR} onCopy={copyPlayer} height={size} />
        <div className="replay-stage" ref={boxRef}>
          {!data || !assets ? (
            <div className="muted" style={{ height: size }}>{t("replay.loadingRound")}</div>
          ) : (
            <div
              className={drawing ? "replay-canvas drawing" : "replay-canvas"}
              style={{ position: "relative", width, height: size, cursor: drawing ? undefined : hover || hoverThrow ? "pointer" : undefined }}
              onMouseMove={onStageMove}
              onMouseLeave={() => {
                setHover(null);
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
        <TeamPanel states={states.filter((s) => s.p.side === "terrorist")} title={data?.teams.terrorist ?? "T"} color={T_COLOR} onCopy={copyPlayer} height={size} />
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

function TeamPanel({ states, title, color, onCopy, height }: { states: PlayerState[]; title: string; color: string; onCopy: (s: PlayerState) => void; height: number }) {
  // as tall as the radar at most, so the players never push the timeline and controls off the screen
  return (
    <div className="team-panel" style={{ maxHeight: height }}>
      <div className="team-title" style={{ color }}>{title}</div>
      {states.map((s) => (
        <div
          key={s.p.steamid}
          className={`pl ${s.hp <= 0 ? "dead" : "copy"}`}
          title={s.hp > 0 ? t("replay.copyPos", { name: s.p.name }) : undefined}
          onClick={() => s.hp > 0 && !Number.isNaN(s.x) && onCopy(s)}
        >
          <div className="pl-top">
            <span className="pl-name">{s.p.name}</span>
            <span className="pl-icons">
              {s.bomb && <span title={t("pl.bomb")}>💣</span>}
              {s.kit && <span title={t("pl.kit")}>✂</span>}
              {s.armor > 0 && <span title={t("pl.armor", { n: s.armor })}>{s.helmet ? "⛑" : "🛡"}</span>}
            </span>
          </div>
          <div className="hp"><div style={{ width: `${s.hp}%`, background: color }} /><span>{s.hp}</span></div>
          <div className="pl-weapon">
            {[
              // the active gun is highlighted in the inventory line below; other active items are named here
              s.hp <= 0 ? "DEAD" : s.p.inv && (s.weapon === s.primary || s.weapon === s.secondary) ? null : weaponName(s.weapon),
              s.p.money !== null ? `$${s.p.money}` : null,
            ].filter(Boolean).join(" · ")}
          </div>
          {s.hp > 0 && (s.primary || s.secondary || s.nades.length > 0) && (
            <div className="pl-inv">
              {[s.primary, s.secondary].filter(Boolean).map((w) => (
                <span key={w} className={w === s.weapon ? "on" : ""}>{weaponName(w)}</span>
              ))}
              {s.nades.map((n, i) => <i key={i} className="nade" style={{ background: NADE_COLORS[n] }} title={n} />)}
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
          <span style={{ color: sideColor(k.attacker_side) }}>{k.attacker_name ?? "World"}</span>
          <span className="weapon">
            {k.flashed ? "◐ " : ""}{weaponName(k.weapon)}{k.headshot ? " ⌖" : ""}{k.wallbang ? " ⇥" : ""}{k.thrusmoke ? " ☁" : ""}
          </span>
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
