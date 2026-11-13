import { NADE_PATH, NADE_VIEW, isNadeType } from "../nadeIcons";

/** An inline grenade silhouette `size` px tall; unknown types render as a dot. */
export function NadeIcon({ type, color = "currentColor", size = 13, title }: { type: string; color?: string; size?: number; title?: string }) {
  const known = isNadeType(type);
  return (
    <svg
      className="nade-icon"
      viewBox={`0 0 ${NADE_VIEW.w} ${NADE_VIEW.h}`}
      height={size}
      width={(size * NADE_VIEW.w) / NADE_VIEW.h}
      role="img"
      style={{ fill: color }}
      aria-label={title}
    >
      {title && <title>{title}</title>}
      {known ? <path d={NADE_PATH[type]} fillRule="evenodd" /> : <circle cx={8} cy={12} r={6} />}
    </svg>
  );
}
