// Zone editor of the positions page: drag the corners of a map's callout zones, add and remove
// corners and zones, smooth stair-step edges, and save to freezetime/maps/<map>.json (PUT /api/maps/<map>/zones).
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type MapMeta } from "../api";
import { t, td } from "../i18n";
import { drawRadar, levelLabel, RADAR_SIZE, type MapAssets } from "../radar";

type Pt = [number, number];
export interface EditZone {
  key: number; // stable id while editing (names repeat: one zone may have several polygons)
  name: string;
  group: string | null;
  level: string;
  polygon: Pt[];
}

const GROUPS = ["A", "A_approach", "B", "B_approach", "mid", "t_spawn", "ct_spawn"];
const HANDLE = 7; // px around a corner that grabs it
const MAX_ZOOM = 8;
const SMOOTH = [16, 32, 64]; // Douglas-Peucker tolerances in world units (derived zones step by 32)
const HISTORY = 100;

let nextKey = 1;
const keyed = (zones: MapMeta["zones"]): EditZone[] =>
  zones.map((z) => ({ key: nextKey++, name: z.name, group: z.group, level: z.level, polygon: z.polygon.map(([x, y]) => [x, y] as Pt) }));

// ---- geometry (world units) ----

function inside([x, y]: Pt, poly: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export function polyArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return Math.abs(s) / 2;
}

function segDist([px, py]: Pt, [ax, ay]: Pt, [bx, by]: Pt): number {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const u = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
}

function douglasPeucker(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  let worst = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > worst) [worst, at] = [d, i];
  }
  if (worst <= tol) return [pts[0], pts[pts.length - 1]];
  return [...douglasPeucker(pts.slice(0, at + 1), tol).slice(0, -1), ...douglasPeucker(pts.slice(at), tol)];
}

/** Fewer corners on a closed polygon: stair steps of the 32-unit grid it was derived from become straight edges. */
export function smooth(poly: Pt[], tol: number): Pt[] {
  if (poly.length <= 4) return poly;
  // split at the corner farthest from the first one, so both halves are open polylines
  let far = 0;
  poly.forEach((p, i) => {
    if (Math.hypot(p[0] - poly[0][0], p[1] - poly[0][1]) > Math.hypot(poly[far][0] - poly[0][0], poly[far][1] - poly[0][1])) far = i;
  });
  const a = douglasPeucker(poly.slice(0, far + 1), tol);
  const b = douglasPeucker([...poly.slice(far), poly[0]], tol);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 && polyArea(out) > polyArea(poly) * 0.5 ? out : poly;
}

// ---- the editor ----

type Drag =
  | { kind: "corner"; key: number; i: number }
  | { kind: "move"; key: number; from: Pt; orig: Pt[] }
  | { kind: "pan"; from: [number, number]; off: [number, number] }
  | { kind: "press"; at: [number, number]; world: Pt; key: number | null }; // not moved yet: a click

