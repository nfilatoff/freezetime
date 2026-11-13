// Original weapon silhouettes (side view, facing right) on a 16-unit-tall viewBox of per-icon width.
// Pieces only touch, never overlap, so evenodd keeps them solid and the cut-outs are real holes.
import { NADE_VIEW, drawNadeIcon, type NadeType } from "./nadeIcons";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type WeaponId =
  | "ak" | "m4" | "rifle" | "awp" | "scout" | "auto" | "smg" | "shotgun" | "mg"
  | "pistol" | "deagle" | "knife" | "zeus" | "c4" | "world";
export type FeedId = "spotted" | "headshot" | "wallbang" | "smoke" | "noscope" | "blind" | "flashassist";

export const ICON_H = 16;
export const WEAPON_ICON: Record<WeaponId, { w: number; d: string }> = {
  // wooden stock, curved magazine, gas tube over the handguard
  ak: {
    w: 48,
    d: "M0 4L9 5H14V4.2H36V5H43V3H44.6V5H48V6.6H36.6V8.2H24.5V9.5H22.2Q23.6 13 27 15.6L23 16Q18.6 13 17.6 9.5H15.8V11.2H14.8L13.2 15H10.8L12 9.7L9 10.2L0 13Z" +
       "M17 5.6h5v1.1h-5zM27 5.6h7v1.1h-7z",
  },
  // flat-top rail, front sight, straight magazine, pistol grip
  m4: {
    w: 48,
    d: "M0 4.4H10.6V3.2H30.6V4H41.6V2.4H43.2V4.2H48V6H41V8H30V9.2H24.8L26 15.8H21L20 9.2H17.8L15.6 14.8H12.8L13.6 9.8H11L0 9.6Z" +
       "M17 4.6h5v1.2h-5zM32 5.4h6v1.2h-6z",
  },
  rifle: {
    w: 44,
    d: "M0 5H9V3.8H29V5H37V3.4H38.6V5H44V6.8H36V8.6H27V9.4H23.4L24.4 14.6H20.4L19.4 9.4H16.4L14.4 14.2H11.8L12.6 10H9.4L0 12Z" +
       "M14 5.2h5v1h-5z",
  },
  // long barrel, big scope on two mounts, thick stock
  awp: {
    w: 56,
    d: "M0 4.4L10 5.6V10L7 10.8L0 13Z" +
       "M10 5.6H34V6.4H56V7.9H34V10H23V12.8H18.6V10H10Z" +
       "M12 1.8H33V.8H38V4H33V3.6H12Z" +
       "M16 3.6h2v2H16zM28 3.6h2v2H28z" +
       "M11 10h5l-1 4H11.5Z",
  },
  scout: {
    w: 52,
    d: "M0 5L9 5.8V9.4L6 10L0 11.4Z" +
       "M9 5.8H30V6.5H50V7.8H30V9.4H20.6V12H17.2V9.4H9Z" +
       "M12 2.6H27V4.2H12Z" +
       "M14 4.2h1.6v1.6H14zM23.5 4.2h1.6v1.6h-1.6z",
  },
  auto: {
    w: 46,
    d: "M0 4.4L10 5.4V10L0 12.4Z" +
       "M10 5.4H30V6H46V7.6H30V9.4H24.6V13.4H19.8V9.4H10Z" +
       "M12 1.6H28V4H12Z" +
       "M14 4h2v1.4h-2zM24 4h2v1.4h-2z",
  },
  smg: {
    w: 28,
    d: "M0 4H3V3H21V4.6H28V6.4H21V8.6H16.4V14.4H12.6V8.6H8.8L7.8 12.4H5L6 8.6H0Z" +
       "M9 4.4h6v1H9z",
  },
  // stock, receiver, barrel over a magazine tube, pump handle
  shotgun: {
    w: 50,
    d: "M0 4.4L10 5.2V9.4L0 12.6Z" +
       "M10 5.2H24V9.4H10Z" +
       "M24 4.6H50V6H24Z" +
       "M24 6.6H46V7.8H24Z" +
       "M30 8.4H39V10.2H30Z",
  },
  // box magazine, heat shield, bipod
  mg: {
    w: 54,
    d: "M0 4.6L9 5.4V9.6L0 12Z" +
       "M9 5.4H24V4.4H34V5.4H54V7H34V8H24V9.6H9Z" +
       "M16 9.6h9v6h-9zM18 11.4h5v2.4h-5z" +
       "M41.2 7H42.4L45 13.4H43.6ZM39.6 7H40.8L38.2 13.4H36.8Z",
  },
  pistol: {
    w: 20,
    d: "M1 2h17.5a.5.5 0 0 1 .5.5V6H1Z" +
       "M4 6h10.6L11.4 15H7.4L8.2 9H4Z" +
       "M12 3h1v2h-1z",
  },
  deagle: {
    w: 24,
    d: "M1 1h21.5a.5.5 0 0 1 .5.5V6.5H1Z" +
       "M4 6.5h11.4L13.6 15.5H9.4L10.4 9.6H4Z" +
       "M14 2.4h1v2.4h-1z",
  },
  // handle, guard, blade
  knife: {
    w: 30,
    d: "M1.4 5H11.6V10.2H1.4A1.4 1.4 0 0 1 0 8.8V6.4A1.4 1.4 0 0 1 1.4 5Z" +
       "M11.6 3.6H13.4V11.6H11.6Z" +
       "M13.4 5.2H25C28 5.2 30 6.6 30 7.2C27.5 8 24.6 10 22.4 10.8H13.4Z",
  },
  // taser: body, grip, two prongs
  zeus: {
    w: 22,
    d: "M2 3H16V9H11L9.4 14H5.6L7 9H2Z" +
       "M16 4h5v1.2h-5zM16 6.8h5v1.2h-5z" +
       "M4.6 4.8h4v2h-4z",
  },
  // block with a screen, keypad and an antenna
  c4: {
    w: 24,
    d: "M1 3h22v11H1Z" +
       "M3.6 5.2h9v3.4h-9zM15 5.2h2.4v1.8H15zM18.6 5.2H21v1.8h-2.4zM15 8.6h2.4v1.8H15zM18.6 8.6H21v1.8h-2.4zM3.6 11.4h16.8v1H3.6z" +
       "M17 1h1.4v2H17z",
  },
  // small skull for world and fall kills
  world: {
    w: 14,
    d: "M7 1C3.5 1 1.4 3.4 1.4 6.2c0 1.8.8 3 1.9 3.8V13h7.4v-3c1.1-.8 1.9-2 1.9-3.8C12.6 3.4 10.5 1 7 1z" +
       "M4.4 5.2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM9.6 5.2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM7 8.8l.9 1.6H6.1z" +
       "M5.8 11.2h.7v1.8h-.7zM7.65 11.2h.7v1.8h-.7z",
  },
};

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

