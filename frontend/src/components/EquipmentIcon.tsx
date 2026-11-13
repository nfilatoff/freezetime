import { equipmentIcon, equipmentSize } from "../equipmentIcons";

/** The same local CS2 silhouette as the Canvas replay and clip export. */
export function EquipmentIcon({ item, size = 14, maxWidth = 44, title, className = "", color = "currentColor", fallback = "" }: { item: string | null | undefined; size?: number; maxWidth?: number; title?: string; className?: string; color?: string; fallback?: string }) {
  const icon = equipmentIcon(item);
  if (!icon) return fallback ? <span className="equipment-fallback" title={title}>{fallback}</span> : null;
  const box = equipmentSize(item, size, maxWidth);
  return (
    <svg className={`equipment-icon ${className}`} viewBox={icon.view.join(" ")} width={box.width} height={box.height} fill={color} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      {icon.paths.map((path, index) => <path key={index} d={path.d} fillRule={path.rule} fillOpacity={path.opacity} />)}
    </svg>
  );
}
