import { useEffect, useState } from "react";
import { api, recordingUrl, type BoardSummary, type LibraryMatch, type MatchOverview, type PlaybookAttachment,
  type PlaybookBook, type PlaybookDraft, type PlaybookEntry, type PlaybookTask, type Playlist, type PrivatePlaybook,
  type StrategyStats, type TeamMember } from "../api";
import { download } from "../clipExport";
import { mapPretty } from "../components/MatchPicker";
import { ReplayView } from "../components/Replay";
import { WhoAmI } from "../components/TeamShare";
import { t } from "../i18n";
import { nadeLabel } from "../components/InsightCards";
import { attachmentLink, playbookText, playbookXlsx } from "../playbookExport";
import { go } from "../router";
import { copyText, useSession } from "../session";

const blank = (): PlaybookDraft => ({ name: "", kind: "strategy", map: "", side: "", category: "", pinned: false,
  description: "", steps: [], tasks: {}, attachments: [], detector: null });
const KINDS = ["strategy", "protocol", "setup"] as const;
const ATTACHMENTS = ["board", "round", "playlist", "recording", "url"] as const;
const sideName = (side: string) => side === "terrorist" ? "T" : side === "counter-terrorist" ? "CT" : t("pb.anySide");

export function PlaybookPage({ id }: { id?: string }) {
  const session = useSession();
  const [data, setData] = useState<PrivatePlaybook | null>(null);
  const [roster, setRoster] = useState<TeamMember[]>([]);
  const [bookId, setBookId] = useState("");
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState("");
  const [map, setMap] = useState("");
  const [kind, setKind] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [bookName, setBookName] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = async () => { setData(await api.playbook()); setRevision((r) => r + 1); };
  useEffect(() => {
    reload().catch((e: Error) => setError(e.message));
    api.team().then((d) => setRoster(d.team.members)).catch((e: Error) => setError(e.message));
  }, []);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await work(); await reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const book = data?.books.find((b) => b.id === bookId);
  const order = book?.entries ?? data?.entries.map((e) => e.id) ?? [];
  const entries = (data?.entries ?? []).filter((e) => order.includes(e.id) && (!map || e.map === map) && (!kind || e.kind === kind) &&
    (!category || e.category === category) && (!mine || (!!session?.member && !!e.tasks[session.member.id])) &&
    (!search || `${e.name} ${e.description} ${e.category}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || order.indexOf(a.id) - order.indexOf(b.id));
  const selected = data?.entries.find((e) => e.id === id);
  const name = book?.name ?? t("pb.title");
  const ownId = mine ? session?.member?.id : undefined;
  const exportFile = (format: "txt" | "md" | "xlsx") => {
    const safe = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 100);
    download(format === "xlsx" ? playbookXlsx(entries, roster, ownId) : new Blob([playbookText(name, entries, roster, ownId, format === "md")],
      { type: "text/plain;charset=utf-8" }), `${safe}.${format}`);
  };
  const saveBook = (b: Pick<PlaybookBook, "name" | "entries">, existing?: string) => run(async () => {
    const saved = await api.savePlaybookBook(b, existing); setBookId(saved.id); setBookName("");
  });
  const move = (from: string, to: string) => {
    if (!book || from === to) return;
    const ids = book.entries.filter((e) => e !== from);
    ids.splice(ids.indexOf(to), 0, from);
    saveBook({ ...book, entries: ids }, book.id);
  };

  return <div className="page playbook-page">
    <div className="pagehead screen-only"><h1>{t("pb.title")}</h1><div className="sub">{t("pb.sub")}</div></div>
    <div className="screen-only"><WhoAmI /></div>
    {error && <div className="error">{error}</div>}
    <div className="pb-layout screen-only">
      <aside className="pb-side">
        <button className={!bookId ? "on" : ""} onClick={() => setBookId("")}>{t("pb.all")}</button>
        <h3>{t("pb.books")}</h3>
        {data?.books.map((b) => <button className={bookId === b.id ? "on" : ""} key={b.id} onClick={() => setBookId(b.id)}>{b.name} <span className="muted">{b.entries.length}</span></button>)}
        {session?.can_edit && <form onSubmit={(e) => { e.preventDefault(); saveBook({ name: bookName, entries: [] }); }}>
          <input aria-label={t("pb.bookName")} placeholder={t("pb.bookName")} maxLength={120} value={bookName} onChange={(e) => setBookName(e.target.value)} />
          <button disabled={busy || !bookName.trim()}>{t("pb.createBook")}</button>
        </form>}
        <label><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> {t("pb.mine")}</label>
        {mine && !session?.member && <p className="muted small">{t("pb.chooseIdentity")}</p>}
      </aside>
      <div className="pb-main">
        <div className="row">
          <h2>{name}</h2>
          {session?.can_edit && <button disabled={busy} onClick={() => go("playbook", "new")}>{t("pb.create")}</button>}
          {book && session?.can_edit && <>
            <button disabled={busy} onClick={() => { const n = window.prompt(t("pb.bookName"), book.name); if (n?.trim()) saveBook({ ...book, name: n }, book.id); }}>{t("pb.rename")}</button>
            <button disabled={busy} onClick={() => window.confirm(t("pb.deleteBookConfirm", { name: book.name })) && run(async () => { await api.deletePlaybookItem("books", book.id); setBookId(""); })}>{t("common.delete")}</button>
          </>}
        </div>
        <div className="row pb-filters">
          <input aria-label={t("pb.search")} placeholder={t("pb.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
          <select aria-label={t("pb.map")} value={map} onChange={(e) => setMap(e.target.value)}><option value="">{t("pb.anyMap")}</option>
            {[...new Set(data?.entries.map((e) => e.map).filter(Boolean))].sort().map((m) => <option key={m}>{m}</option>)}
          </select>
          <select aria-label={t("pb.kind")} value={kind} onChange={(e) => setKind(e.target.value)}><option value="">{t("pb.anyKind")}</option>
            {KINDS.map((k) => <option key={k} value={k}>{t(`pb.kind.${k}`)}</option>)}
          </select>
          <select aria-label={t("pb.category")} value={category} onChange={(e) => setCategory(e.target.value)}><option value="">{t("pb.anyCategory")}</option>
            {[...new Set(data?.entries.map((e) => e.category).filter(Boolean))].sort().map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="row">
          <span className="muted small">{t("pb.exportHint")}</span>
          {(["txt", "md", "xlsx"] as const).map((f) => <button key={f} disabled={!entries.length} onClick={() => exportFile(f)}>{f.toUpperCase()}</button>)}
          <button disabled={!entries.length} onClick={() => window.print()}>{t("pb.pdf")}</button>
        </div>
        <div className="pb-entries">
          {entries.map((e) => <div key={e.id} className={`pb-entry ${e.id === id ? "on" : ""}`} draggable={!!book && !!session?.can_edit && !busy}
            onDragStart={(event) => { setDragging(e.id); event.dataTransfer.effectAllowed = "move"; }} onDragOver={(event) => { if (dragging) event.preventDefault(); }}
            onDrop={(event) => { event.preventDefault(); if (dragging) move(dragging, e.id); setDragging(null); }} onDragEnd={() => setDragging(null)}>
            <a href={`#/playbook/${e.id}`}><b>{e.pinned ? "★ " : ""}{e.name}</b><span className="small muted">{[t(`pb.kind.${e.kind}`), e.map, sideName(e.side), e.category].filter(Boolean).join(" · ")}</span></a>
            {book && session?.can_edit && <span className="pb-order">
              <button className="small-btn" title={t("pb.moveUp")} disabled={busy || book.entries.indexOf(e.id) === 0}
                onClick={() => move(e.id, book.entries[book.entries.indexOf(e.id) - 1])}>↑</button>
              <button className="small-btn" title={t("pb.removeFromBook")} disabled={busy}
                onClick={() => saveBook({ ...book, entries: book.entries.filter((i) => i !== e.id) }, book.id)}>✕</button>
            </span>}
          </div>)}
          {data && !entries.length && <p className="muted">{t("pb.empty")}</p>}
        </div>
        {id === "new" && session?.can_edit ? <EntryEditor key={`new-${revision}`} roster={roster} books={data?.books ?? []} initialBook={bookId}
          onSaved={async (entry) => { await reload(); go("playbook", entry.id); }} /> : selected ?
          <EntryCard key={`${selected.id}-${revision}`} entry={selected} roster={roster} books={data?.books ?? []} mine={ownId} mineMode={mine}
            onChanged={reload} onDeleted={() => { reload().catch((e: Error) => setError(e.message)); go("playbook"); }} /> :
          <p className="muted">{!data ? t("common.loading") : id ? t("pb.notFound") : t("pb.pick")}</p>}
      </div>
    </div>
    <div className="print-only pb-print"><h1>{name}</h1>{entries.map((e) => <article key={e.id}><h2>{e.name}</h2><EntryText entry={e} roster={roster} mine={ownId} mineMode={mine} print /></article>)}</div>
  </div>;
}

