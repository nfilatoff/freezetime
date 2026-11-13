// Kill feed status marks; equipment silhouettes use the shared CS2 assets.
import { drawNadeIcon } from "./nadeIcons";
import { equipmentSize } from "./equipmentIcons";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type FeedId = "spotted" | "headshot" | "wallbang" | "smoke" | "noscope" | "blind" | "flashassist";
export const ICON_H = 16;

// Kill feed marks, 16x16 (flashassist is the flashbang silhouette).
const EYE = "M1 8C3 4.4 5.4 3 8 3s5 1.4 7 5c-2 3.6-4.4 5-7 5S3 11.6 1 8zM8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z";
export const FEED_PATH: Record<Exclude<FeedId, "flashassist">, string> = {
  // a head with a dot at the crosshair
  headshot:
    "M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM8 3.2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6z" +
    "M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  // a bullet through a wall
  wallbang: "M9 1h6v14H9zM9 6.6h6v2.8H9z" + "M0 6.6h6.4L8.2 8 6.4 9.4H0z",
  smoke: "M4 13A3.5 3.5 0 0 1 3.6 6.1 4.6 4.6 0 0 1 12.2 5.2 4 4 0 0 1 12 13Z",
  // a scope reticle struck out
  noscope:
    "M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM8 3.2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6z" +
    "M7.4 5h1.2v6H7.4zM1.2 13.8L13.8 1.2 14.8 2.2 2.2 14.8z",
  // an eye, struck out for blind
  spotted: EYE,
  blind:
    EYE +
    "M1.2 13.8L13.8 1.2 14.8 2.2 2.2 14.8z",
};

const paths = new Map<string, Path2D>();
function path2D(key: string, d: string): Path2D {
  let p = paths.get(key);
  if (!p) paths.set(key, (p = new Path2D(d)));
  return p;
}

function drawShape(ctx: Ctx, p: Path2D, w: number, cx: number, cy: number, height: number, fill: string, outline?: string) {
  const k = height / ICON_H;
  ctx.save();
  ctx.translate(cx - (w / 2) * k, cy - height / 2);
  ctx.scale(k, k);
  if (outline) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = "round";
    ctx.stroke(p);
  }
  ctx.fillStyle = fill;
  ctx.fill(p, "evenodd");
  ctx.restore();
}

export const feedIconWidth = (id: FeedId, height: number) => (id === "flashassist" ? equipmentSize("flashbang", height, height).width : height);

export function drawFeedIcon(ctx: Ctx, id: FeedId, cx: number, cy: number, height: number, fill: string, outline?: string) {
  if (id === "flashassist") return drawNadeIcon(ctx, "flashbang", cx, cy, height, fill, outline);
  drawShape(ctx, path2D(`feed.${id}`, FEED_PATH[id]), ICON_H, cx, cy, height, fill, outline);
}
