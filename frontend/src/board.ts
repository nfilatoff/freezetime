// Tactics board model and drawing: steps, tokens (players, the bomb) with routes between steps,
// marks (grenades, strokes, shapes, texts) on one step each. Shared by the board page, its
// exports and the "replay frame -> board" transfer. Everything is drawn in radar pixels
// (RADAR_SIZE per level), so a board looks the same at any canvas size.
import type { Board, BoardMark, BoardPos, BoardToken, MapMeta, NadeKind, Replay } from "./api";
import { drawCallouts } from "./callouts";
import { t, type Key } from "./i18n";
import { CT_COLOR, RADAR_SIZE, T_COLOR, drawRadar, levelLabel, levelOf, worldToPx, type MapAssets } from "./radar";
import { FIRE_RADIUS, NADE_COLORS, SMOKE_RADIUS, bombState, playerStates } from "./replayDraw";

export const MAX_STEPS = 4;
export const STEP_KEYS: Key[] = ["board.step.default", "board.step.utility", "board.step.entry", "board.step.postplant"];
export const NADES: NadeKind[] = ["smoke", "molotov", "incendiary", "flashbang", "he", "decoy"];
/** Effect radius of each grenade, world units (the same values the replay draws). */
export const NADE_RADIUS: Record<NadeKind, number> = {
  smoke: SMOKE_RADIUS, molotov: FIRE_RADIUS, incendiary: FIRE_RADIUS, flashbang: 120, he: 200, decoy: 40,
};
export const NADE_SHORT: Record<NadeKind, string> = { smoke: "S", molotov: "M", incendiary: "I", flashbang: "F", he: "HE", decoy: "D" };
export const PEN_COLORS = ["#ffffff", "#ff4d4f", "#f2c94c", "#3ddc84", "#5aa9ff"];
export const PEN_WIDTHS = [3, 5, 9]; // radar px
export const TOKEN_R = 13; // radar px
const BOMB_W = 22, BOMB_H = 15;
const TEXT_SIZE = 19;

export const stepName = (b: Board, i: number) => b.steps[i] || t(STEP_KEYS[i]);
export const newId = () => Math.random().toString(36).slice(2, 10);

export function emptyBoard(map: string): Board {
  return { format: 1, name: "", map, author: "", steps: ["", "", "", ""], tokens: [], marks: [] };
}

// ---- positions and routes ----

/** Where a token stands on a step: its own position there, else the last one before; null before it first appears. */
export function posAt(tok: BoardToken, step: number): BoardPos | null {
  for (let i = Math.min(step, tok.pos.length - 1); i >= 0; i--) if (tok.pos[i]) return tok.pos[i];
  return null;
}

/** The path a token walks into a step: from where it stood before, through the route, to its position. */
export function routeInto(tok: BoardToken, step: number): BoardPos[] | null {
  if (step <= 0 || !tok.pos[step]) return null;
  const from = posAt(tok, step - 1);
  if (!from) return null;
  return [from, ...(tok.route[step] ?? []), tok.pos[step]!];
}

/** A point a fraction `f` of the way along a path (by length; a jump between levels counts as nothing). */
export function along(path: BoardPos[], f: number): BoardPos {
  if (path.length === 1 || f <= 0) return path[0];
  if (f >= 1) return path[path.length - 1];
  const seg = path.slice(1).map((p, i) => (p.l === path[i].l ? Math.hypot(p.x - path[i].x, p.y - path[i].y) : 0));
  const total = seg.reduce((a, b) => a + b, 0);
  if (total === 0) return f < 0.5 ? path[0] : path[path.length - 1];
  let left = f * total;
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i] && seg[i] > 0) {
      const q = left / seg[i], a = path[i], b = path[i + 1];
      return { x: a.x + (b.x - a.x) * q, y: a.y + (b.y - a.y) * q, l: b.l };
    }
    left -= seg[i];
  }
  return path[path.length - 1];
}

/** Drop points closer than `min` radar px to the previous one: a drag records far more than a route needs. */
export function simplify(pts: BoardPos[], min = 10): BoardPos[] {
  const out: BoardPos[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || last.l !== p.l || Math.hypot(p.x - last.x, p.y - last.y) >= min) out.push(p);
  }
  return out;
}

