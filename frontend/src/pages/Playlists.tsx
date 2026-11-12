// Playlists: rounds to watch in a row. The page lists them by folder (and the recent ones), edits one
// (order by dragging, captions, from-to seconds), plays it in the replay, cuts it into GIF/MP4 and
// sends a match's part of it to the recorder. #/playlists[/<id>]; playback is #/playlist/<id>/<item>.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type LibraryMatch, type MatchOverview, type Playlist, type PlaylistItem } from "../api";
import { canEncodeVideo, download } from "../clipExport";
import { mapPretty } from "../components/MatchPicker";
import { RecordPanel } from "../components/RecordPanel";
import { ReplayView } from "../components/Replay";
import { secLabel } from "../components/ReplayExtras";
import { t } from "../i18n";
import { exportPlaylist, itemHighlight } from "../playlistExport";
import { go } from "../router";

type Item = Playlist["items"][number];
const RECENT = 5;
const itemSpan = (it: PlaylistItem) =>
  `${it.start == null ? t("pl.fromStart") : secLabel(it.start)} – ${it.end == null ? t("pl.toEndShort") : secLabel(it.end)}`;

function useLibrary() {
  const [matches, setMatches] = useState<Map<string, LibraryMatch>>(new Map());
  useEffect(() => {
    api.library().then((l) => setMatches(new Map(l.matches.map((m) => [m.id, m])))).catch(() => {});
  }, []);
  const name = (id: string) => {
    const m = matches.get(id);
    return m ? `${mapPretty(m.map)} · ${Object.keys(m.score ?? {}).join(" vs ") || id}` : id;
  };
  return { matches, name };
}

