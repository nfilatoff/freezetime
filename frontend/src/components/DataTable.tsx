import { useMemo, useState } from "react";
import type { Row } from "../api";
import { t, td } from "../i18n";

// Column headers come from the locales (col.<name>); unknown columns are shown as-is.

const SIDES: Record<string, string> = { terrorist: "T", "counter-terrorist": "CT" };

function fmt(v: Row[string], digits = 1): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "✓" : "✗";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(digits);
  return SIDES[v] ?? v;
}

/** Decimals per column: 2 only if every fraction in the column is below 10 in size, so a column reads evenly. */
function precisions(rows: Row[], cols: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cols)
    out[c] = rows.every((r) => { const v = r[c]; return typeof v !== "number" || Number.isInteger(v) || Math.abs(v) < 10; }) ? 2 : 1;
  return out;
}

interface Props {
  rows: Row[];
  columns?: string[];
  title?: string;
  maxHeight?: number;
  onRowClick?: (row: Row) => void;
  selected?: (row: Row) => boolean;
  /** Rows for which this is false are not clickable (default: all when `onRowClick` is set). */
  canClick?: (row: Row) => boolean;
}

export function DataTable({ rows, columns, title, maxHeight, onRowClick, selected, canClick }: Props) {
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]).filter((c) => !c.includes("steamid")) : []);
  const [sort, setSort] = useState<{ col: string; desc: boolean } | null>(null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const s = [...rows].sort((a, b) => {
      const x = a[sort.col], y = b[sort.col];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return x < y ? -1 : 1;
    });
    return sort.desc ? s.reverse() : s;
  }, [rows, sort]);

  const digits = useMemo(() => precisions(rows, cols), [rows, cols.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="table-block">
      {title && <h3>{title}</h3>}
      {rows.length === 0 ? (
        <div className="muted">{t("table.noData")}</div>
      ) : (
        <div className="table-wrap" style={maxHeight ? { maxHeight } : undefined}>
          <table>
            <thead>
              <tr>
                {cols.map((c) => (
                  <th
                    key={c}
                    title={c}
                    onClick={() => setSort((s) => ({ col: c, desc: s?.col === c ? !s.desc : true }))}
                  >
                    {td(`col.${c}`, c)}
                    {sort?.col === c ? (sort.desc ? " ▾" : " ▴") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const click = onRowClick && (canClick?.(r) ?? true);
                return (
                <tr key={i} onClick={click ? () => onRowClick(r) : undefined} title={onRowClick && !click ? t("ps.noSteamId") : undefined}
                  className={`${click ? "clickable" : ""} ${selected?.(r) ? "sel" : ""}`}>
                  {cols.map((c) => (
                    <td key={c} className={typeof r[c] === "number" ? "num" : ""}>
                      {fmt(r[c], digits[c])}
                    </td>
                  ))}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
