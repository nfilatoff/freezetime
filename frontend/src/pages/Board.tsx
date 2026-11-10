// Tactics board: draw a tactic on a map in up to 4 steps, play it back, save it, export it.
// Players, the bomb and grenades are dragged from the toolbar onto the map; strokes and
// shapes use a tool. Dragging a player on a later step records the route it walks.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Board, type BoardMark, type BoardPos, type BoardSummary, type NadeKind } from "../api";
import {
  MAX_STEPS, NADES, STEP_KEYS, NADE_SHORT, PEN_COLORS, PEN_WIDTHS, TOKEN_R, animDuration, animFrame, clearRoute, drawBoard, drawCaption,
  emptyBoard, hitTest, moveToken, newId, newPlayer, newToken, posAt, removeItem, setSteps, simplify, startMark, stepName, strayMark,
  stretchMark, takeDraft, updateMark, updateToken, type Tool,
} from "../board";
import { canEncodeVideo, download, exportGif, exportMp4 } from "../clipExport";
import { CalloutToggle } from "../components/CalloutToggle";
import { ToolIcon } from "../components/Icons";
import { mapPretty } from "../components/MatchPicker";
import { useCalloutMode } from "../callouts";
import { t, type Key } from "../i18n";
import { RADAR_SIZE, levelLabel, panelLevels, useMapAssets, CT_COLOR, T_COLOR } from "../radar";
import { NADE_COLORS } from "../replayDraw";
import { go } from "../router";
import { copyText, shareUrl } from "../share";

const TOOLS: [Tool, Key][] = [
  ["select", "board.tool.select"], ["pen", "board.tool.pen"], ["arrow", "board.tool.arrow"], ["rect", "board.tool.rect"],
  ["circle", "board.tool.circle"], ["text", "board.tool.text"], ["eraser", "board.tool.eraser"],
];
const NADE_KEYS: Record<NadeKind, Key> = {
  smoke: "board.nade.smoke", molotov: "board.nade.molotov", incendiary: "board.nade.incendiary",
  flashbang: "board.nade.flashbang", he: "board.nade.he", decoy: "board.nade.decoy",
};

// ---- rebindable hotkeys, remembered in this browser ----
type Action = Tool | "play" | "onion" | "prevStep" | "nextStep";
const ACTIONS: [Action, Key][] = [
  ...TOOLS, ["play", "board.play"], ["onion", "board.onion"], ["prevStep", "board.prevStep"], ["nextStep", "board.nextStep"],
];
const DEFAULT_KEYS: Record<Action, string> = {
  select: "v", pen: "p", arrow: "a", rect: "r", circle: "c", text: "t", eraser: "e", play: " ", onion: "o", prevStep: "q", nextStep: "w",
};
const KEYS_STORAGE = "freezetime.board.keys";
const WIP_STORAGE = "freezetime.board.wip";
const AUTHOR_STORAGE = "freezetime.board.author";

function loadKeys(): Record<Action, string> {
  try {
    return { ...DEFAULT_KEYS, ...JSON.parse(localStorage.getItem(KEYS_STORAGE) ?? "{}") };
  } catch {
    return { ...DEFAULT_KEYS };
  }
}
const store = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
};
const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const keyName = (k: string) => (k === " " ? "Space" : k.length === 1 ? k.toUpperCase() : k);

type DragItem = { t: "player"; side: "ct" | "t" } | { t: "bomb" } | { t: "nade"; kind: NadeKind };
const DND = "application/x-freezetime-board";

type Drag =
  | { kind: "token"; id: string; start: Board; trail: BoardPos[] }
  | { kind: "mark"; id: string; start: Board; l: number; last: [number, number] }
  | { kind: "handle"; id: string; start: Board; l: number }
  | { kind: "draw"; start: Board; mark: BoardMark; origin: [number, number]; shift: boolean }
  | { kind: "erase"; start: Board };

interface TextEdit {
  target: { kind: "mark"; id: string | null } | { kind: "token"; id: string };
  l: number;
  x: number;
  y: number;
  value: string;
}