export function PlaylistsPage({ id }: { id?: string }) {
  const [lists, setLists] = useState<Playlist[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const reload = () => api.playlists().then(setLists).catch((e: Error) => setError(e.message));
  useEffect(() => {
    reload();
  }, []);

  const folders = useMemo(() => {
    const by = new Map<string, Playlist[]>();
    for (const p of lists ?? []) by.set(p.folder, [...(by.get(p.folder) ?? []), p]);
    return [...by.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  }, [lists]);
  const create = () => api.createPlaylist({ name: newName.trim() || t("pl.untitled"), folder: "", items: [] })
    .then((p) => { setNewName(""); reload(); go("playlists", p.id); }).catch((e: Error) => setError(e.message));
  const selected = lists?.find((p) => p.id === id) ?? null;

  const entry = (p: Playlist) => (
    <a key={p.id} href={`#/playlists/${p.id}`} className={`pl-entry ${p.id === id ? "on" : ""}`}>
      <span>{p.name}</span>
      <span className="muted small">{t("pl.itemsN", { n: p.items.length })}</span>
    </a>
  );

  return (
    <div className="page playlists-page">
      <div className="pagehead"><h1>{t("pl.title")}</h1><div className="sub">{t("pl.sub")}</div></div>
      {error && <div className="error">{error}</div>}
      <div className="pl-layout">
        <aside className="pl-side">
          <div className="row">
            <input className="grow" placeholder={t("pl.namePlaceholder")} value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()} />
            <button onClick={create} title={t("pl.create")}>+</button>
          </div>
          {lists && lists.length === 0 && <div className="muted small">{t("pl.none")}</div>}
          {lists && lists.length > RECENT && (
            <>
              <div className="pl-folder">{t("pl.recent")}</div>
              {lists.slice(0, RECENT).map(entry)}
            </>
          )}
          {folders.map(([folder, items]) => (
            <div key={folder || "-"}>
              <div className="pl-folder">{folder || t("pl.noFolder")}</div>
              {items.map(entry)}
            </div>
          ))}
        </aside>
        <div className="pl-main">
          {selected ? (
            <PlaylistEditor key={selected.id + selected.updated} pl={selected} onChanged={reload} folders={folders.map(([f]) => f).filter(Boolean)} />
          ) : (
            <div className="muted">{lists?.length ? t("pl.pick") : t("pl.howTo")}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlaylistEditor({ pl, onChanged, folders }: { pl: Playlist; onChanged: () => void; folders: string[] }) {
  const { matches, name: matchName } = useLibrary();
  const [name, setName] = useState(pl.name);
  const [folder, setFolder] = useState(pl.folder);
  const [items, setItems] = useState<Item[]>(pl.items);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [fromMatch, setFromMatch] = useState("");
  const [exporting, setExporting] = useState<{ i: number; n: number; p: number; abort: AbortController } | null>(null);
  const [recordMatch, setRecordMatch] = useState("");
  const [overview, setOverview] = useState<MatchOverview | null>(null);
  const saved = useRef(JSON.stringify([pl.name, pl.folder, pl.items]));
  const dirty = JSON.stringify([name, folder, items]) !== saved.current;

  useEffect(() => {
    setOverview(null);
    if (recordMatch) api.match(recordMatch).then(setOverview).catch(() => {});
  }, [recordMatch]);

  const save = () => api.updatePlaylist(pl.id, { name, folder, items })
    .then(() => { setMsg({ text: t("board.savedMsg") }); onChanged(); }).catch((e: Error) => setMsg({ text: e.message, error: true }));
  const edit = (i: number, patch: Partial<Item>) => setItems(items.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    setItems(next);
  };
  const sec = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
  const fromHighlights = async () => {
    if (!fromMatch) return;
    try {
      const h = await api.highlights(fromMatch);
      const add = [...h.custom, ...h.auto].map((x) => ({
        id: Math.random().toString(16).slice(2, 10).padEnd(8, "0"), match: fromMatch, round: x.round, start: x.start, end: x.end,
        caption: (x.kind === "custom" ? x.title : `${x.name ?? ""} ${x.kind}`.trim()) ?? "",
      }));
      setItems([...items, ...add]);
      setMsg({ text: t("pl.fromHighlightsDone", { n: add.length }) });
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    }
  };
  const exportAs = async (format: "gif" | "mp4") => {
    const abort = new AbortController();
    setMsg(null);
    try {
      const { blob, name: file } = await exportPlaylist({ ...pl, name, items }, { format, size: format === "gif" ? 512 : 768, fps: format === "gif" ? 15 : 30 },
        (i, n, p) => setExporting({ i, n, p, abort }), abort.signal);
      download(blob, file);
      setMsg({ text: t("hl.saved", { file, mb: (blob.size / 2 ** 20).toFixed(1) }) });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setMsg({ text: (e as Error).message, error: true });
    } finally {
      setExporting(null);
    }
  };
  const remove = () => window.confirm(t("pl.deleteConfirm", { name: pl.name })) &&
    api.deletePlaylist(pl.id).then(() => { onChanged(); go("playlists"); }).catch((e: Error) => setMsg({ text: e.message, error: true }));
  const inMatches = [...new Set(items.map((it) => it.match))];

  return (
    <div className="pl-editor">
      <div className="row">
        <input className="pl-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <input list="pl-folders" placeholder={t("pl.folder")} value={folder} maxLength={40} onChange={(e) => setFolder(e.target.value)} />
        <datalist id="pl-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
      </div>
      <div className="row">
        <button className="primary" disabled={!items.length || dirty} title={dirty ? t("pl.saveFirst") : undefined} onClick={() => go("playlist", pl.id, 0)}>{t("pl.play")}</button>
        <button disabled={!dirty} onClick={save}>{t("common.save")}</button>
        <button onClick={remove}>{t("common.delete")}</button>
        {msg && <span className={msg.error ? "error" : "muted small"}>{msg.text}</span>}
      </div>

      {items.length === 0 ? <div className="muted">{t("pl.empty")}</div> : (
        <ol className="pl-items">
          {items.map((it, i) => (
            <li key={it.id} className={dragging === i ? "dragging" : ""} draggable
              onDragStart={(e) => { setDragging(i); e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e) => { if (dragging !== null) { e.preventDefault(); move(dragging, i); setDragging(i); } }}
              onDragEnd={() => setDragging(null)}>
              <span className="pl-grip" title={t("pl.drag")}>⋮⋮</span>
              <button className="link" onClick={() => go("match", it.match, "replay", it.round, it.start ?? 0)} title={t("pl.openInReplay")}>
                {t("pl.round", { round: it.round })}
              </button>
              <span className="muted small pl-match">{matchName(it.match)}</span>
              <input className="sec-input" value={it.start ?? ""} placeholder={t("pl.fromStart")} title={t("pl.from")}
                onChange={(e) => { const v = sec(e.target.value); if (v === null || !Number.isNaN(v)) edit(i, { start: v }); }} />
              <input className="sec-input" value={it.end ?? ""} placeholder={t("pl.toEndShort")} title={t("pl.to")}
                onChange={(e) => { const v = sec(e.target.value); if (v === null || !Number.isNaN(v)) edit(i, { end: v }); }} />
              <input className="grow" value={it.caption} placeholder={t("pl.captionPlaceholder")} maxLength={200} onChange={(e) => edit(i, { caption: e.target.value })} />
              <button className="small-btn" title={t("common.delete")} onClick={() => setItems(items.filter((_, k) => k !== i))}>✕</button>
            </li>
          ))}
        </ol>
      )}

      {matches.size > 0 && (
        <div className="row">
          <select value={fromMatch} onChange={(e) => setFromMatch(e.target.value)}>
            <option value="">{t("pl.pickMatch")}</option>
            {[...matches.keys()].map((m) => <option key={m} value={m}>{matchName(m)}</option>)}
          </select>
          <button disabled={!fromMatch} onClick={fromHighlights}>{t("pl.fromHighlights")}</button>
          <span className="muted small">{t("pl.fromHighlightsHint")}</span>
        </div>
      )}

      <h3>{t("pl.export")}</h3>
      <div className="row">
        <button disabled={!items.length || !!exporting} onClick={() => exportAs("gif")}>GIF (zip)</button>
        <button disabled={!items.length || !!exporting || !canEncodeVideo()} onClick={() => exportAs("mp4")}>MP4 (zip)</button>
        {exporting && (
          <>
            <span className="small">{t("pl.exporting", { i: exporting.i, n: exporting.n, pct: Math.round(exporting.p * 100) })}</span>
            <button className="small-btn" onClick={() => exporting.abort.abort()}>{t("common.cancel")}</button>
          </>
        )}
        <span className="muted small">{t("pl.exportHint")}</span>
      </div>

      {inMatches.length > 0 && (
        <>
          <h3>{t("pl.record")}</h3>
          <div className="row">
            <select value={recordMatch} onChange={(e) => setRecordMatch(e.target.value)}>
              <option value="">{t("pl.pickMatch")}</option>
              {inMatches.map((m) => <option key={m} value={m}>{matchName(m)} · {t("pl.itemsN", { n: items.filter((it) => it.match === m).length })}</option>)}
            </select>
            <span className="muted small">{t("pl.recordHint")}</span>
          </div>
          {overview && (
            <RecordPanel match={overview} checked={items.filter((it) => it.match === overview.id).map((it) => itemHighlight(it))} onFinished={() => {}} />
          )}
        </>
      )}
    </div>
  );
}

/** Playback: one item after another in the replay; the list on the side switches items and playlists. */
export function PlaylistPlayer({ id, index }: { id: string; index: number }) {
  const [pl, setPl] = useState<Playlist | null>(null);
  const [all, setAll] = useState<Playlist[]>([]);
  const [match, setMatch] = useState<MatchOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const { name: matchName } = useLibrary();
  useEffect(() => {
    api.playlist(id).then(setPl).catch((e: Error) => setError(e.message));
    api.playlists().then(setAll).catch(() => {});
  }, [id]);
  const item = pl?.items[Math.max(0, Math.min(index, (pl?.items.length ?? 1) - 1))];
  useEffect(() => {
    if (!item) return;
    if (match?.id !== item.match) {
      setMatch(null);
      api.match(item.match).then(setMatch).catch((e: Error) => setError(e.message));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.match]);

  if (error) return <div className="page error">{error}</div>;
  if (!pl) return <div className="page">{t("common.loading")}</div>;
  if (!item) return <div className="page"><div className="muted">{t("pl.empty")}</div><a href={`#/playlists/${id}`}>{t("pl.back")}</a></div>;
  const i = pl.items.indexOf(item);
  const next = () => {
    if (i + 1 < pl.items.length) go("playlist", pl.id, i + 1);
  };

  return (
    <div className="page playlist-player">
      <div className="row">
        <a href={`#/playlists/${pl.id}`}>{t("pl.back")}</a>
        <select value={pl.id} onChange={(e) => go("playlist", e.target.value, 0)} title={t("pl.switch")}>
          {all.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button disabled={i === 0} onClick={() => go("playlist", pl.id, i - 1)}>{t("pl.prev")}</button>
        <b>{t("pl.position", { i: i + 1, n: pl.items.length })}</b>
        <button disabled={i + 1 >= pl.items.length} onClick={next}>{t("pl.next")}</button>
        <label className="small"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> {t("pl.auto")}</label>
        <span className="muted small">{matchName(item.match)} · {t("pl.round", { round: item.round })} · {itemSpan(item)}</span>
      </div>
      {item.caption && <div className="pl-caption">{item.caption}</div>}
      <div className="pl-play-layout">
        <div className="pl-play-main">
          {match ? (
            <ReplayView key={`${pl.id}-${item.id}`} match={match} round={item.round} at={item.start ?? undefined} until={item.end}
              autoplay onEnd={() => auto && setTimeout(next, 800)}
              onPrev={() => i > 0 && go("playlist", pl.id, i - 1)} onNext={next} />
          ) : t("common.loading")}
        </div>
        <ol className="pl-queue">
          {pl.items.map((it, k) => (
            <li key={it.id} className={k === i ? "on" : ""}>
              <a href={`#/playlist/${pl.id}/${k}`}>{t("pl.round", { round: it.round })} <span className="muted small">{it.caption || itemSpan(it)}</span></a>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
