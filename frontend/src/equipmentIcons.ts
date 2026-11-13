// Local CS2 SVG geometry shared by React and Canvas. See assets/equipment/README.md.
import { EQUIPMENT } from "./assets/equipment";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type EquipmentId = keyof typeof EQUIPMENT;
const ALIASES: Record<string, EquipmentId> = {
  smoke: "smokegrenade", he: "hegrenade", incendiary: "incgrenade", kit: "defuser",
  kevlar: "armor", assaultsuit: "armor_helmet", planted_c4: "c4", p2000: "hkp2000",
};

/** Resolve demo inventory names, grenade event names and knife variants. */
export function equipmentId(item: string | null | undefined): EquipmentId | null {
  const name = item?.toLowerCase().replace(/^weapon_/, "");
  if (!name) return null;
  if (Object.hasOwn(ALIASES, name)) return ALIASES[name];
  if (name.startsWith("knife") && !Object.hasOwn(EQUIPMENT, name)) return "knife";
  return Object.hasOwn(EQUIPMENT, name) ? name as EquipmentId : null;
}

export function equipmentIcon(item: string | null | undefined) {
  const id = equipmentId(item);
  return id ? EQUIPMENT[id] : null;
}

/** Fit a silhouette to a bounding box without stretching its source proportions. */
export function equipmentSize(item: string | null | undefined, height: number, maxWidth: number) {
  const icon = equipmentIcon(item);
  if (!icon) return { width: 0, height: 0 };
  const scale = Math.min(height / icon.view[3], maxWidth / icon.view[2]);
  return { width: icon.view[2] * scale, height: icon.view[3] * scale };
}

const cachedPaths = new Map<EquipmentId, Path2D[]>();
/** Paint a centered silhouette synchronously; return false for an unknown item. */
export function drawEquipmentIcon(ctx: Ctx, item: string | null | undefined, cx: number, cy: number, height: number, maxWidth: number, fill: string, outline?: string): boolean {
  const id = equipmentId(item);
  if (!id) return false;
  const icon = EQUIPMENT[id];
  let paths = cachedPaths.get(id);
  if (!paths) {
    paths = icon.paths.map((path) => new Path2D(path.d));
    cachedPaths.set(id, paths);
  }
  const size = equipmentSize(id, height, maxWidth);
  const scale = size.height / icon.view[3];
  ctx.save();
  ctx.translate(cx - size.width / 2, cy - size.height / 2);
  ctx.scale(scale, scale);
  ctx.translate(-icon.view[0], -icon.view[1]);
  ctx.fillStyle = fill;
  ctx.lineJoin = "round";
  ctx.lineWidth = 1 / scale;
  const alpha = ctx.globalAlpha;
  icon.paths.forEach((path, index) => {
    ctx.globalAlpha = alpha * path.opacity;
    if (outline) {
      ctx.strokeStyle = outline;
      ctx.stroke(paths![index]);
    }
    ctx.fill(paths![index], path.rule);
  });
  ctx.restore();
  return true;
}
