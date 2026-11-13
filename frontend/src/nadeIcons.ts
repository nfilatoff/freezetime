// Grenade event names bridge to the locally bundled CS2 equipment silhouettes.
import { drawEquipmentIcon } from "./equipmentIcons";

export type NadeType = "smoke" | "flashbang" | "he" | "molotov" | "incendiary" | "decoy";
const NADE_TYPES = new Set<string>(["smoke", "flashbang", "he", "molotov", "incendiary", "decoy"]);
export const isNadeType = (type: string): type is NadeType => NADE_TYPES.has(type);

/** Draw a centered upright grenade; unknown event types retain the dot fallback. */
export function drawNadeIcon(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, type: string, cx: number, cy: number, height: number, fill: string, outline?: string) {
  if (isNadeType(type) && drawEquipmentIcon(ctx, type, cx, cy, height, height, fill, outline)) return;
  ctx.save();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(cx, cy, height * 0.3, 0, Math.PI * 2);
  ctx.fill();
  if (outline) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = height / 12;
    ctx.stroke();
  }
  ctx.restore();
}