export type WeaponIconRef = { kind: "weapon"; id: WeaponId } | { kind: "nade"; type: NadeType };
const W = (id: WeaponId): WeaponIconRef => ({ kind: "weapon", id });
const N = (type: NadeType): WeaponIconRef => ({ kind: "nade", type });
const BY_NAME: Record<string, WeaponIconRef> = {
  ak47: W("ak"), m4a1: W("m4"), m4a1_silencer: W("m4"),
  galilar: W("rifle"), famas: W("rifle"), aug: W("rifle"), sg556: W("rifle"),
  awp: W("awp"), ssg08: W("scout"), g3sg1: W("auto"), scar20: W("auto"),
  mac10: W("smg"), mp9: W("smg"), mp7: W("smg"), mp5sd: W("smg"), ump45: W("smg"), p90: W("smg"), bizon: W("smg"),
  nova: W("shotgun"), xm1014: W("shotgun"), mag7: W("shotgun"), sawedoff: W("shotgun"),
  m249: W("mg"), negev: W("mg"),
  glock: W("pistol"), usp_silencer: W("pistol"), hkp2000: W("pistol"), p250: W("pistol"), fiveseven: W("pistol"),
  tec9: W("pistol"), cz75a: W("pistol"), elite: W("pistol"),
  deagle: W("deagle"), revolver: W("deagle"),
  knife: W("knife"), bayonet: W("knife"), taser: W("zeus"), c4: W("c4"), planted_c4: W("c4"), world: W("world"),
  hegrenade: N("he"), inferno: N("molotov"), molotov: N("molotov"), incendiary: N("incendiary"),
  flashbang: N("flashbang"), smokegrenade: N("smoke"), decoy: N("decoy"),
};

/** The icon for a raw demo weapon name (with or without `weapon_`), or null when there is none. */
export function weaponIconOf(weapon: string | null | undefined): WeaponIconRef | null {
  if (!weapon) return null;
  const w = weapon.startsWith("weapon_") ? weapon.slice(7) : weapon;
  return BY_NAME[w] ?? (w.startsWith("knife") ? W("knife") : null);
}

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

/** Width the icon takes at `height`, or null when the weapon has none. */
export function weaponIconWidth(weapon: string | null | undefined, height: number): number | null {
  const ref = weaponIconOf(weapon);
  if (!ref) return null;
  return ref.kind === "nade" ? (height * NADE_VIEW.w) / NADE_VIEW.h : (height * WEAPON_ICON[ref.id].w) / ICON_H;
}

/** Draw a weapon icon centred at (cx, cy); without an icon the `label` (default: the raw name) is drawn as text. */
export function drawWeaponIcon(ctx: Ctx, weapon: string, cx: number, cy: number, height: number, fill: string, outline?: string, label = weapon) {
  const ref = weaponIconOf(weapon);
  if (ref?.kind === "nade") return drawNadeIcon(ctx, ref.type, cx, cy, height, fill, outline);
  if (ref) return drawShape(ctx, path2D(ref.id, WEAPON_ICON[ref.id].d), WEAPON_ICON[ref.id].w, cx, cy, height, fill, outline);
  ctx.save();
  ctx.font = `600 ${height}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (outline) {
    ctx.lineWidth = height / 3;
    ctx.strokeStyle = outline;
    ctx.strokeText(label, cx, cy);
  }
  ctx.fillStyle = fill;
  ctx.fillText(label, cx, cy);
  ctx.restore();
}

export const feedIconWidth = (id: FeedId, height: number) => (id === "flashassist" ? (height * NADE_VIEW.w) / NADE_VIEW.h : height);

export function drawFeedIcon(ctx: Ctx, id: FeedId, cx: number, cy: number, height: number, fill: string, outline?: string) {
  if (id === "flashassist") return drawNadeIcon(ctx, "flashbang", cx, cy, height, fill, outline);
  drawShape(ctx, path2D(`feed.${id}`, FEED_PATH[id]), ICON_H, cx, cy, height, fill, outline);
}