function EntryCard({ entry, roster, books, mine, mineMode, onChanged, onDeleted }: {
  entry: PlaybookEntry; roster: TeamMember[]; books: PlaybookBook[]; mine?: string; mineMode: boolean;
  onChanged: () => Promise<void>; onDeleted: () => void;
}) {
  const session = useSession();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<StrategyStats | null>(null);
  useEffect(() => { api.playbookStats(entry.id).then(setStats).catch((e: Error) => setError(e.message)); }, [entry.id]);
  if (editing) return <EntryEditor entry={entry} roster={roster} books={books} onCancel={() => setEditing(false)} onSaved={async () => { await onChanged(); setEditing(false); }} />;
  return <article className="pb-card">
    <div className="row"><h2>{entry.name}</h2>{session?.can_edit && <>
      <button onClick={() => setEditing(true)}>{t("pb.edit")}</button>
      <button onClick={() => window.confirm(t("pb.deleteEntryConfirm", { name: entry.name })) && api.deletePlaybookItem("entries", entry.id).then(onDeleted).catch((e: Error) => setError(e.message))}>{t("common.delete")}</button>
    </>}</div>
    {error && <div className="error">{error}</div>}
    <EntryText entry={entry} roster={roster} mine={mine} mineMode={mineMode} />
    {entry.detector && <div className="pb-stats">
      <h3>{t("pb.stats")}</h3><p className="muted small">{t("pb.statsHint")}</p>
      {!stats ? t("common.loading") : !stats.available ? t("pb.statsUnavailable") : <>
        <b>{t("pb.statsLine", { n: stats.rounds, win: stats.win_pct ?? "–", sample: stats.sample })}</b>
        <div className="row">{stats.examples.map((r) => <a key={`${r.match}-${r.round}`} href={`#/match/${encodeURIComponent(r.match)}/replay/${r.round}/${r.sec}`}>{r.match} · {t("pl.round", { round: r.round })}</a>)}</div>
        {stats.warnings.map((w, i) => <div className="warn" key={i}>{w}</div>)}
      </>}
    </div>}
  </article>;
}

