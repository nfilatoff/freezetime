// Original grenade silhouettes, one filled path per type on a shared 16x24 viewBox (upright).
// Details are evenodd cut-outs, so a single fill draws the whole icon.
export type NadeType = "smoke" | "flashbang" | "he" | "molotov" | "incendiary" | "decoy";

export const NADE_VIEW = { w: 16, h: 24 };

export const NADE_PATH: Record<NadeType, string> = {
  // tall canister, flat cap, band slot, lever along the right side
  smoke:
    "M5 3h6v4h1a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h1z" +
    "M4.4 12.5h7.2v1.6H4.4z" +
    "M12.2 3.6h2.6v12.4h-1.4V5H12.2z",
  // slim canister, pin ring on top, two bands
  flashbang:
    "M6.6 4.6h2.8V7.4H11a1 1 0 0 1 1 1V22a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8.4a1 1 0 0 1 1-1h1.6z" +
    "M5.2 11h5.6v1.2H5.2zM5.2 15.6h5.6v1.2H5.2z" +
    "M8 0a2.3 2.3 0 1 0 0 4.6A2.3 2.3 0 0 0 8 0zm0 1.2a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2z",
  // egg-shaped frag body, spoon lever on the right, pin ring on the left
  he:
    "M8 7.5c3.6 0 6 3.2 6 7.2S11.6 23 8 23 2 18.7 2 14.7 4.4 7.5 8 7.5z" +
    "M6.6 5h2.8v2.5H6.6z" +
    "M9.4 5h2.3c1.5 0 2.3 1.1 2.3 2.6v2.6h-1.3V7.6c0-.7-.3-1.2-1-1.2H9.4z" +
    "M3.6 3.2a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8zm0 1.1a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6z",
  // bottle with a neck, label window and a flame at the rag
  molotov:
    "M6.4 7.8h3.2v3.2c2.3.8 3.4 2.4 3.4 4.3V22a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6.7c0-1.9 1.1-3.5 2.4-4.3z" +
    "M5.6 15.4h4.8v3.4H5.6z" +
    "M8 0c1.8 1.8 2.8 3.1 2.8 4.3A2.8 2.8 0 0 1 8 7.1 2.8 2.8 0 0 1 5.2 4.3C5.2 3.1 6.2 1.8 8 0z",
  // canister with a rounded top, nozzle and a flame cut out of the body
  incendiary:
    "M4 7a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" +
    "M8 10c1.8 2 3 3.5 3 5.2a3 3 0 0 1-6 0C5 13.5 6.2 12 8 10z" +
    "M6.8 1h2.4v3H6.8z",
  // short squat can with dots, antenna with a ball on top
  decoy:
    "M3 14a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" +
    "M5.6 16.4a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2zM8 18.6a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2zM10.4 16.4a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2z" +
    "M7.4 4.3h1.2V12H7.4z" +
    "M8 .8a1.6 1.6 0 1 1 0 3.2A1.6 1.6 0 0 1 8 .8z",
};

export const isNadeType = (t: string): t is NadeType => t in NADE_PATH;

const paths = new Map<NadeType, Path2D>();
/** The icon as a Path2D, built once per type. */
export function nadePath2D(type: NadeType): Path2D {
  let p = paths.get(type);
  if (!p) {
    p = new Path2D(NADE_PATH[type]);
    paths.set(type, p);
  }
  return p;
}

/** Draw a grenade icon centred at (cx, cy), `height` px tall; unknown types fall back to a dot. */
export function drawNadeIcon(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, type: string, cx: number, cy: number, height: number, fill: string, outline?: string,
) {
  ctx.save();
  if (isNadeType(type)) {
    const k = height / NADE_VIEW.h;
    ctx.translate(cx - (NADE_VIEW.w / 2) * k, cy - height / 2);
    ctx.scale(k, k);
    const p = nadePath2D(type);
    if (outline) {
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1.8; // icon units, about height / 13 px
      ctx.lineJoin = "round";
      ctx.stroke(p);
    }
    ctx.fillStyle = fill;
    ctx.fill(p, "evenodd");
  } else {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(cx, cy, height * 0.3, 0, Math.PI * 2);
    ctx.fill();
    if (outline) {
      ctx.strokeStyle = outline;
      ctx.lineWidth = height / 12;
      ctx.stroke();
    }
  }
  ctx.restore();
}
