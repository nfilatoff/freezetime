import { useEffect, useState } from "react";
import { api, type LibraryMatch, type PlaybookBook, type ScoutReport, type Strat } from "../api";
import { t } from "../i18n";
import { nadeLabel } from "./InsightCards";
import { useSession } from "../session";

/** Keep the detector's site/core and its example rounds when adopting a found strategy. */
export function AddToPlaybook({ strategy, map, team }: { strategy: Strat; map: string; team: string }) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(t("scout.stratTitle", { id: strategy.id, site: strategy.site }));
  const [books, setBooks] = useState<PlaybookBook[]>([]);
  const [book, setBook] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) api.playbook().then((d) => setBooks(d.books)).catch((e: Error) => setError(e.message));
  }, [open]);
  if (!session?.can_edit) return null;
  const save = async () => {
    setBusy(true); setError("");
    try {
      let entryId = saved;
      if (!entryId) {
        const entry = await api.savePlaybookEntry({
          name, kind: "strategy", map, side: "terrorist", category: "", pinned: false, steps: [], tasks: {},
          description: t("pb.importDescription", { team, site: strategy.site, core: strategy.core.map((c) => `${nadeLabel(c.type)} ${c.zone}`).join(", ") || t("scout.noSmokes") }),
          attachments: strategy.examples.map((r) => ({ kind: "round", label: `${r.match} · ${t("pl.round", { round: r.round })}`, match: r.match, round: r.round, start: r.sec, end: null, caption: "" })),
          detector: { site: strategy.site, core: strategy.core.map(({ type, zone }) => ({ type, zone })) },
        });
        entryId = entry.id; setSaved(entryId);
      }
      if (book) {
        const current = (await api.playbook()).books.find((b) => b.id === book);
        if (!current) throw new Error(t("pb.notFound"));
        if (!current.entries.includes(entryId)) await api.savePlaybookBook({ ...current, entries: [...current.entries, entryId] }, current.id);
      }
      setDone(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <div className="pb-adopt">
    {done ? <a href={`#/playbook/${saved}`}>{t("pb.imported")}</a> : !open ? <button className="small-btn" onClick={() => setOpen(true)}>{t("pb.adopt")}</button> :
      <div className="row"><input aria-label={t("pb.name")} value={name} maxLength={120} disabled={busy || !!saved} onChange={(e) => setName(e.target.value)} />
        <select aria-label={t("pb.books")} value={book} disabled={busy} onChange={(e) => setBook(e.target.value)}><option value="">{t("pb.all")}</option>{books.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <button disabled={busy || !name.trim()} onClick={save}>{t("common.save")}</button>
        <button disabled={busy} onClick={() => setOpen(false)}>{t("common.cancel")}</button>
      </div>}
    {error && <p className="error">{error}</p>}
  </div>;
}

export function FoundStrategies({ matches, aliases }: { matches: LibraryMatch[]; aliases: Record<string, string> }) {
  const [team, setTeam] = useState("");
  const [map, setMap] = useState("");
  const [found, setFound] = useState<ScoutReport["playbook"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selection = JSON.stringify([matches.map((m) => m.id), aliases, team, map]);
  useEffect(() => { setFound(null); }, [selection]);
  const teams = [...new Set(matches.flatMap((m) => Object.keys(m.score ?? {}).map((n) => aliases[n] ?? n)))].sort();
  const maps = [...new Set(matches.map((m) => m.map))].sort();
  const discover = async () => {
    setBusy(true); setError(""); setFound(null);
    try { setFound(await api.discoverStrategies(matches.map((m) => m.id), team, map, aliases)); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <section className="pb-discover"><h2>{t("pb.foundTitle")}</h2><p className="muted small">{t("pb.foundHint")}</p>
    <div className="row"><select aria-label={t("team.name")} value={team} disabled={busy} onChange={(e) => setTeam(e.target.value)}><option value="">{t("team.name")}</option>{teams.map((n) => <option key={n}>{n}</option>)}</select>
      <select aria-label={t("pb.map")} value={map} disabled={busy} onChange={(e) => setMap(e.target.value)}><option value="">{t("pb.map")}</option>{maps.map((n) => <option key={n}>{n}</option>)}</select>
      <button disabled={!team || !map || !matches.length || busy || !teams.includes(team) || !maps.includes(map)} onClick={discover}>{t("pb.findStrategies")}</button></div>
    {error && <p className="error">{error}</p>}
    {found && !found.strats.length && <p className="muted">{t("scout.noStrats")}</p>}
    {found?.strats.map((s) => <article key={s.id} className="pb-card"><h3>{t("scout.stratTitle", { id: s.id, site: s.site })}</h3>
      <p>{t("scout.stratLine", { n: s.rounds, share: s.share_pct, win: s.win_pct })}</p>
      <p>{s.core.map((c) => `${nadeLabel(c.type)} ${c.zone}`).join(" · ") || t("scout.noSmokes")}</p>
      <AddToPlaybook strategy={s} map={map} team={team} />
    </article>)}
  </section>;
}