function EntryText({ entry, roster, mine, mineMode, print = false }: { entry: PlaybookEntry; roster: TeamMember[]; mine?: string; mineMode: boolean; print?: boolean }) {
  return <>
    <div className="muted small">{[t(`pb.kind.${entry.kind}`), entry.map, sideName(entry.side), entry.category].filter(Boolean).join(" · ")}</div>
    <p className="pb-prose">{entry.description}</p>
    {!!entry.steps.length && <><h3>{t("pb.steps")}</h3><ol>{entry.steps.map((s, i) => <li className="pb-prose" key={i}>{s}</li>)}</ol></>}
    <h3>{mineMode ? t("pb.mine") : t("pb.tasks")}</h3>
    {Object.entries(entry.tasks).filter(([id]) => !mineMode || mine === id).map(([id, task]) => <section className="pb-task" key={id}>
      <h4>{roster.find((m) => m.id === id)?.nick ?? id}</h4><p className="pb-prose">{task.text}</p>
      {task.utility.map((u, i) => <div className="pb-utility" key={i}>
        <b>{u.label || nadeLabel(u.type)}</b><code>{u.commands}</code>
        {!print && <CopyCommand value={u.commands} />}
        <a href={attachmentLink({ kind: "round", label: "", ...u.source })}>{t("pb.sourceThrow")}</a>
      </div>)}
    </section>)}
    {mineMode && (!mine || !entry.tasks[mine]) && <p className="muted">{t("pb.noTask")}</p>}
    {!!entry.attachments.length && <><h3>{t("pb.attachments")}</h3>{entry.attachments.map((a, i) => print ?
      <p key={i}>{a.label || t(`pb.attachment.${a.kind}`)}: {attachmentLink(a)}</p> : <Attachment key={i} attachment={a} />)}</>}
  </>;
}

