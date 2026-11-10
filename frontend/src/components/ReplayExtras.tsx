// Under the replay: notes of this round (with a form to write one) and "add to a playlist".
import { useEffect, useState } from "react";
import { api, type Note, type Playlist } from "../api";
import { fmtClock } from "../replayDraw";
import { t } from "../i18n";

export const secLabel = (sec: number) => (sec < 0 ? `-${fmtClock(-sec)}` : fmtClock(sec));

/** Notes of one round: a click jumps to the moment. */
export function RoundNotes({ notes, onSeek, onChanged }: { notes: Note[]; onSeek: (sec: number) => void; onChanged: () => void }) {
  if (!notes.length) return null;
  return (
    <div className="round-notes">
      {[...notes].sort((a, b) => a.sec - b.sec).map((n) => (
        <div key={n.id} className="round-note">
          <button className="link mono" onClick={() => onSeek(n.sec)} title={t("notes.jump")}>{secLabel(n.sec)}</button>
          <span className="round-note-text">{n.text}</span>
          <button className="link small" onClick={() => window.confirm(t("notes.deleteConfirm")) && api.deleteNote(n.id).then(onChanged).catch(() => {})}>
            {t("common.deleteLower")}
          </button>
        </div>
      ))}
    </div>
  );
}

/** Write a note at the current second. */
export function NoteForm({ match, round, sec, onDone }: { match: string; round: number; sec: number; onDone: (saved: boolean) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const at = Math.round(sec * 10) / 10;
  const save = () => {
    if (!text.trim()) return;
    api.addNote({ match, round, sec: at, text }).then(() => onDone(true)).catch((e: Error) => setError(e.message));
  };
  return (
    <div className="replay-panel">
      <div className="muted small">{t("notes.at", { round, time: secLabel(at) })}</div>
      <textarea autoFocus rows={2} maxLength={2000} value={text} placeholder={t("notes.placeholder")} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
          else if (e.key === "Escape") onDone(false);
          e.stopPropagation(); // the replay's hotkeys stay out of the text
        }} />
      <div className="row">
        <button className="primary" disabled={!text.trim()} onClick={save}>{t("common.save")}</button>
        <button onClick={() => onDone(false)}>{t("common.cancel")}</button>
        <span className="muted small">Ctrl+Enter</span>
        {error && <span className="error">{error}</span>}
      </div>
    </div>
  );
}

const LAST_PLAYLIST = "freezetime.playlist.last";

/** Add this round (or a stretch of it) to a playlist, new or existing. */
export function StarForm({ match, round, sec, onDone }: { match: string; round: number; sec: number; onDone: (msg: string | null) => void }) {
  const [lists, setLists] = useState<Playlist[] | null>(null);
  const [target, setTarget] = useState("");
  const [name, setName] = useState("");
  const [from, setFrom] = useState(String(Math.max(0, Math.floor(sec - 3))));
  const [to, setTo] = useState("");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.playlists().then((all) => {
      setLists(all);
      let last = "";
      try {
        last = localStorage.getItem(LAST_PLAYLIST) ?? "";
      } catch {
        /* storage blocked */
      }
      setTarget(all.some((p) => p.id === last) ? last : all[0]?.id ?? "new");
    }).catch((e: Error) => setError(e.message));
  }, []);
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
  const save = async () => {
    const item = { match, round, start: num(from), end: num(to), caption };
    if ((item.start !== null && Number.isNaN(item.start)) || (item.end !== null && Number.isNaN(item.end))) return setError(t("pl.badSec"));
    try {
      const pl = target === "new"
        ? await api.createPlaylist({ name: name.trim() || t("pl.untitled"), folder: "", items: [item] })
        : await api.addPlaylistItem(target, item);
      try {
        localStorage.setItem(LAST_PLAYLIST, pl.id);
      } catch {
        /* storage blocked */
      }
      onDone(t("pl.added", { name: pl.name }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (!lists) return <div className="replay-panel">{error ? <span className="error">{error}</span> : t("common.loading")}</div>;
  return (
    <div className="replay-panel" onKeyDown={(e) => e.stopPropagation()}>
      <div className="row">
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          {lists.map((p) => <option key={p.id} value={p.id}>{p.folder ? `${p.folder} / ` : ""}{p.name}</option>)}
          <option value="new">{t("pl.newOne")}</option>
        </select>
        {target === "new" && <input autoFocus placeholder={t("pl.namePlaceholder")} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />}
      </div>
      <div className="row">
        <span className="small">{t("pl.round", { round })}</span>
        <label className="small">{t("pl.from")} <input className="sec-input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="small">{t("pl.to")} <input className="sec-input" value={to} placeholder={t("pl.toEnd")} onChange={(e) => setTo(e.target.value)} /></label>
        <span className="muted small">{t("pl.secHint")}</span>
      </div>
      <input className="wide" placeholder={t("pl.captionPlaceholder")} value={caption} maxLength={200} onChange={(e) => setCaption(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()} />
      <div className="row">
        <button className="primary" onClick={save}>{t("pl.add")}</button>
        <button onClick={() => onDone(null)}>{t("common.cancel")}</button>
        {error && <span className="error">{error}</span>}
      </div>
    </div>
  );
}