// ---- board edits (pure: every one returns a new board) ----

export function setSteps(b: Board, n: number): Board {
  n = Math.max(1, Math.min(MAX_STEPS, n));
  const fit = <T,>(a: T[], fill: T) => [...a.slice(0, n), ...Array(Math.max(0, n - a.length)).fill(fill)] as T[];
  return {
    ...b,
    steps: fit(b.steps, ""),
    marks: b.marks.filter((m) => m.step < n),
    tokens: b.tokens
      .map((tok) => ({ ...tok, pos: fit(tok.pos, null), route: fit(tok.route, []) }))
      .filter((tok) => tok.pos.some(Boolean)),
  };
}

export function moveToken(b: Board, id: string, step: number, to: BoardPos, route: BoardPos[] = []): Board {
  return {
    ...b,
    tokens: b.tokens.map((tok) => {
      if (tok.id !== id) return tok;
      const pos = [...tok.pos], r = tok.route.map((x) => [...x]);
      while (r.length < pos.length) r.push([]);
      pos[step] = to;
      r[step] = step > 0 ? route : [];
      return { ...tok, pos, route: r };
    }),
  };
}

export function clearRoute(b: Board, id: string, step: number): Board {
  return { ...b, tokens: b.tokens.map((tok) => (tok.id === id ? { ...tok, route: tok.route.map((r, i) => (i === step ? [] : r)) } : tok)) };
}

export const removeItem = (b: Board, id: string): Board => ({
  ...b, tokens: b.tokens.filter((x) => x.id !== id), marks: b.marks.filter((x) => x.id !== id),
});

export const updateMark = (b: Board, id: string, f: (m: BoardMark) => BoardMark): Board => ({
  ...b, marks: b.marks.map((m) => (m.id === id ? f(m) : m)),
});

export const updateToken = (b: Board, id: string, f: (tok: BoardToken) => BoardToken): Board => ({
  ...b, tokens: b.tokens.map((x) => (x.id === id ? f(x) : x)),
});

/** A new player token placed on a step, labelled with the next free number of its side. */
export function newPlayer(b: Board, side: "ct" | "t", step: number, at: BoardPos): BoardToken {
  const used = new Set(b.tokens.filter((x) => x.side === side).map((x) => x.label));
  let n = 1;
  while (used.has(String(n))) n++;
  return newToken(b, { id: newId(), type: "player", side, label: String(n), pos: [], route: [] }, step, at);
}

export function newToken(b: Board, tok: BoardToken, step: number, at: BoardPos): BoardToken {
  const pos: (BoardPos | null)[] = b.steps.map(() => null);
  pos[step] = at;
  return { ...tok, pos, route: b.steps.map(() => []) };
}

// ---- hit testing (radar px) ----

export type Hit = { kind: "token" | "mark"; id: string; handle?: boolean };

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const q = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - ax - q * dx, py - ay - q * dy);
}

function markDist(m: BoardMark, x: number, y: number, meta: MapMeta): number {
  const p = m.pts;
  switch (m.type) {
    case "nade": {
      const r = NADE_RADIUS[m.kind ?? "smoke"] / meta.scale;
      return Math.max(0, Math.hypot(x - p[0][0], y - p[0][1]) - Math.min(r, 18));
    }
    case "text": {
      const [w, h] = textBox(m.text ?? "");
      return Math.abs(x - p[0][0]) <= w / 2 && Math.abs(y - p[0][1]) <= h / 2 ? 0 : Infinity;
    }
    case "rect": {
      const [a, b] = [p[0], p[1] ?? p[0]];
      const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
      return Math.min(segDist(x, y, x0, y0, x1, y0), segDist(x, y, x1, y0, x1, y1), segDist(x, y, x1, y1, x0, y1), segDist(x, y, x0, y1, x0, y0));
    }
    case "circle": {
      const [a, b] = [p[0], p[1] ?? p[0]];
      const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, rx = Math.abs(b[0] - a[0]) / 2 || 1, ry = Math.abs(b[1] - a[1]) / 2 || 1;
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry); // 1 on the outline
      return Math.abs(d - 1) * Math.min(rx, ry);
    }
    default: {
      if (p.length === 1) return Math.hypot(x - p[0][0], y - p[0][1]);
      let best = Infinity;
      for (let i = 1; i < p.length; i++) best = Math.min(best, segDist(x, y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]));
      return best;
    }
  }
}

