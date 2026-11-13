import { EquipmentIcon } from "./EquipmentIcon";
import { NadeIcon } from "./NadeIcon";
import { weaponName } from "../replayDraw";
import { FEED_PATH, ICON_H, type FeedId } from "../weaponIcons";

/** An inline weapon silhouette `size` px tall; weapons without one show their name. */
export function WeaponIcon({ weapon, color = "currentColor", size = 13, title }: { weapon: string; color?: string; size?: number; title?: string }) {
  const name = title ?? weaponName(weapon);
  return <EquipmentIcon item={weapon} color={color} size={size} maxWidth={size * 3} title={name} fallback={name} />;
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