export function BoardPage({ id }: { id?: string }) {
  const [maps, setMaps] = useState<string[]>([]);
  const [board, setBoardState] = useState<Board | null>(null);
  const boardRef = useRef<Board | null>(null);
  boardRef.current = board;
  const past = useRef<Board[]>([]);
  const future = useRef<Board[]>([]);
  const [, setHistoryTick] = useState(0);
  const [savedJson, setSavedJson] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [view, setView] = useState<number | "all">("all");
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [width, setWidth] = useState(PEN_WIDTHS[1]);
  const [selected, setSelected] = useState<string | null>(null);
  const [onion, setOnion] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [list, setList] = useState<BoardSummary[]>([]);
  const [listAll, setListAll] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<TextEdit | null>(null);
  const [keys, setKeys] = useState(loadKeys);
  const [showKeys, setShowKeys] = useState(false);
  const [binding, setBinding] = useState<Action | null>(null);
  const [author, setAuthor] = useState(() => read(AUTHOR_STORAGE) ?? "");
  const [roster, setRoster] = useState<string[]>([]);
  const callouts = useCalloutMode();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(900);
  const drag = useRef<Drag | null>(null);
  const animT = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const labelStart = useRef<Board | null>(null);

  const { assets, error: mapError } = useMapAssets(board?.map);
  const ready = assets && board && assets.meta.map === board.map ? assets : null;

  // ---- loading ----
  useEffect(() => {
    api.maps().then(setMaps).catch((e: Error) => setMsg({ text: e.message, error: true }));
    api.teamPlayers().then((players) => setRoster(players.map((p) => p.nick))).catch(() => {});
  }, []);

  const open = useCallback((b: Board, saved: boolean) => {
    past.current = [];
    future.current = [];
    setBoardState(b);
    setSavedJson(saved ? JSON.stringify(b) : null);
    setStep(0);
    setSelected(null);
    setPlaying(false);
  }, []);

  useEffect(() => {
    if (id && id === boardRef.current?.id) return; // just saved: the URL caught up with the board
    if (id && id !== "draft") {
      api.board(id).then((b) => open(b, true)).catch((e: Error) => setMsg({ text: e.message, error: true }));
      return;
    }
    const draft = id === "draft" ? takeDraft() : null;
    if (draft) return open(draft, false);
    if (boardRef.current && !boardRef.current.id) return; // already editing a new board
    let wip: Board | null = null;
    try {
      wip = JSON.parse(read(WIP_STORAGE) ?? "null");
    } catch {
      /* a broken draft: start over */
    }
    if (wip && !wip.id && wip.format === 1) open(wip, false);
    else if (maps.length) open(emptyBoard(maps.includes("de_mirage") ? "de_mirage" : maps[0]), false);
  }, [id, maps, open]);

  // unsaved work survives a reload or leaving the page
  useEffect(() => {
    if (board) store(WIP_STORAGE, JSON.stringify(board));
  }, [board]);

  const refreshList = useCallback(() => {
    api.boards().then(setList).catch(() => {});
  }, []);
  useEffect(refreshList, [refreshList]);

  // ---- history ----
  const commit = useCallback((next: Board, from?: Board) => {
    const prev = from ?? boardRef.current;
    if (prev && JSON.stringify(prev) !== JSON.stringify(next)) {
      past.current.push(prev);
      if (past.current.length > 300) past.current.shift();
      future.current = [];
      setHistoryTick((n) => n + 1);
    }
    setBoardState(next);
  }, []);
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev || !boardRef.current) return;
    future.current.push(boardRef.current);
    setBoardState(prev);
    setSelected(null);
    setHistoryTick((n) => n + 1);
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next || !boardRef.current) return;
    past.current.push(boardRef.current);
    setBoardState(next);
    setSelected(null);
    setHistoryTick((n) => n + 1);
  }, []);

  // ---- layout ----
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [board === null]);

  const multi = (ready?.meta.levels.length ?? 1) > 1;
  const levels = ready ? panelLevels(ready.meta, multi ? view : 0) : [0];
  const size = Math.max(360, Math.min(Math.floor(boxWidth / levels.length), window.innerHeight - 250));
  const width_ = size * levels.length;
  const dpr = window.devicePixelRatio || 1;

  // ---- drawing ----
  const render = useCallback(() => {
    const c = canvasRef.current;
    const b = boardRef.current;
    if (!c || !ready || !b) return;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const d = drag.current;
    if (playing) {
      const fr = animFrame(b.steps.length, animT.current);
      drawBoard(ctx, ready, b, { step: fr.step, f: fr.f, levels, size, callouts: callouts !== "off" });
    } else {
      drawBoard(ctx, ready, b, {
        step, levels, size, selected, onion, callouts: callouts !== "off", draft: d?.kind === "draw" ? d.mark : null,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, board, step, levels.join(","), size, selected, onion, callouts, playing, dpr]);
  useEffect(render, [render]);

  // playback
  useEffect(() => {
    if (!playing || !board) return;
    const total = animDuration(board.steps.length);
    let raf = 0, last = performance.now();
    animT.current = 0;
    const frame = (now: number) => {
      animT.current += (now - last) / 1000;
      last = now;
      if (animT.current >= total) {
        animT.current = total;
        render();
        setPlaying(false);
        setStep(board.steps.length - 1);
        return;
      }
      render();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // ---- pointer -> radar px of a level ----
  const locate = (clientX: number, clientY: number): BoardPos | null => {
    const c = canvasRef.current;
    if (!c) return null;
    const box = c.getBoundingClientRect();
    const x = clientX - box.left, y = clientY - box.top;
    const panel = Math.floor(x / size);
    if (panel < 0 || panel >= levels.length || y < 0 || y > size) return null;
    const k = size / RADAR_SIZE;
    return { x: (x - panel * size) / k, y: y / k, l: levels[panel] };
  };
  const tol = 4 * (RADAR_SIZE / size);
  const hit = (p: BoardPos) => (board && ready ? hitTest(board, ready.meta, step, p.l, p.x, p.y, tol, selected) : null);

  const eraseAt = (p: BoardPos) => {
    const b = boardRef.current;
    if (!b || !ready) return;
    const h = hitTest(b, ready.meta, step, p.l, p.x, p.y, tol * 2, null);
    if (h?.kind === "mark") setBoardState(removeItem(b, h.id));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!board || playing || edit) return;
    const p = locate(e.clientX, e.clientY);
    if (!p) return;
    if (e.button === 2) {
      const h = hit(p);
      if (h) {
        commit(removeItem(board, h.id));
        if (selected === h.id) setSelected(null);
      }
      return;
    }
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "select") {
      const h = hit(p);
      setSelected(h?.id ?? null);
      if (!h) return;
      if (h.kind === "token") drag.current = { kind: "token", id: h.id, start: board, trail: [p] };
      else if (h.handle) drag.current = { kind: "handle", id: h.id, start: board, l: p.l };
      else drag.current = { kind: "mark", id: h.id, start: board, l: p.l, last: [p.x, p.y] };
      return;
    }
    if (tool === "eraser") {
      drag.current = { kind: "erase", start: board };
      eraseAt(p);
      return;
    }
    if (tool === "text") {
      // after this press is over: its mousedown would move the focus away from the new field
      e.preventDefault();
      requestAnimationFrame(() => setEdit({ target: { kind: "mark", id: null }, l: p.l, x: p.x, y: p.y, value: "" }));
      return;
    }
    drag.current = { kind: "draw", start: board, mark: startMark(tool, step, p, color, width), origin: [p.x, p.y], shift: e.shiftKey };
    render();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const b = boardRef.current;
    if (!d || !b) {
      if (tool === "select" && board) {
        const p = locate(e.clientX, e.clientY);
        e.currentTarget.style.cursor = p && hit(p) ? "move" : "default";
      }
      return;
    }
    const p = locate(e.clientX, e.clientY);
    if (!p) return;
    switch (d.kind) {
      case "token": {
        d.trail.push(p);
        setBoardState(moveToken(d.start, d.id, step, p, step > 0 ? simplify(d.trail.slice(0, -1)) : []));
        break;
      }
      case "mark": {
        if (p.l !== d.l) return;
        const dx = p.x - d.last[0], dy = p.y - d.last[1];
        d.last = [p.x, p.y];
        setBoardState(updateMark(b, d.id, (m) => ({ ...m, pts: m.pts.map(([x, y]) => [x + dx, y + dy] as [number, number]) })));
        break;
      }
      case "handle": {
        if (p.l !== d.l) return;
        setBoardState(updateMark(b, d.id, (m) => ({ ...m, pts: [m.pts[0], [p.x, p.y]] })));
        break;
      }
      case "erase":
        eraseAt(p);
        break;
      case "draw": {
        if (p.l !== d.mark.l) return;
        stretchMark(d.mark, d.origin, p.x, p.y, e.shiftKey);
        render();
        break;
      }
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    const b = boardRef.current;
    if (!d || !b) return;
    if (d.kind === "draw") {
      if (strayMark(d.mark)) return render();
      commit({ ...b, marks: [...b.marks, d.mark] }, d.start);
      return;
    }
    commit(b, d.start);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!board || playing) return;
    const p = locate(e.clientX, e.clientY);
    const h = p && hit(p);
    if (!p || !h) return;
    if (h.kind === "token") {
      const tok = board.tokens.find((x) => x.id === h.id)!;
      if (tok.type !== "player") return;
      const at = posAt(tok, step)!;
      setEdit({ target: { kind: "token", id: tok.id }, l: at.l, x: at.x, y: at.y - TOKEN_R - 22, value: tok.label ?? "" });
    } else {
      const m = board.marks.find((x) => x.id === h.id)!;
      if (m.type === "text") setEdit({ target: { kind: "mark", id: m.id }, l: m.l, x: m.pts[0][0], y: m.pts[0][1], value: m.text ?? "" });
    }
  };

  const finishEdit = (save: boolean, picked?: string) => {
    const ed = edit;
    setEdit(null);
    const b = boardRef.current;
    if (!ed || !b || !save) return;
    const value = (picked ?? ed.value).trim();
    if (ed.target.kind === "token") {
      commit(updateToken(b, ed.target.id, (tok) => ({ ...tok, label: value.slice(0, 24) })));
    } else if (ed.target.id) {
      commit(value ? updateMark(b, ed.target.id, (m) => ({ ...m, text: value })) : removeItem(b, ed.target.id));
    } else if (value) {
      const m: BoardMark = { id: newId(), type: "text", step, l: ed.l, pts: [[ed.x, ed.y]], color, text: value.slice(0, 200) };
      commit({ ...b, marks: [...b.marks, m] });
      setSelected(m.id);
      setTool("select");
    }
  };

  // ---- adding from the toolbar: drag onto the map, or click to drop it in the middle ----
  const add = (item: DragItem, at: BoardPos) => {
    const b = boardRef.current;
    if (!b) return;
    if (item.t === "nade") {
      const m: BoardMark = { id: newId(), type: "nade", kind: item.kind, step, l: at.l, pts: [[at.x, at.y]] };
      commit({ ...b, marks: [...b.marks, m] });
      setSelected(m.id);
    } else if (item.t === "bomb") {
      const bomb = b.tokens.find((x) => x.type === "bomb");
      if (bomb) {
        commit(moveToken(b, bomb.id, step, at));
        setSelected(bomb.id);
      } else {
        const tok = newToken(b, { id: newId(), type: "bomb", pos: [], route: [] }, step, at);
        commit({ ...b, tokens: [...b.tokens, tok] });
        setSelected(tok.id);
      }
    } else {
      const tok = newPlayer(b, item.side, step, at);
      commit({ ...b, tokens: [...b.tokens, tok] });
      setSelected(tok.id);
    }
    setTool("select");
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DND);
    const p = locate(e.clientX, e.clientY);
    if (raw && p) add(JSON.parse(raw) as DragItem, p);
  };
  const dragSource = (item: DragItem) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(DND, JSON.stringify(item));
      e.dataTransfer.effectAllowed = "copy";
    },
    onClick: () => add(item, { x: RADAR_SIZE / 2 + (Math.random() - 0.5) * 60, y: RADAR_SIZE / 2 + (Math.random() - 0.5) * 60, l: levels[0] }),
  });

  // ---- hotkeys ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !boardRef.current) return;
      if (binding) {
        e.preventDefault();
        if (e.key !== "Escape") {
          const next = { ...keys, [binding]: e.key.toLowerCase() };
          setKeys(next);
          store(KEYS_STORAGE, JSON.stringify(next));
        }
        setBinding(null);
        return;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ctrl && k === "z") {
        e.preventDefault();
        return e.shiftKey ? redo() : undo();
      }
      if (ctrl && k === "y") {
        e.preventDefault();
        return redo();
      }
      if (ctrl) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        commit(removeItem(boardRef.current, selected));
        setSelected(null);
        return;
      }
      if (e.key === "Escape") {
        setSelected(null);
        setTool("select");
        setPlaying(false);
        return;
      }
      const n = boardRef.current.steps.length;
      if (/^[1-4]$/.test(e.key) && Number(e.key) <= n) {
        setStep(Number(e.key) - 1);
        return;
      }
      const action = (Object.keys(keys) as Action[]).find((a) => keys[a] === k);
      if (!action) return;
      e.preventDefault();
      if (action === "play") setPlaying((p) => !p);
      else if (action === "onion") setOnion((o) => !o);
      else if (action === "prevStep") setStep((s) => Math.max(0, s - 1));
      else if (action === "nextStep") setStep((s) => Math.min(n - 1, s + 1));
      else setTool(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keys, binding, selected, undo, redo, commit]);

  // ---- saving ----
  const dirty = board !== null && JSON.stringify(board) !== savedJson;
  const withAuthor = (b: Board): Board => ({ ...b, author: b.author || author });
  const save = async (asNew: boolean) => {
    if (!board) return;
    setBusy("save");
    try {
      const body = withAuthor(board);
      const saved = board.id && !asNew ? await api.updateBoard(board.id, body) : await api.createBoard({ ...body, id: undefined });
      setBoardState(saved);
      boardRef.current = saved;
      setSavedJson(JSON.stringify(saved));
      store(WIP_STORAGE, null);
      setMsg({ text: t("board.savedMsg") });
      refreshList();
      if (saved.id !== id) go("board", saved.id!);
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };
  const remove = async (b: BoardSummary) => {
    if (!window.confirm(t("board.confirmDelete", { name: b.name || t("board.untitled") }))) return;
    try {
      await api.deleteBoard(b.id);
      refreshList();
      if (board?.id === b.id) {
        setBoardState({ ...board, id: undefined, created: undefined, updated: undefined });
        setSavedJson(null);
        go("board");
      }
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    }
  };
  const newBoard = () => {
    if (dirty && !window.confirm(t("board.confirmDiscard"))) return;
    open(emptyBoard(board?.map ?? maps[0]), false);
    go("board");
  };
  const changeMap = (map: string) => {
    if (!board || map === board.map) return;
    const has = board.tokens.length + board.marks.length > 0;
    if (has && !window.confirm(t("board.confirmMap"))) return;
    commit({ ...board, map, tokens: [], marks: [] });
    setSelected(null);
  };
  const clearAll = () => {
    if (!board || board.tokens.length + board.marks.length === 0) return;
    if (!window.confirm(t("board.confirmClear"))) return;
    commit({ ...board, tokens: [], marks: [] });
    setSelected(null);
  };

  // ---- export ----
  const fileBase = () => `${(board?.name || "tactic").replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 60)}_${board?.map.replace(/^de_/, "")}`;
  const CAP = 44;
  const exportPng = async (all: boolean) => {
    if (!board || !ready) return;
    const cell = all ? 720 : 1024;
    const steps = all ? board.steps.map((_, i) => i) : [step];
    const cols = all && steps.length > 1 ? 2 : 1;
    const rows = Math.ceil(steps.length / cols);
    const w = cell * levels.length;
    const c = document.createElement("canvas");
    c.width = w * cols;
    c.height = (cell + CAP) * rows;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#0b0b0b";
    ctx.fillRect(0, 0, c.width, c.height);
    steps.forEach((s, i) => {
      const x = (i % cols) * w, y = Math.floor(i / cols) * (cell + CAP);
      drawCaption(ctx, board, x, y, w, CAP, `${s + 1}. ${stepName(board, s)}`);
      drawBoard(ctx, ready, board, { step: s, levels, size: cell, ox: x, oy: y + CAP, onion: false, callouts: callouts !== "off" });
    });
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    if (blob) download(blob, `${fileBase()}${all ? "_steps" : `_step${step + 1}`}.png`);
  };
  const exportAnim = async (format: "gif" | "mp4") => {
    if (!board || !ready) return;
    const cell = format === "gif" ? 640 : 720;
    const w = cell * levels.length, h = cell + CAP;
    const ac = new AbortController();
    abort.current = ac;
    setBusy(format);
    try {
      const job = {
        width: w, height: h, duration: animDuration(board.steps.length), speed: 1, fps: format === "gif" ? 15 : 30, signal: ac.signal,
        onProgress: (f: number) => setMsg({ text: t("board.exporting", { pct: Math.round(f * 100) }) }),
        render: (ctx: CanvasRenderingContext2D, time: number) => {
          const fr = animFrame(board.steps.length, time);
          ctx.fillStyle = "#0b0b0b";
          ctx.fillRect(0, 0, w, h);
          drawCaption(ctx, board, 0, 0, w, CAP, `${fr.step + 1}. ${stepName(board, fr.step)}`);
          drawBoard(ctx, ready, board, { step: fr.step, f: fr.f, levels, size: cell, oy: CAP, callouts: callouts !== "off" });
        },
      };
      const blob = format === "gif" ? await exportGif(job) : await exportMp4(job);
      download(blob, `${fileBase()}.${format}`);
      setMsg(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setMsg({ text: (e as Error).message, error: true });
      else setMsg(null);
    } finally {
      setBusy(null);
      abort.current = null;
    }
  };

  const sel = useMemo(() => {
    if (!board || !selected) return null;
    const tok = board.tokens.find((x) => x.id === selected);
    if (tok) return { tok, mark: null };
    const mark = board.marks.find((x) => x.id === selected);
    return mark ? { tok: null, mark } : null;
  }, [board, selected]);

  const filtered = listAll || !board ? list : list.filter((b) => b.map === board.map);

  if (!board) {
    return (
      <div className="page">
        <div className="pagehead"><h1>{t("board.title")}</h1></div>
        {msg?.error ? <div className="error">{msg.text}</div> : <div className="muted">{t("common.loading")}</div>}
      </div>
    );
  }

  const editStyle = edit ? (() => {
    const panel = levels.indexOf(edit.l);
    const k = size / RADAR_SIZE;
    return { left: Math.max(0, panel * size + edit.x * k - 90), top: Math.max(0, edit.y * k - 18) };
  })() : null;

  return (
    <div className="page board-page">
      <div className="board-head">
        <h1>{t("board.title")}</h1>
        <input className="board-name" value={board.name} placeholder={t("board.namePlaceholder")} maxLength={80}
          onChange={(e) => setBoardState({ ...board, name: e.target.value })} />
        <select value={board.map} onChange={(e) => changeMap(e.target.value)} title={t("board.map")}>
          {(maps.includes(board.map) ? maps : [board.map, ...maps]).map((m) => <option key={m} value={m}>{mapPretty(m)}</option>)}
        </select>
        {multi && ready && (
          <span className="seg">
            {ready.meta.levels.map((_, i) => (
              <button key={i} className={view === i ? "on" : ""} onClick={() => setView(i)}>{levelLabel(ready.meta, i)}</button>
            ))}
            <button className={view === "all" ? "on" : ""} onClick={() => setView("all")}>{t("common.both")}</button>
          </span>
        )}
        <CalloutToggle meta={ready?.meta} />
        <span className="grow" />
        {board.source && (
          <button onClick={() => go("match", board.source!.match, "replay", board.source!.round, Math.round(board.source!.sec * 10) / 10)}
            title={t("board.backToReplayTitle", { round: board.source.round })}>
            {t("board.backToReplay")}
          </button>
        )}
        {board.id && (
          <button title={t("board.copyLinkTitle")} onClick={async () => {
            const url = shareUrl("board", board.id!);
            setMsg({ text: (await copyText(url)) ? t("replay.copied", { text: url }) : url });
          }}>
            {t("common.link")}
          </button>
        )}
        <button onClick={newBoard}>{t("board.new")}</button>
        {board.id ? (
          <>
            <button className="primary" disabled={!dirty || busy !== null} onClick={() => save(false)}>{t("board.update")}</button>
            <button disabled={busy !== null} onClick={() => save(true)}>{t("board.saveAsNew")}</button>
          </>
        ) : (
          <button className="primary" disabled={busy !== null} onClick={() => save(true)}>{t("common.save")}</button>
        )}
      </div>

      <div className="board-layout">
        <div className="board-main">
          <div className="board-steps">
            {board.steps.map((_, i) => (
              <button key={i} className={`board-step ${step === i && !playing ? "on" : ""}`} onClick={() => setStep(i)}
                onDoubleClick={() => {
                  const name = window.prompt(t("board.renameStep"), stepName(board, i));
                  if (name === null) return;
                  const v = name.trim() === t(STEP_KEYS[i]) ? "" : name.trim().slice(0, 40);
                  commit({ ...board, steps: board.steps.map((s, j) => (j === i ? v : s)) });
                }}
                title={t("board.stepTitle")}>
                <b>{i + 1}</b> {stepName(board, i)}
              </button>
            ))}
            <button className="small-btn" disabled={board.steps.length >= MAX_STEPS} onClick={() => commit(setSteps(board, board.steps.length + 1))} title={t("board.addStep")}>+</button>
            <button className="small-btn" disabled={board.steps.length <= 1}
              onClick={() => {
                const last = board.steps.length - 1;
                const used = board.marks.some((m) => m.step === last) || board.tokens.some((x) => x.pos[last]);
                if (used && !window.confirm(t("board.confirmRemoveStep"))) return;
                commit(setSteps(board, last));
                setStep((s) => Math.min(s, last - 1));
              }}
              title={t("board.removeStep")}>−</button>
            <label className="small"><input type="checkbox" checked={onion} onChange={(e) => setOnion(e.target.checked)} /> {t("board.onion")}</label>
            <span className="grow" />
            <button className="primary" disabled={board.steps.length < 2} onClick={() => setPlaying((p) => !p)}>
              {playing ? `■ ${t("board.stop")}` : `▶ ${t("board.play")}`}
            </button>
          </div>

          <div className="board-stage" ref={boxRef}>
            {mapError ? <div className="error">{mapError}</div> : !ready ? (
              <div className="muted" style={{ height: size }}>{t("common.loading")}</div>
            ) : (
              <div
                style={{ position: "relative", width: width_, height: size, cursor: tool === "select" ? "default" : "crosshair", touchAction: "none" }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onDoubleClick={onDoubleClick}
                onContextMenu={(e) => e.preventDefault()}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes(DND)) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                  }
                }}
                onDrop={onDrop}
              >
                <canvas ref={canvasRef} width={width_ * dpr} height={size * dpr} style={{ width: width_, height: size }} />
                {edit && editStyle && (
                  <textarea
                    className="board-edit"
                    style={editStyle}
                    autoFocus
                    rows={edit.target.kind === "token" ? 1 : 2}
                    maxLength={edit.target.kind === "token" ? 24 : 200}
                    value={edit.value}
                    placeholder={edit.target.kind === "token" ? t("board.playerName") : t("board.textPlaceholder")}
                    onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        finishEdit(true);
                      } else if (e.key === "Escape") finishEdit(false);
                    }}
                    onBlur={() => finishEdit(true)}
                  />
                )}
                {edit && editStyle && edit.target.kind === "token" && roster.length > 0 && (
                  <div className="board-roster" style={{ left: editStyle.left, top: editStyle.top + 34 }} title={t("board.rosterTitle")}>
                    {roster.map((nick) => (
                      // on press, before the field loses focus and saves what was typed
                      <button key={nick} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); finishEdit(true, nick); }}>{nick}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="board-toolbar">
            <span className="seg">
              {TOOLS.map(([k, label]) => (
                <button key={k} className={tool === k ? "on" : ""} onClick={() => setTool(k)} title={`${t(label)} (${keyName(keys[k])})`}>
                  <ToolIcon tool={k} />
                </button>
              ))}
            </span>
            <span className="board-colors">
              {PEN_COLORS.map((c) => (
                <button key={c} className={color === c ? "on" : ""} style={{ background: c }} onClick={() => {
                  setColor(c);
                  if (sel?.mark && sel.mark.type !== "nade") commit(updateMark(board, sel.mark.id, (m) => ({ ...m, color: c })));
                }} aria-label={c} />
              ))}
            </span>
            <span className="seg">
              {PEN_WIDTHS.map((w) => (
                <button key={w} className={width === w ? "on" : ""} onClick={() => {
                  setWidth(w);
                  if (sel?.mark && ["pen", "arrow", "rect", "circle"].includes(sel.mark.type)) commit(updateMark(board, sel.mark.id, (m) => ({ ...m, width: w })));
                }} title={t("board.lineWidth")}>
                  <i className="board-width" style={{ height: Math.max(2, w / 2) }} />
                </button>
              ))}
            </span>
            <span className="board-sep" />
            <span className="board-tokens" title={t("board.dragHint")}>
              <span className="board-token" style={{ background: CT_COLOR }} {...dragSource({ t: "player", side: "ct" })} title={t("board.ctPlayer")}>CT</span>
              <span className="board-token" style={{ background: T_COLOR }} {...dragSource({ t: "player", side: "t" })} title={t("board.tPlayer")}>T</span>
              <span className="board-token bomb" {...dragSource({ t: "bomb" })} title={t("board.bomb")}>C4</span>
            </span>
            <span className="board-sep" />
            <span className="board-tokens" title={t("board.dragHint")}>
              {NADES.map((n) => (
                <span key={n} className="board-nade" style={{ borderColor: NADE_COLORS[n], color: NADE_COLORS[n] }} {...dragSource({ t: "nade", kind: n })} title={t(NADE_KEYS[n])}>
                  {NADE_SHORT[n]}
                </span>
              ))}
            </span>
            <span className="grow" />
            <button onClick={undo} disabled={!past.current.length} title={t("board.undo")}>↶</button>
            <button onClick={redo} disabled={!future.current.length} title={t("board.redo")}>↷</button>
            <button className="danger" onClick={clearAll} title={t("board.clearAll")}>{t("board.clear")}</button>
          </div>

          {sel && (
            <div className="board-selection">
              {sel.tok?.type === "player" && (
                <>
                  <span className="muted small">{t("board.player")}</span>
                  <input value={sel.tok.label ?? ""} maxLength={24} placeholder={t("board.playerName")}
                    onFocus={() => (labelStart.current = board)}
                    onChange={(e) => setBoardState(updateToken(board, sel.tok!.id, (x) => ({ ...x, label: e.target.value })))}
                    onBlur={() => labelStart.current && commit(board, labelStart.current)} />
                  <span className="seg">
                    {(["ct", "t"] as const).map((s) => (
                      <button key={s} className={sel.tok!.side === s ? "on" : ""} onClick={() => commit(updateToken(board, sel.tok!.id, (x) => ({ ...x, side: s })))}>{s.toUpperCase()}</button>
                    ))}
                  </span>
                </>
              )}
              {sel.tok && step > 0 && (
                <>
                  <button disabled={!sel.tok.route[step]?.length} onClick={() => commit(clearRoute(board, sel.tok!.id, step))}>{t("board.clearPath")}</button>
                  <button disabled={!sel.tok.pos[step] || !sel.tok.pos.slice(0, step).some(Boolean)}
                    onClick={() => commit(updateToken(board, sel.tok!.id, (x) => ({ ...x, pos: x.pos.map((p, i) => (i === step ? null : p)), route: x.route.map((r, i) => (i === step ? [] : r)) })))}
                    title={t("board.stayTitle")}>
                    {t("board.stay")}
                  </button>
                </>
              )}
              {sel.mark?.type === "nade" && (
                <>
                  <span className="seg">
                    {NADES.map((n) => (
                      <button key={n} className={sel.mark!.kind === n ? "on" : ""} onClick={() => commit(updateMark(board, sel.mark!.id, (m) => ({ ...m, kind: n })))} title={t(NADE_KEYS[n])}>
                        {NADE_SHORT[n]}
                      </button>
                    ))}
                  </span>
                  {sel.mark.pts[1] ? (
                    <button onClick={() => commit(updateMark(board, sel.mark!.id, (m) => ({ ...m, pts: [m.pts[0]] })))}>{t("board.removeThrow")}</button>
                  ) : <span className="muted small">{t("board.throwHint")}</span>}
                </>
              )}
              {sel.mark?.type === "text" && <span className="muted small">{t("board.textEditHint")}</span>}
              <span className="grow" />
              <button className="danger" onClick={() => {
                commit(removeItem(board, sel.tok?.id ?? sel.mark!.id));
                setSelected(null);
              }}>{t("common.delete")}</button>
            </div>
          )}

          <div className="board-foot">
            <span className="muted small">{t("board.hint")}</span>
            <span className="grow" />
            <button className="small-btn" onClick={() => setShowKeys((s) => !s)}>⌨ {t("board.hotkeys")}</button>
            <button className="small-btn" disabled={busy !== null} onClick={() => exportPng(false)}>{t("board.pngStep")}</button>
            <button className="small-btn" disabled={busy !== null} onClick={() => exportPng(true)}>{t("board.pngAll")}</button>
            <button className="small-btn" disabled={busy !== null || board.steps.length < 2} onClick={() => exportAnim("gif")}>GIF</button>
            <button className="small-btn" disabled={busy !== null || board.steps.length < 2 || !canEncodeVideo()} onClick={() => exportAnim("mp4")}>MP4</button>
            {(busy === "gif" || busy === "mp4") && <button className="small-btn danger" onClick={() => abort.current?.abort()}>{t("common.cancel")}</button>}
          </div>
          {msg && <div className={msg.error ? "error" : "muted small"}>{msg.text}</div>}

          {showKeys && (
            <div className="board-keys">
              {ACTIONS.map(([a, label]) => (
                <label key={a}>
                  <span>{t(label)}</span>
                  <button className={binding === a ? "on" : ""} onClick={() => setBinding(binding === a ? null : a)}>
                    {binding === a ? t("board.pressKey") : keyName(keys[a])}
                  </button>
                </label>
              ))}
              <label><span>{t("board.undo")}</span><kbd>Ctrl+Z</kbd></label>
              <label><span>{t("board.redo")}</span><kbd>Ctrl+Shift+Z</kbd></label>
              <label><span>{t("common.delete")}</span><kbd>Del</kbd></label>
              <label><span>{t("board.steps")}</span><kbd>1–4</kbd></label>
              <button className="small-btn" onClick={() => {
                setKeys({ ...DEFAULT_KEYS });
                store(KEYS_STORAGE, null);
              }}>{t("board.resetKeys")}</button>
            </div>
          )}
        </div>

        <aside className="board-side">
          <div className="board-side-head">
            <h3>{t("board.saved")}</h3>
            <label className="small"><input type="checkbox" checked={listAll} onChange={(e) => setListAll(e.target.checked)} /> {t("board.allMaps")}</label>
          </div>
          <label className="small board-author">
            {t("board.author")}
            <input value={board.author || author} maxLength={40} placeholder={t("board.authorPlaceholder")} onChange={(e) => {
              setAuthor(e.target.value);
              store(AUTHOR_STORAGE, e.target.value);
              setBoardState({ ...board, author: e.target.value });
            }} />
          </label>
          {filtered.length === 0 && <div className="muted small">{t("board.none")}</div>}
          <div className="board-list">
            {filtered.map((b) => (
              <div key={b.id} className={`board-item ${b.id === board.id ? "on" : ""}`} onClick={() => {
                if (b.id === board.id) return;
                if (dirty && !window.confirm(t("board.confirmDiscard"))) return;
                go("board", b.id);
              }}>
                <div className="board-item-name">{b.name || t("board.untitled")}</div>
                <div className="muted small">
                  {mapPretty(b.map)} · {t("board.stepsN", { n: b.steps })}{b.author ? ` · ${b.author}` : ""}
                </div>
                <div className="muted small">{new Date(b.updated * 1000).toLocaleString()}</div>
                <button className="card-del" onClick={(e) => {
                  e.stopPropagation();
                  remove(b);
                }} title={t("common.delete")}>✕</button>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