/** The topmost thing under a point of a level on a step: tokens over marks, later marks over earlier ones. */
export function hitTest(b: Board, meta: MapMeta, step: number, l: number, x: number, y: number, tol: number, selected: string | null): Hit | null {
  // the throw handle of the selected grenade first: it sits on top of everything
  const sel = b.marks.find((m) => m.id === selected && m.type === "nade" && m.step === step && m.l === l);
  if (sel) {
    const [hx, hy] = throwHandle(sel);
    if (Math.hypot(x - hx, y - hy) <= 9 + tol) return { kind: "mark", id: sel.id, handle: true };
  }
  for (let i = b.tokens.length - 1; i >= 0; i--) {
    const p = posAt(b.tokens[i], step);
    if (p && p.l === l && Math.hypot(x - p.x, y - p.y) <= TOKEN_R + tol) return { kind: "token", id: b.tokens[i].id };
  }
  for (let i = b.marks.length - 1; i >= 0; i--) {
    const m = b.marks[i];
    if (m.step === step && m.l === l && markDist(m, x, y, meta) <= tol + (m.width ?? 3) / 2) return { kind: "mark", id: m.id };
  }
  return null;
}

/** Where the throw-point handle of a grenade is: its throw point, or a spot beside it when it has none. */
export const throwHandle = (m: BoardMark): [number, number] => m.pts[1] ?? [m.pts[0][0] + 34, m.pts[0][1] - 34];

// ---- drawing ----

type Ctx = CanvasRenderingContext2D;