function CopyCommand({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return <button className="small-btn" onClick={async () => { const ok = await copyText(value); setDone(ok); if (!ok) window.prompt(t("pb.copy"), value); }}>{done ? t("team.copied") : t("pb.copy")}</button>;
}

function Attachment({ attachment: a }: { attachment: PlaybookAttachment }) {
  const [open, setOpen] = useState(false);
  return <details className="pb-attachment" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{a.label || t(`pb.attachment.${a.kind}`)}</summary>
    <a href={attachmentLink(a)} target={a.kind === "url" ? "_blank" : undefined} rel="noreferrer">{t("pb.openAttachment")}</a>
    {open && a.kind === "round" && <RoundPreview attachment={a} />}
    {open && a.kind === "playlist" && <InlinePlaylist id={a.playlist} />}
    {open && a.kind === "recording" && <video controls preload="metadata" src={recordingUrl(a.match, a.file)} />}
    {a.kind === "url" && <p className="muted small">{t("pb.externalHint")}</p>}
  </details>;
}

function RoundPreview({ attachment: a, onEnd }: { attachment: Extract<PlaybookAttachment, { kind: "round" }>; onEnd?: () => void }) {
  const [match, setMatch] = useState<MatchOverview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true; setMatch(null); setError("");
    api.match(a.match).then((m) => { if (active) setMatch(m); }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [a.match]);
  return error ? <p className="error">{error}</p> : match ?
    <ReplayView key={`${a.match}-${a.round}-${a.start}-${a.end}`} match={match} round={a.round} at={a.start ?? undefined} until={a.end} onEnd={onEnd} autoplay={!!onEnd} /> : <p>{t("common.loading")}</p>;
}

function InlinePlaylist({ id }: { id: string }) {
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => { api.playlist(id).then(setPlaylist).catch((e: Error) => setError(e.message)); }, [id]);
  const item = playlist?.items[index];
  return <div>{error && <p className="error">{error}</p>}{playlist && <>
    <div className="row"><b>{playlist.name}</b><button disabled={!index} onClick={() => setIndex(index - 1)}>{t("pl.prev")}</button>
      <span>{t("pl.position", { i: item ? index + 1 : 0, n: playlist.items.length })}</span>
      <button disabled={index + 1 >= playlist.items.length} onClick={() => setIndex(index + 1)}>{t("pl.next")}</button></div>
    {item ? <RoundPreview attachment={{ ...item, kind: "round", label: item.caption }} onEnd={() => { if (index + 1 < playlist.items.length) setIndex(index + 1); }} /> : <p>{t("pl.empty")}</p>}
  </>}</div>;
}

