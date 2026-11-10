// A playlist as video: every item drawn on the radar like a highlight clip, one file per item in a zip.
import { api, type Highlight, type MatchOverview, type Playlist, type PlaylistItem } from "./api";
import { exportGif, exportMp4, zipFiles } from "./clipExport";
import { drawHighlight, hlDuration, prepareFrame } from "./highlightRender";
import { loadMapAssets } from "./radar";
import { loadReplay } from "./replayDraw";

export const ITEM_MAX_SEC = 90; // an item "to the end of the round" is cut here

/** A playlist item in the shape the highlight renderer and the recorder take. */
export function itemHighlight(item: PlaylistItem & { id: string }, roundSec?: number): Highlight {
  const start = item.start ?? 0;
  const end = item.end ?? Math.min(start + ITEM_MAX_SEC, roundSec ?? start + 30);
  return { id: item.id, kind: "custom", round: item.round, steamid: null, start, end: Math.max(end, start + 0.5), title: item.caption || "" };
}

export async function exportPlaylist(
  pl: Playlist, opts: { format: "gif" | "mp4"; size: number; fps: number },
  onProgress: (i: number, n: number, fraction: number) => void, signal: AbortSignal,
): Promise<{ blob: Blob; name: string }> {
  const overviews = new Map<string, Promise<MatchOverview>>();
  const files: [string, Blob | string][] = [];
  const lines: string[] = [];
  for (let i = 0; i < pl.items.length; i++) {
    const item = pl.items[i];
    if (!overviews.has(item.match)) overviews.set(item.match, api.match(item.match));
    const match = await overviews.get(item.match)!;
    const assets = await loadMapAssets(match.map);
    const r = await loadReplay(match.id, item.round);
    const h = itemHighlight(item, (r.end_tick - r.freeze_end_tick) / r.tick_rate + 3);
    const f = prepareFrame(assets, r, h, match, opts.size, { zoom: false, names: true });
    const job = {
      width: f.width, height: f.height, duration: hlDuration(h), speed: 1, fps: opts.fps,
      render: (ctx: CanvasRenderingContext2D, time: number) => drawHighlight(ctx, assets, f, time),
      onProgress: (p: number) => onProgress(i + 1, pl.items.length, p), signal,
    };
    const media = opts.format === "gif" ? await exportGif(job) : await exportMp4(job);
    const base = `${String(i + 1).padStart(2, "0")}_${match.map.replace(/^de_/, "")}_R${item.round}${item.caption ? `_${item.caption}` : ""}`
      .replace(/[^\p{L}\p{N}_+-]+/gu, "_").slice(0, 80);
    files.push([`${base}.${opts.format}`, media]);
    lines.push(`${i + 1}. ${match.id} R${item.round} ${h.start}-${h.end}s ${item.caption}`.trim());
  }
  files.push(["playlist.txt", `${pl.name}\n\n${lines.join("\n")}\n`]);
  const name = `${pl.name}.zip`.replace(/[^\p{L}\p{N}_.+-]+/gu, "_");
  return { blob: await zipFiles(files), name };
}