function withAlpha(color: string, a: number): string {
  if (color[0] !== "#" || color.length !== 7) return color;
  const n = parseInt(color.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

const sideColor = (side?: string) => (side === "ct" ? CT_COLOR : side === "t" ? T_COLOR : "#ccc");

let measure: CanvasRenderingContext2D | null = null;
function textBox(text: string): [number, number] {
  measure ??= document.createElement("canvas").getContext("2d");
  const lines = (text || " ").split("\n");
  measure!.font = `600 ${TEXT_SIZE}px system-ui, sans-serif`;
  const w = Math.max(...lines.map((s) => measure!.measureText(s).width));
  return [w + 18, lines.length * TEXT_SIZE * 1.25 + 10];
}

function label(ctx: Ctx, text: string, x: number, y: number, size: number, color = "#fff") {
  ctx.font = `700 ${size}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = size * 0.28;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function arrowHead(ctx: Ctx, ax: number, ay: number, bx: number, by: number, size: number) {
  const ang = Math.atan2(by - ay, bx - ax);
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx - Math.cos(ang - 0.45) * size, by - Math.sin(ang - 0.45) * size);
  ctx.lineTo(bx - Math.cos(ang + 0.45) * size, by - Math.sin(ang + 0.45) * size);
  ctx.closePath();
  ctx.fill();
}

export function drawMark(ctx: Ctx, m: BoardMark, meta: MapMeta, alpha: number, selected = false) {
  const p = m.pts;
  const color = m.color ?? "#ffffff";
  const w = m.width ?? 4;
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (m.type) {
    case "nade": {
      const kind = m.kind ?? "smoke";
      const c = NADE_COLORS[kind] ?? "#ccc";
      const r = NADE_RADIUS[kind] / meta.scale;
      const [x, y] = p[0];
      if (p[1]) {
        // the throw: a dashed arc from where it is thrown to where it lands
        const [fx, fy] = p[1];
        ctx.strokeStyle = withAlpha(c, 0.9);
        ctx.lineWidth = 2.2;
        ctx.setLineDash([7, 6]);
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        const mx = (fx + x) / 2, my = (fy + y) / 2, d = Math.hypot(x - fx, y - fy);
        ctx.quadraticCurveTo(mx - ((y - fy) / (d || 1)) * d * 0.15, my + ((x - fx) / (d || 1)) * d * 0.15, x, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(fx, fy, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = withAlpha(kind === "smoke" ? "#cfd3d6" : c, kind === "smoke" ? 0.55 : 0.33);
      ctx.strokeStyle = withAlpha(c, 0.95);
      ctx.lineWidth = 2;
      if (kind === "flashbang" || kind === "he") ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      label(ctx, NADE_SHORT[kind], x, y, 13, kind === "smoke" ? "#fff" : c);
      break;
    }
    case "pen": {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.beginPath();
      p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (p.length === 1) ctx.lineTo(p[0][0] + 0.1, p[0][1]);
      ctx.stroke();
      break;
    }
    case "arrow": {
      const [a, b] = [p[0], p[p.length - 1]];
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = w;
      const head = 10 + w * 2;
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0] - Math.cos(ang) * head * 0.6, b[1] - Math.sin(ang) * head * 0.6);
      ctx.stroke();
      arrowHead(ctx, a[0], a[1], b[0], b[1], head);
      break;
    }
    case "rect":
    case "circle": {
      const [a, b] = [p[0], p[1] ?? p[0]];
      ctx.strokeStyle = color;
      ctx.fillStyle = withAlpha(color, 0.12);
      ctx.lineWidth = w;
      ctx.beginPath();
      if (m.type === "rect") ctx.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      else ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "text": {
      const [x, y] = p[0];
      const [bw, bh] = textBox(m.text ?? "");
      ctx.fillStyle = "rgba(12,12,12,0.86)";
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x - bw / 2, y - bh / 2, bw, bh, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = `600 ${TEXT_SIZE}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = (m.text ?? "").split("\n");
      lines.forEach((s, i) => ctx.fillText(s, x, y + (i - (lines.length - 1) / 2) * TEXT_SIZE * 1.25));
      break;
    }
  }
  if (selected) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#ff5500";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    let pad = 8;
    if (m.type === "nade") pad = NADE_RADIUS[m.kind ?? "smoke"] / meta.scale + 4;
    let x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
    if (m.type === "nade") [x0, x1, y0, y1] = [p[0][0] - pad, p[0][0] + pad, p[0][1] - pad, p[0][1] + pad];
    if (m.type === "text") {
      const [bw, bh] = textBox(m.text ?? "");
      [x0, x1, y0, y1] = [p[0][0] - bw / 2 - 4, p[0][0] + bw / 2 + 4, p[0][1] - bh / 2 - 4, p[0][1] + bh / 2 + 4];
    }
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.setLineDash([]);
    if (m.type === "nade") {
      // the throw-point handle: drag it to where the grenade is thrown from
      const [hx, hy] = throwHandle(m);
      ctx.fillStyle = m.pts[1] ? "#ff5500" : "rgba(255,85,0,0.55)";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hx, hy, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

export function drawToken(ctx: Ctx, tok: BoardToken, at: BoardPos, alpha: number, selected = false) {
  ctx.globalAlpha = alpha;
  if (selected) {
    ctx.strokeStyle = "#ff5500";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(at.x, at.y, TOKEN_R + 6, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (tok.type === "bomb") {
    ctx.fillStyle = "#ff3030";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(at.x - BOMB_W / 2, at.y - BOMB_H / 2, BOMB_W, BOMB_H, 3);
    ctx.fill();
    ctx.stroke();
    label(ctx, "C4", at.x, at.y + 0.5, 10);
  } else {
    const c = sideColor(tok.side);
    ctx.fillStyle = c;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(at.x, at.y, TOKEN_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const text = tok.label ?? "";
    if (text.length <= 2) label(ctx, text, at.x, at.y + 0.5, 14);
    else {
      label(ctx, text.slice(0, 1).toUpperCase(), at.x, at.y + 0.5, 14);
      label(ctx, text, at.x, at.y - TOKEN_R - 10, 13);
    }
  }
  ctx.globalAlpha = 1;
}

function drawRoute(ctx: Ctx, path: BoardPos[], l: number, color: string, alpha: number) {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([2, 7]);
  ctx.beginPath();
  let started = false;
  for (const p of path) {
    if (p.l !== l) {
      started = false;
      continue;
    }
    if (started) ctx.lineTo(p.x, p.y);
    else ctx.moveTo(p.x, p.y);
    started = true;
  }
  ctx.stroke();
  ctx.setLineDash([]);
  const [a, b] = path.slice(-2);
  if (a && b && a.l === l && b.l === l && Math.hypot(b.x - a.x, b.y - a.y) > 1) {
    // the head stops at the token's edge
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    arrowHead(ctx, a.x, a.y, b.x - Math.cos(ang) * (TOKEN_R + 2), b.y - Math.sin(ang) * (TOKEN_R + 2), 11);
  }
  ctx.globalAlpha = 1;
}

export interface BoardDrawOpts {
  step: number;
  levels: number[]; // one panel per entry, side by side from x = 0
  size: number; // px per panel
  ox?: number; // x of the first panel
  oy?: number;
  selected?: string | null;
  onion?: boolean; // the step before, faded
  routes?: boolean;
  callouts?: boolean;
  levelLabels?: boolean;
  draft?: BoardMark | null; // the shape being drawn
  /** Animation from step - 1 to `step`: 0 = still on the step before, 1 = arrived. */
  f?: number;
}

/** A board on one step (or between two steps when animating), one radar panel per level. */
export function drawBoard(ctx: Ctx, assets: MapAssets, b: Board, o: BoardDrawOpts) {
  const { meta, images } = assets;
  const k = o.size / RADAR_SIZE;
  const ox0 = o.ox ?? 0, oy = o.oy ?? 0;
  const anim = o.f !== undefined && o.step > 0 && o.f < 1;
  const f = o.f ?? 1;
  o.levels.forEach((li, panel) => {
    const ox = ox0 + panel * o.size;
    ctx.save();
    ctx.translate(0, oy);
    drawRadar(ctx, images[li], ox, o.size);
    if (o.callouts) drawCallouts(ctx, meta, li, ox, o.size);
    ctx.beginPath();
    ctx.rect(ox, 0, o.size, o.size);
    ctx.clip();
    ctx.translate(ox, 0);
    ctx.scale(k, k);

    const marksOf = (step: number) => b.marks.filter((m) => m.step === step && m.l === li);
    if (anim) {
      // the step before fades out while the new one fades in
      for (const m of marksOf(o.step - 1)) drawMark(ctx, m, meta, 1 - f);
      for (const m of marksOf(o.step)) drawMark(ctx, m, meta, Math.min(1, f * 2.5));
    } else {
      if (o.onion && o.step > 0) for (const m of marksOf(o.step - 1)) drawMark(ctx, m, meta, 0.28);
      for (const m of marksOf(o.step)) drawMark(ctx, m, meta, 1, m.id === o.selected);
      if (o.draft && o.draft.l === li) drawMark(ctx, o.draft, meta, 1);
    }

    for (const tok of b.tokens) {
      const color = tok.type === "bomb" ? "#ff3030" : sideColor(tok.side);
      const path = routeInto(tok, o.step);
      if (anim) {
        const before = posAt(tok, o.step - 1);
        const at = path ? along(path, easeInOut(f)) : posAt(tok, o.step);
        if (path) drawRoute(ctx, path, li, color, 0.35);
        if (at && at.l === li) drawToken(ctx, tok, at, before ? 1 : Math.min(1, f * 2.5));
        continue;
      }
      if (o.onion && o.step > 0 && path) {
        const before = path[0];
        if (before.l === li) drawToken(ctx, tok, before, 0.3);
      }
      if (path && o.routes !== false) drawRoute(ctx, path, li, color, 0.9);
      const at = posAt(tok, o.step);
      if (at && at.l === li) drawToken(ctx, tok, at, 1, tok.id === o.selected);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    if (meta.levels.length > 1 && o.levelLabels !== false) {
      ctx.fillStyle = "#fff";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(levelLabel(meta, li), ox + 10, oy + 20);
    }
  });
}

const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

// ---- playback timeline: hold on each step, walk to the next ----
export const HOLD_SEC = 0.9;
export const MOVE_SEC = 1.8;

export const animDuration = (steps: number) => steps * HOLD_SEC + (steps - 1) * MOVE_SEC;

/** The step and the walk fraction into it at a time of the playback. */
export function animFrame(steps: number, time: number): { step: number; f: number } {
  let t0 = HOLD_SEC;
  if (time < t0) return { step: 0, f: 1 };
  for (let s = 1; s < steps; s++) {
    if (time < t0 + MOVE_SEC) return { step: s, f: (time - t0) / MOVE_SEC };
    t0 += MOVE_SEC + HOLD_SEC;
    if (time < t0) return { step: s, f: 1 };
  }
  return { step: steps - 1, f: 1 };
}

/** Caption bar above an exported picture: board name, map and the step. */
export function drawCaption(ctx: Ctx, b: Board, x: number, y: number, w: number, h: number, stepText: string) {
  ctx.fillStyle = "#111";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#ff5500";
  ctx.fillRect(x, y + h - 3, w, 3);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = "#f2f2f2";
  ctx.font = `700 ${Math.round(h * 0.42)}px system-ui, sans-serif`;
  const title = b.name || t("board.untitled");
  ctx.fillText(title, x + 14, y + h / 2);
  ctx.textAlign = "right";
  ctx.fillStyle = "#bbb";
  ctx.font = `600 ${Math.round(h * 0.36)}px system-ui, sans-serif`;
  ctx.fillText(`${b.map.replace(/^de_/, "")} · ${stepText}`, x + w - 14, y + h / 2);
  ctx.textAlign = "left";
}

// ---- replay frame -> board ----

/** Step 1 of a new board from a replay moment: alive players with names and sides, smokes, fires and the bomb. */
export function boardFromFrame(meta: MapMeta, r: Replay, tick: number, source: Board["source"]): Board {
  const b = emptyBoard(meta.map);
  const at = (x: number, y: number, z: number | null | undefined): BoardPos => {
    const [px, py] = worldToPx(meta, x, y);
    return { x: Math.round(px * 10) / 10, y: Math.round(py * 10) / 10, l: levelOf(meta, z) };
  };
  const states = playerStates(r, tick).filter((st) => st.hp > 0 && !Number.isNaN(st.x));
  for (const side of ["counter-terrorist", "terrorist"] as const) {
    for (const st of states.filter((s) => s.p.side === side)) {
      b.tokens.push(newToken(b, { id: newId(), type: "player", side: side === "terrorist" ? "t" : "ct", label: st.p.name.slice(0, 24), pos: [], route: [] }, 0, at(st.x, st.y, st.z)));
    }
  }
  const bomb = bombState(r, tick);
  const carrier = states.find((s) => s.bomb);
  const spot = bomb.planted ?? bomb.dropped;
  if (spot) b.tokens.push(newToken(b, { id: newId(), type: "bomb", pos: [], route: [] }, 0, at(spot.x, spot.y, spot.z)));
  else if (carrier) {
    const p = at(carrier.x, carrier.y, carrier.z);
    b.tokens.push(newToken(b, { id: newId(), type: "bomb", pos: [], route: [] }, 0, { ...p, x: p.x + TOKEN_R + 8, y: p.y + TOKEN_R }));
  }
  const area = (kind: NadeKind, a: { x: number; y: number; z: number | null }) => {
    const p = at(a.x, a.y, a.z);
    b.marks.push({ id: newId(), type: "nade", kind, step: 0, l: p.l, pts: [[p.x, p.y]] });
  };
  for (const a of r.smokes) if (tick >= a.start && tick <= a.end) area("smoke", a);
  for (const a of r.fires) if (tick >= a.start && tick <= a.end) area("molotov", a);
  b.source = source;
  return b;
}

const DRAFT_KEY = "freezetime.board.draft";

/** Hand a board to the board page through this tab's session storage (the hash can't carry it). */
export function stashDraft(b: Board) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(b));
  } catch {
    /* storage blocked: the board page opens empty */
  }
}

export function takeDraft(): Board | null {
  try {
    const s = sessionStorage.getItem(DRAFT_KEY);
    sessionStorage.removeItem(DRAFT_KEY);
    return s ? (JSON.parse(s) as Board) : null;
  } catch {
    return null;
  }
}