function EntryEditor({ entry, roster, books, initialBook, onSaved, onCancel }: { entry?: PlaybookEntry; roster: TeamMember[]; books: PlaybookBook[]; initialBook?: string;
  onSaved: (entry: PlaybookEntry) => Promise<void>; onCancel?: () => void }) {
  const [draft, setDraft] = useState<PlaybookDraft>(entry ?? blank);
  const [membership, setMembership] = useState<string[]>(entry ? books.filter((b) => b.entries.includes(entry.id)).map((b) => b.id) : initialBook ? [initialBook] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState<string | undefined>(entry?.id);
  const [maps, setMaps] = useState<string[]>([]);
  useEffect(() => { api.maps().then(setMaps).catch((e: Error) => setError(e.message)); }, []);
  const edit = (patch: Partial<PlaybookDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const task = (id: string, value: PlaybookTask) => edit({ tasks: { ...draft.tasks, [id]: value } });
  const dirty = JSON.stringify(draft) !== JSON.stringify(entry ?? blank()) || JSON.stringify([...membership].sort()) !==
    JSON.stringify(books.filter((b) => entry && b.entries.includes(entry.id)).map((b) => b.id).sort());
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    const follow = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (dirty && a && a.target !== "_blank" && a.href !== location.href && !window.confirm(t("pb.discardConfirm"))) {
        e.preventDefault(); e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", before); window.addEventListener("click", follow, true);
    return () => { window.removeEventListener("beforeunload", before); window.removeEventListener("click", follow, true); };
  }, [dirty]);
  const save = async () => {
    setBusy(true); setError("");
    try {
      const saved = await api.savePlaybookEntry(draft, savedId); setSavedId(saved.id);
      // Read current books so edits by another staff member are not replaced by an old snapshot.
      const current = await api.playbook();
      for (const b of current.books) {
        const contains = b.entries.includes(saved.id), wanted = membership.includes(b.id);
        if (contains !== wanted) await api.savePlaybookBook({ ...b, entries: wanted ? [...b.entries, saved.id] : b.entries.filter((id) => id !== saved.id) }, b.id);
      }
      await onSaved(saved);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <section className="pb-card pb-editor">
    <h2>{entry ? t("pb.edit") : t("pb.create")}</h2>
    {error && <p className="error">{error}</p>}
    <fieldset className="plain" disabled={busy}>
      <label>{t("pb.name")}<input value={draft.name} maxLength={120} onChange={(e) => edit({ name: e.target.value })} /></label>
      <div className="row">
        <label>{t("pb.kind")}<select value={draft.kind} onChange={(e) => edit({ kind: e.target.value as PlaybookDraft["kind"] })}>{KINDS.map((k) => <option key={k} value={k}>{t(`pb.kind.${k}`)}</option>)}</select></label>
        <label>{t("pb.map")}<select value={draft.map} onChange={(e) => edit({ map: e.target.value, detector: null })}><option value="">{t("pb.anyMap")}</option>{[...new Set([...maps, draft.map].filter(Boolean))].map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>{t("pb.side")}<select value={draft.side} onChange={(e) => edit({ side: e.target.value as PlaybookDraft["side"], detector: e.target.value === "counter-terrorist" ? null : draft.detector })}>
          <option value="">{t("pb.anySide")}</option><option value="terrorist">T</option><option value="counter-terrorist">CT</option></select></label>
        <label>{t("pb.category")}<input value={draft.category} maxLength={80} onChange={(e) => edit({ category: e.target.value })} /></label>
        <label><input type="checkbox" checked={draft.pinned} onChange={(e) => edit({ pinned: e.target.checked })} /> {t("pb.pinned")}</label>
      </div>
      <div className="row">{books.map((b) => <label key={b.id}><input type="checkbox" checked={membership.includes(b.id)}
        onChange={(e) => setMembership(e.target.checked ? [...membership, b.id] : membership.filter((id) => id !== b.id))} /> {b.name}</label>)}</div>
      <label>{t("pb.description")}<textarea rows={4} maxLength={12000} value={draft.description} onChange={(e) => edit({ description: e.target.value })} /></label>
      <h3>{t("pb.steps")}</h3>
      {draft.steps.map((s, i) => <div className="row" key={i}><span>{i + 1}.</span><textarea rows={2} className="grow" maxLength={2000} value={s} onChange={(e) => edit({ steps: draft.steps.map((v, k) => i === k ? e.target.value : v) })} />
        <button title={t("common.delete")} onClick={() => edit({ steps: draft.steps.filter((_, k) => k !== i) })}>✕</button></div>)}
      <button disabled={draft.steps.length >= 50} onClick={() => edit({ steps: [...draft.steps, ""] })}>{t("pb.addStep")}</button>
      <h3>{t("pb.tasks")}</h3>
      {Object.entries(draft.tasks).map(([id, value]) => <div className="pb-task" key={id}>
        <div className="row"><h4>{roster.find((m) => m.id === id)?.nick ?? id}</h4><button onClick={() => { const next = { ...draft.tasks }; delete next[id]; edit({ tasks: next }); }}>{t("common.delete")}</button></div>
        <textarea aria-label={t("pb.taskText")} rows={3} maxLength={4000} value={value.text} onChange={(e) => task(id, { ...value, text: e.target.value })} />
        {value.utility.map((u, i) => <div className="pb-utility" key={i}><b>{u.label || nadeLabel(u.type)}</b><code>{u.commands}</code><button className="small-btn" title={t("common.delete")} onClick={() => task(id, { ...value, utility: value.utility.filter((_, k) => i !== k) })}>✕</button></div>)}
        <UtilityImport member={roster.find((m) => m.id === id)} attachments={draft.attachments} onCopy={(utility) => {
          setDraft((current) => {
            const latest = current.tasks[id];
            if (!latest) return current;
            const bySource = new Map([...latest.utility, ...utility].map((u) => [`${u.source.match}-${u.source.round}-${u.source.steamid}-${u.source.start}`, u]));
            return { ...current, tasks: { ...current.tasks, [id]: { ...latest, utility: [...bySource.values()] } } };
          });
        }} />
      </div>)}
      <select aria-label={t("pb.addTask")} value="" onChange={(e) => { if (e.target.value) task(e.target.value, { text: "", utility: [] }); }}><option value="">{t("pb.addTask")}</option>
        {roster.filter((m) => !draft.tasks[m.id]).map((m) => <option key={m.id} value={m.id}>{m.nick}</option>)}</select>
      {!roster.length && <p className="muted small">{t("pb.rosterHint")}</p>}
      <h3>{t("pb.attachments")}</h3>
      {draft.attachments.map((a, i) => <div className="row" key={i}><a href={attachmentLink(a)}>{a.label || t(`pb.attachment.${a.kind}`)}</a>
        <button title={t("common.delete")} onClick={() => edit({ attachments: draft.attachments.filter((_, k) => i !== k) })}>✕</button></div>)}
      <AttachmentForm onAdd={(a) => edit({ attachments: [...draft.attachments, a] })} />
      {draft.detector && <p className="muted small">{t("pb.detector", { site: draft.detector.site, core: draft.detector.core.map((c) => `${nadeLabel(c.type)} ${c.zone}`).join(", ") || t("scout.noSmokes") })}</p>}
      <div className="row"><button className="primary" disabled={!draft.name.trim() || draft.steps.some((s) => !s.trim())} onClick={save}>{t("common.save")}</button>
        <button onClick={() => { if (!dirty || window.confirm(t("pb.discardConfirm"))) { if (onCancel) onCancel(); else go("playbook"); } }}>{t("common.cancel")}</button></div>
    </fieldset>
  </section>;
}

function UtilityImport({ member, attachments, onCopy }: { member?: TeamMember; attachments: PlaybookAttachment[]; onCopy: (utility: PlaybookTask["utility"]) => void }) {
  const rounds = attachments.filter((a): a is Extract<PlaybookAttachment, { kind: "round" }> => a.kind === "round");
  const [index, setIndex] = useState("");
  const [players, setPlayers] = useState<{ id: string; name: string }[]>([]);
  const [player, setPlayer] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const round = index === "" ? undefined : rounds[Number(index)];
  useEffect(() => {
    let active = true; setPlayers([]); setPlayer(""); setMessage("");
    if (round) api.throws(round.match).then((d) => {
      if (!active) return;
      const found = [...new Map(d.throws.filter((u) => u.round_num === round.round).map((u) => [u.steamid, { id: u.steamid, name: u.name }])).values()];
      setPlayers(found); setPlayer(found.find((p) => p.id === member?.steamid)?.id ?? "");
    }).catch((e: Error) => { if (active) { setMessage(e.message); setFailed(true); } });
    return () => { active = false; };
  }, [round?.match, round?.round, member?.steamid]);
  if (!member) return null;
  const copy = async () => {
    if (!round || !player) return;
    setBusy(true); setMessage(""); setFailed(false);
    try { const utility = await api.copyPlaybookUtility({ match: round.match, round: round.round, start: round.start, end: round.end, steamid: player, member: member.id });
      onCopy(utility); setMessage(t("pb.utilityCopied", { n: utility.length }));
    } catch (e) { setMessage((e as Error).message); setFailed(true); } finally { setBusy(false); }
  };
  return <div className="pb-import"><p className="muted small">{t("pb.utilityHint")}</p><div className="row">
    <select aria-label={t("pb.sourceRound")} value={index} onChange={(e) => setIndex(e.target.value)}><option value="">{t("pb.sourceRound")}</option>
      {rounds.map((a, i) => <option key={i} value={i}>{a.label || `${a.match} · ${t("pl.round", { round: a.round })}`}</option>)}</select>
    <select aria-label={t("pb.demoPlayer")} value={player} onChange={(e) => setPlayer(e.target.value)}><option value="">{t("pb.demoPlayer")}</option>{players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    <span>→ {member.nick}</span><button disabled={!round || !player || busy} onClick={copy}>{t("pb.copyUtility")}</button>
    {message && <span className={failed ? "error" : "muted small"}>{message}</span>}
  </div>{!rounds.length && <p className="muted small">{t("pb.attachRoundFirst")}</p>}</div>;
}

function AttachmentForm({ onAdd }: { onAdd: (a: PlaybookAttachment) => void }) {
  const [kind, setKind] = useState<PlaybookAttachment["kind"]>("round");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [match, setMatch] = useState("");
  const [rnd, setRnd] = useState(1);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [lists, setLists] = useState<Playlist[]>([]);
  const [matches, setMatches] = useState<LibraryMatch[]>([]);
  const [overview, setOverview] = useState<MatchOverview | null>(null);
  const [recordings, setRecordings] = useState<string[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api.boards().then(setBoards).catch((e: Error) => setError(e.message));
    api.playlists().then(setLists).catch((e: Error) => setError(e.message));
    api.library().then((l) => setMatches(l.matches)).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    let active = true; setOverview(null); setRecordings([]); setError("");
    if (match) {
      api.match(match).then((m) => { if (active) { setOverview(m); setRnd(m.timeline[0]?.round ?? 1); } }).catch((e: Error) => { if (active) setError(e.message); });
      if (kind === "recording") api.recordings(match).then((r) => { if (active) setRecordings(r.map((v) => v.file)); }).catch((e: Error) => { if (active) setError(e.message); });
    }
    return () => { active = false; };
  }, [match, kind]);
  const sec = (s: string) => s.trim() ? Number(s.replace(",", ".")) : null;
  const add = () => {
    let a: PlaybookAttachment;
    if (kind === "round") {
      const from = sec(start), to = sec(end);
      if ([from, to].some((v) => v !== null && (!Number.isFinite(v) || v < -60 || v > 600)) || (from !== null && to !== null && to <= from)) { setError(t("pb.badRange")); return; }
      a = { kind, label, match, round: rnd, start: from, end: to, caption: label };
    } else if (kind === "recording") a = { kind, label, match, file: value };
    else if (kind === "playlist") a = { kind, label: label || lists.find((p) => p.id === value)?.name || "", playlist: value };
    else if (kind === "board") a = { kind, label: label || boards.find((b) => b.id === value)?.name || "", board: value };
    else {
      try {
        const u = new URL(value);
        if (u.protocol !== "https:" || !["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "twitch.tv", "www.twitch.tv", "clips.twitch.tv"].includes(u.hostname) || u.username || u.password || (u.port && u.port !== "443")) throw new Error();
      } catch { setError(t("pb.badUrl")); return; }
      a = { kind: "url", label, url: value };
    }
    onAdd(a); setError(""); setLabel(""); setValue("");
  };
  const needsMatch = kind === "round" || kind === "recording";
  return <div className="pb-attach-form"><div className="row">
    <select aria-label={t("pb.attachmentKind")} value={kind} onChange={(e) => { setKind(e.target.value as PlaybookAttachment["kind"]); setValue(""); setError(""); }}>{ATTACHMENTS.map((k) => <option value={k} key={k}>{t(`pb.attachment.${k}`)}</option>)}</select>
    <input aria-label={t("pb.attachmentLabel")} placeholder={t("pb.attachmentLabel")} maxLength={200} value={label} onChange={(e) => setLabel(e.target.value)} />
    {needsMatch && <select aria-label={t("pl.pickMatch")} value={match} onChange={(e) => { setMatch(e.target.value); setValue(""); }}><option value="">{t("pl.pickMatch")}</option>{matches.map((m) => <option key={m.id} value={m.id}>{mapPretty(m.map)} · {m.id}</option>)}</select>}
    {kind === "round" && <>
      <select aria-label={t("pb.sourceRound")} value={rnd} onChange={(e) => setRnd(Number(e.target.value))}>{overview?.timeline.map((r) => <option key={r.round} value={r.round}>{t("pl.round", { round: r.round })}</option>)}</select>
      <input className="sec-input" aria-label={t("pl.from")} placeholder={t("pl.fromStart")} value={start} onChange={(e) => setStart(e.target.value)} />
      <input className="sec-input" aria-label={t("pl.to")} placeholder={t("pl.toEndShort")} value={end} onChange={(e) => setEnd(e.target.value)} />
    </>}
    {kind === "url" ? <input className="grow" aria-label={t("pb.url")} placeholder={t("pb.url")} value={value} maxLength={2000} onChange={(e) => setValue(e.target.value)} /> : kind !== "round" &&
      <select aria-label={t("pb.attachmentValue")} value={value} onChange={(e) => setValue(e.target.value)}><option value="">{t("pb.attachmentValue")}</option>
        {kind === "board" ? boards.map((b) => <option value={b.id} key={b.id}>{b.name} · {mapPretty(b.map)}</option>) : kind === "playlist" ? lists.map((p) => <option value={p.id} key={p.id}>{p.name}</option>) : recordings.map((r) => <option key={r}>{r}</option>)}
      </select>}
    <button disabled={kind === "round" ? !overview : !value.trim() || (needsMatch && !match)} onClick={add}>{t("pb.addAttachment")}</button>
  </div>{error && <p className="error">{error}</p>}</div>;
}