export function ZoneEditor({ assets, size, onSaved, onClose }: {
  assets: MapAssets;
  size: number;
  onSaved: (meta: MapMeta) => void;
  onClose: () => void;
}) {
  const { meta, images } = assets;
  const [zones, setZones] = useState<EditZone[]>(() => keyed(meta.zones));
  const [saved, setSaved] = useState(zones);
  const [selected, setSelected] = useState<number | null>(null);
  const [level, setLevel] = useState(0);
  const [drawing, setDrawing] = useState<Pt[] | null>(null);
  const [view, setView] = useState({ zoom: 1, off: [0, 0] as [number, number] });
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [tol, setTol] = useState(32);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const past = useRef<EditZone[][]>([]);
  const drag = useRef<Drag | null>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const dpr = window.devicePixelRatio || 1;
  const levelName = meta.levels[level]?.name ?? "default";
  const dirty = zones !== saved;
  const sel = zones.find((z) => z.key === selected) ?? null;

  // world <-> screen: radar px scaled to the panel, then zoomed and panned
  const k = size / RADAR_SIZE;
  const toScreen = ([x, y]: Pt): [number, number] => [
    ((x - meta.pos_x) / meta.scale) * k * view.zoom + view.off[0],
    ((meta.pos_y - y) / meta.scale) * k * view.zoom + view.off[1],
  ];
  const toWorld = (sx: number, sy: number): Pt => [
    Math.round(meta.pos_x + ((sx - view.off[0]) / (k * view.zoom)) * meta.scale),
    Math.round(meta.pos_y - ((sy - view.off[1]) / (k * view.zoom)) * meta.scale),
  ];

  const change = (next: EditZone[]) => {
    past.current = [...past.current.slice(-HISTORY + 1), zones];
    setZones(next);
    setMsg(null);
  };
  const undo = () => {
    const prev = past.current.pop();
    if (prev) setZones(prev);
  };
  // from the latest state: a mouse move may come before the render of the press that inserted a corner
  const update = (key: number, fn: (z: EditZone) => EditZone, record = true) => {
    if (record) {
      past.current = [...past.current.slice(-HISTORY + 1), zones];
      setMsg(null);
    }
    setZones((prev) => prev.map((z) => (z.key === key ? fn(z) : z)));
  };

  // ---- drawing ----
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0b0b0b";
    ctx.fillRect(0, 0, size, size);
    ctx.save();
    ctx.translate(view.off[0], view.off[1]);
    ctx.scale(view.zoom, view.zoom);
    drawRadar(ctx, images[level], 0, size);
    ctx.restore();
    const path = (poly: Pt[], close = true) => {
      ctx.beginPath();
      poly.forEach((p, i) => {
        const [x, y] = toScreen(p);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      if (close) ctx.closePath();
    };
    const mine = zones.filter((z) => z.level === levelName);
    ctx.lineWidth = 1;
    for (const z of mine) {
      if (z.key === selected) continue;
      path(z.polygon);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.stroke();
    }
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const z of mine) {
      const c = z.polygon.reduce((a, p) => [a[0] + p[0] / z.polygon.length, a[1] + p[1] / z.polygon.length], [0, 0]) as Pt;
      const [x, y] = toScreen(c);
      const w = ctx.measureText(z.name).width + 6;
      ctx.fillStyle = z.key === selected ? "#ff5500" : "rgba(0,0,0,0.6)";
      ctx.fillRect(x - w / 2, y - 7, w, 14);
      ctx.fillStyle = "#fff";
      ctx.fillText(z.name, x, y + 0.5);
    }
    if (sel && sel.level === levelName) {
      path(sel.polygon);
      ctx.fillStyle = "rgba(255,85,0,0.28)";
      ctx.fill();
      ctx.strokeStyle = "#ff5500";
      ctx.lineWidth = 2;
      ctx.stroke();
      sel.polygon.forEach((p, i) => {
        const [x, y] = toScreen(p);
        const [nx, ny] = toScreen(sel.polygon[(i + 1) % sel.polygon.length]);
        if (Math.hypot(nx - x, ny - y) >= 3 * HANDLE) {
          ctx.fillStyle = "rgba(255,255,255,0.75)"; // the middle of an edge: drag it to add a corner
          ctx.beginPath();
          ctx.arc((x + nx) / 2, (y + ny) / 2, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "#ff5500";
        ctx.lineWidth = 1.5;
        ctx.fillRect(x - 4, y - 4, 8, 8);
        ctx.strokeRect(x - 4, y - 4, 8, 8);
      });
    }
    if (drawing) {
      path(cursor ? [...drawing, cursor] : drawing, false);
      ctx.strokeStyle = "#ffd000";
      ctx.lineWidth = 2;
      ctx.stroke();
      drawing.forEach((p, i) => {
        const [x, y] = toScreen(p);
        ctx.fillStyle = i ? "#ffd000" : "#fff";
        ctx.fillRect(x - 4, y - 4, 8, 8);
      });
    }
  });

  // ---- mouse ----
  const local = (e: React.MouseEvent | React.WheelEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [((e.clientX - r.left) * size) / r.width, ((e.clientY - r.top) * size) / r.height];
  };
  const cornerAt = (z: EditZone, s: [number, number]) =>
    z.polygon.findIndex((p) => {
      const [x, y] = toScreen(p);
      return Math.abs(x - s[0]) <= HANDLE && Math.abs(y - s[1]) <= HANDLE;
    });
  const edgeAt = (z: EditZone, s: [number, number]) =>
    z.polygon.findIndex((p, i) => {
      const [x, y] = toScreen(p);
      const [nx, ny] = toScreen(z.polygon[(i + 1) % z.polygon.length]);
      // short edges have no handle: it would sit on the corners (zoom in to add corners there)
      return Math.hypot(nx - x, ny - y) >= 3 * HANDLE && Math.hypot((x + nx) / 2 - s[0], (y + ny) / 2 - s[1]) <= HANDLE;
    });
  const zoneAt = (w: Pt): EditZone | null => {
    const hits = zones.filter((z) => z.level === levelName && inside(w, z.polygon));
    return hits.sort((a, b) => polyArea(a.polygon) - polyArea(b.polygon))[0] ?? null; // the smaller one wins, like in lookups
  };

  const finishDrawing = (pts: Pt[]) => {
    setDrawing(null);
    if (pts.length < 3 || polyArea(pts) < 1) return;
    const z: EditZone = { key: nextKey++, name: t("zed.newName"), group: null, level: levelName, polygon: pts };
    change([...zones, z]);
    setSelected(z.key);
  };

  const onDown = (e: React.MouseEvent) => {
    const s = local(e);
    const w = toWorld(...s);
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      drag.current = { kind: "pan", from: s, off: view.off };
      return;
    }
    if (e.button !== 0) return;
    if (drawing) {
      const first = drawing[0] && toScreen(drawing[0]);
      if (first && drawing.length >= 3 && Math.hypot(first[0] - s[0], first[1] - s[1]) <= HANDLE) finishDrawing(drawing);
      else setDrawing([...drawing, w]);
      return;
    }
    if (sel && sel.level === levelName) {
      const i = cornerAt(sel, s);
      if (i >= 0) {
        if (e.altKey) {
          if (sel.polygon.length > 3) update(sel.key, (z) => ({ ...z, polygon: z.polygon.filter((_, j) => j !== i) }));
          return;
        }
        past.current = [...past.current.slice(-HISTORY + 1), zones];
        drag.current = { kind: "corner", key: sel.key, i };
        return;
      }
      const edge = edgeAt(sel, s);
      if (edge >= 0) {
        update(sel.key, (z) => ({ ...z, polygon: [...z.polygon.slice(0, edge + 1), w, ...z.polygon.slice(edge + 1)] }));
        drag.current = { kind: "corner", key: sel.key, i: edge + 1 };
        return;
      }
    }
    drag.current = { kind: "press", at: s, world: w, key: zoneAt(w)?.key ?? null };
  };

  const onMove = (e: React.MouseEvent) => {
    const s = local(e);
    const w = toWorld(...s);
    setCursor(w);
    const d = drag.current;
    if (!d) return;
    if (d.kind === "press" && Math.hypot(s[0] - d.at[0], s[1] - d.at[1]) > 3) {
      // a drag: the selected zone moves as a whole, anything else pans the view
      const z = d.key != null && d.key === selected ? zones.find((x) => x.key === d.key) : null;
      if (z) {
        past.current = [...past.current.slice(-HISTORY + 1), zones];
        drag.current = { kind: "move", key: z.key, from: d.world, orig: z.polygon };
      } else drag.current = { kind: "pan", from: d.at, off: view.off };
      return;
    }
    if (d.kind === "corner") update(d.key, (z) => ({ ...z, polygon: z.polygon.map((p, i) => (i === d.i ? w : p)) }), false);
    if (d.kind === "move") {
      const dx = w[0] - d.from[0], dy = w[1] - d.from[1];
      update(d.key, (z) => ({ ...z, polygon: d.orig.map(([x, y]) => [x + dx, y + dy] as Pt) }), false);
    }
    if (d.kind === "pan") setView((v) => ({ ...v, off: [d.off[0] + s[0] - d.from[0], d.off[1] + s[1] - d.from[1]] }));
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === "press") setSelected(d.key);
    if (d?.kind === "corner" || d?.kind === "move") setMsg(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    const s = local(e);
    const zoom = Math.max(1, Math.min(MAX_ZOOM, view.zoom * (e.deltaY < 0 ? 1.25 : 0.8)));
    const f = zoom / view.zoom;
    // the point under the cursor stays put
    setView({ zoom, off: zoom === 1 ? [0, 0] : [s[0] - (s[0] - view.off[0]) * f, s[1] - (s[1] - view.off[1]) * f] });
  };
  // the page must not scroll while the wheel zooms the map
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    c.addEventListener("wheel", stop, { passive: false });
    return () => c.removeEventListener("wheel", stop);
  }, []);

  // ---- keys ----
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, select, textarea")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      } else if (e.key === "Escape") {
        if (drawing) setDrawing(null);
        else setSelected(null);
      } else if (e.key === "Enter" && drawing) finishDrawing(drawing);
      else if ((e.key === "Delete" || e.key === "Backspace") && sel && !drawing) {
        change(zones.filter((z) => z.key !== sel.key));
        setSelected(null);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  // leaving the page with unsaved zones asks first
  useEffect(() => {
    if (!dirty) return;
    const stop = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", stop);
    return () => window.removeEventListener("beforeunload", stop);
  }, [dirty]);

  const names = useMemo(() => [...new Set(zones.map((z) => z.name))].sort(), [zones]);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const next = await api.mapZones(meta.map, zones.map(({ name, group, level: lv, polygon }) => ({ name, group, level: lv, polygon })));
      const fresh = keyed(next.zones);
      past.current = [];
      setZones(fresh);
      setSaved(fresh);
      setSelected(null);
      setMsg({ text: t("zed.saved", { file: `freezetime/maps/${meta.map}.json` }), error: false });
      onSaved(next);
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    if (!dirty || window.confirm(t("zed.leave"))) onClose();
  };

  return (
    <div className="callouts zone-editor">
      <div>
        {meta.levels.length > 1 && (
          <div className="row small">
            <span className="seg">
              {meta.levels.map((_, i) => (
                <button key={i} className={level === i ? "on" : ""} onClick={() => setLevel(i)}>{levelLabel(meta, i)}</button>
              ))}
            </span>
          </div>
        )}
        <canvas ref={ref} width={size * dpr} height={size * dpr} style={{ width: size, height: size, cursor: drawing ? "crosshair" : "default" }}
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={() => { onUp(); setCursor(null); }}
          onWheel={onWheel} onContextMenu={(e) => e.preventDefault()} onAuxClick={(e) => e.preventDefault()} />
        <div className="row muted small">
          <span>{cursor ? `x ${cursor[0]}  y ${cursor[1]}` : " "}</span>
          <span className="grow" />
          <span>×{view.zoom.toFixed(1)}</span>
          <button className="small-btn" disabled={view.zoom === 1} onClick={() => setView({ zoom: 1, off: [0, 0] })}>{t("zed.resetView")}</button>
        </div>
      </div>
      <div className="callout-list zone-panel">
        <div className="row">
          <button className="primary" disabled={!dirty || busy} onClick={save}>{t("zed.save")}</button>
          <button disabled={!past.current.length} onClick={undo} title="Ctrl+Z">↶ {t("zed.undo")}</button>
          <span className="grow" />
          <button onClick={close}>{t("zed.close")}</button>
        </div>
        {dirty && <div className="muted small">{t("zed.unsaved")}</div>}
        {msg && <div className={msg.error ? "error" : "ok-text small"}>{msg.text}</div>}
        <div className="row">
          <button disabled={!!drawing} onClick={() => { setSelected(null); setDrawing([]); }}>+ {t("zed.new")}</button>
          <span className="grow" />
          <label className="small">{t("zed.tolerance")}{" "}
            <select value={tol} onChange={(e) => setTol(Number(e.target.value))}>
              {SMOOTH.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <button title={t("zed.smoothAllTitle")} onClick={() => change(zones.map((z) => (z.level === levelName ? { ...z, polygon: smooth(z.polygon, tol) } : z)))}>
            {t("zed.smoothAll")}
          </button>
        </div>
        {drawing ? (
          <div className="link-setup small">{t("zed.drawHint")}</div>
        ) : sel ? (
          <div className="link-setup zone-form">
            <label className="small">{t("zed.name")}
              <input value={sel.name} maxLength={40} list="zed-names" onChange={(e) => update(sel.key, (z) => ({ ...z, name: e.target.value }), false)}
                onFocus={() => (past.current = [...past.current.slice(-HISTORY + 1), zones])} />
            </label>
            <datalist id="zed-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
            <label className="small">{t("zed.group")}
              <select value={sel.group ?? ""} onChange={(e) => update(sel.key, (z) => ({ ...z, group: e.target.value || null }))}>
                <option value="">{t("zed.noGroup")}</option>
                {GROUPS.map((g) => <option key={g} value={g}>{td(`callouts.group.${g}`, g)}</option>)}
              </select>
            </label>
            {meta.levels.length > 1 && (
              <label className="small">{t("zed.level")}
                <select value={sel.level} onChange={(e) => update(sel.key, (z) => ({ ...z, level: e.target.value }))}>
                  {meta.levels.map((lv, i) => <option key={lv.name} value={lv.name}>{levelLabel(meta, i)}</option>)}
                </select>
              </label>
            )}
            <div className="muted small">{t("zed.points", { n: sel.polygon.length })}</div>
            <div className="row">
              <button onClick={() => update(sel.key, (z) => ({ ...z, polygon: smooth(z.polygon, tol) }))}>{t("zed.smooth")}</button>
              <span className="grow" />
              <button className="danger" onClick={() => { change(zones.filter((z) => z.key !== sel.key)); setSelected(null); }}>{t("zed.delete")}</button>
            </div>
          </div>
        ) : (
          <div className="muted small">{t("zed.pick")}</div>
        )}
        <div className="muted small zone-help">{t("zed.help")}</div>
        <div className="muted small">{t("zed.devNote")}</div>
      </div>
    </div>
  );
}
