import { NadeIcon } from "./NadeIcon";
import { weaponName } from "../replayDraw";
import { FEED_PATH, ICON_H, WEAPON_ICON, weaponIconOf, type FeedId } from "../weaponIcons";

/** An inline weapon silhouette `size` px tall; weapons without one show their name. */
export function WeaponIcon({ weapon, color = "currentColor", size = 13, title }: { weapon: string; color?: string; size?: number; title?: string }) {
  const ref = weaponIconOf(weapon);
  const name = title ?? weaponName(weapon);
  if (!ref) return <span title={name}>{name}</span>;
  if (ref.kind === "nade") return <NadeIcon type={ref.type} color={color} size={size} title={name} />;
  const { w, d } = WEAPON_ICON[ref.id];
  return (
    <svg className="weapon-icon" viewBox={`0 0 ${w} ${ICON_H}`} height={size} width={(size * w) / ICON_H} role="img" style={{ fill: color }} aria-label={name}>
      <title>{name}</title>
      <path d={d} fillRule="evenodd" />
    </svg>
  );
}

/** A kill feed mark (headshot, wallbang, smoke, no scope, blind, flash assist). */
export function FeedIcon({ id, color = "currentColor", size = 13, title }: { id: FeedId; color?: string; size?: number; title: string }) {
  if (id === "flashassist") return <NadeIcon type="flashbang" color={color} size={size} title={title} />;
  return (
    <svg className="weapon-icon" viewBox={`0 0 ${ICON_H} ${ICON_H}`} height={size} width={size} role="img" style={{ fill: color }} aria-label={title}>
      <title>{title}</title>
      <path d={FEED_PATH[id]} fillRule="evenodd" />
    </svg>
  );
}
