// Every note of every match: all of them, or the ones that mention me (with an unread count).
import { useEffect, useMemo, useState } from "react";
import { api, type LibraryMatch, type Note, type NoteList } from "../api";
import { mapPretty } from "../components/MatchPicker";
import { noteAuthor, secLabel } from "../components/ReplayExtras";
import { t } from "../i18n";
import { go } from "../router";
import { useSession } from "../session";

/** Tell the menu badge that the unread count changed. */
export const notesChanged = () => window.dispatchEvent(new Event("freezetime:notes"));

export function NotesPage({ tab }: { tab?: string }) {
  const session = useSession();
  const mine = tab === "me";
  const [data, setData] = useState<NoteList | null>(null);
  const [matches, setMatches] = useState<Map<string, LibraryMatch>>(new Map());
  const [sort, setSort] = useState<"date" | "round">("date");
  const [match, setMatch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const load = () => api.notes({ mine }).then(setData).catch((e: Error) => setError(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine]);
  useEffect(() => {
    api.library().then((l) => setMatches(new Map(l.matches.map((m) => [m.id, m])))).catch(() => {});
  }, []);

  const me = data?.me ?? null;
  const unread = (n: Note) => !!me && n.mentions.includes(me) && !n.read_by.includes(me);
  const shown = useMemo(() => {
    const list = (data?.notes ?? []).filter((n) => !match || n.match === match);
    return sort === "date" ? list : [...list].sort((a, b) => a.match.localeCompare(b.match) || a.round - b.round || a.sec - b.sec);
  }, [data, match, sort]);
  const matchName = (id: string) => {
    const m = matches.get(id);
    return m ? `${mapPretty(m.map)} · ${Object.keys(m.score ?? {}).join(" vs ") || id}` : id;
  };
  const open = (n: Note) => {
    if (unread(n)) api.readNotes([n.id]).then(notesChanged).catch(() => {});
    go("match", n.match, "replay", n.round, n.sec);
  };
  const readAll = () => {
    const ids = shown.filter(unread).map((n) => n.id);
    if (ids.length) api.readNotes(ids).then(() => { notesChanged(); load(); }).catch(() => {});
  };
  const canChange = (n: Note) => !!session?.can_edit || (!!session?.member && n.author === session.member.id);
  const saveEdit = () => {
    if (!editing) return;
    api.editNote(editing.id, editing.text).then(() => { setEditing(null); load(); }).catch((e: Error) => setError(e.message));
  };
  const matchIds = [...new Set((data?.notes ?? []).map((n) => n.match))];

  return (
    <div className="page notes-page">
      <div className="pagehead"><h1>{t("notes.title")}</h1><div className="sub">{t("notes.sub")}</div></div>
      <div className="row">
        <span className="seg">
          <button className={mine ? "" : "on"} onClick={() => go("notes")}>{t("notes.all")}</button>
          <button className={mine ? "on" : ""} disabled={!session?.member} title={session?.member ? undefined : t("notes.pickYou")} onClick={() => go("notes", "me")}>
            {t("notes.forMe")}{data && data.unread > 0 ? ` (${data.unread})` : ""}
          </button>
        </span>
        <select value={sort} onChange={(e) => setSort(e.target.value as "date" | "round")}>
          <option value="date">{t("notes.byDate")}</option>
          <option value="round">{t("notes.byRound")}</option>
        </select>
        <select value={match} onChange={(e) => setMatch(e.target.value)}>
          <option value="">{t("notes.allMatches")}</option>
          {matchIds.map((id) => <option key={id} value={id}>{matchName(id)}</option>)}
        </select>
        <span className="grow" />
        {mine && shown.some(unread) && <button onClick={readAll}>{t("notes.readAll")}</button>}
      </div>
      {!session?.member && <div className="muted small">{t("notes.pickYou")} <a href="#/team">{t("nav.team")}</a></div>}
      {error && <div className="error">{error}</div>}
      {data && shown.length === 0 && <div className="muted">{mine ? t("notes.noneForMe") : t("notes.none")}</div>}
      <div className="note-list">
        {shown.map((n) => (
          <div key={n.id} className={`note-card ${unread(n) ? "unread" : ""}`}>
            <div className="note-head">
              <b>{noteAuthor(n)}</b>
              <button className="link small" onClick={() => open(n)}>{t("notes.where", { round: n.round, time: secLabel(n.sec) })}</button>
              <span className="muted small">{matchName(n.match)}</span>
              <span className="grow" />
              <span className="muted small">{new Date(n.created * 1000).toLocaleString()}</span>
            </div>
            {editing?.id === n.id ? (
              <div>
                <textarea rows={2} className="wide" value={editing.text} maxLength={2000} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
                <div className="row">
                  <button className="primary small-btn" onClick={saveEdit}>{t("common.save")}</button>
                  <button className="small-btn" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
                </div>
              </div>
            ) : (
              <div className="note-text">{n.text}</div>
            )}
            {canChange(n) && editing?.id !== n.id && (
              <div className="row small">
                <button className="link small" onClick={() => setEditing({ id: n.id, text: n.text })}>{t("notes.edit")}</button>
                <button className="link small" onClick={() => window.confirm(t("notes.deleteConfirm")) && api.deleteNote(n.id).then(() => { notesChanged(); load(); }).catch(() => {})}>
                  {t("common.deleteLower")}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
