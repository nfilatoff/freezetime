import { isNadeType } from "../nadeIcons";
import { EquipmentIcon } from "./EquipmentIcon";

/** An upright CS2 grenade silhouette; unknown types retain the dot fallback. */
export function NadeIcon({ type, color = "currentColor", size = 13, title }: { type: string; color?: string; size?: number; title?: string }) {
  if (isNadeType(type)) return <EquipmentIcon item={type} size={size} maxWidth={size} title={title} className="nade-icon" color={color} />;
  return <svg className="nade-icon" viewBox="0 0 16 24" width={size * 2 / 3} height={size} fill={color} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>{title && <title>{title}</title>}<circle cx={8} cy={12} r={6} /></svg>;
}
