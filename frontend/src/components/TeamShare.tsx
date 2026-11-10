// The Team page below the roster: who I am, the team server's join links, and packs (.zip).
import { useEffect, useRef, useState } from "react";
import { api, type LibraryMatch, type PackResult } from "../api";
import { download } from "../clipExport";
import { t, type Key } from "../i18n";
import { copyText, joinUrl, setSession, useSession } from "../session";
import { mapPretty } from "./MatchPicker";

export function WhoAmI() {
  const session = useSession();
  if (!session || session.members.length === 0) return null;
  const choose = (id: string) => api.login({ member: id }).then(setSession).catch(() => {});
  return (
    <label className="team-name">
      <span>{t("team.you")}</span>
      <select value={session.member?.id ?? ""} onChange={(e) => choose(e.target.value)}>
        {(session.local || !session.member) && <option value="">{t("team.youNone")}</option>}
        {session.members.map((m) => <option key={m.id} value={m.id}>{m.nick}</option>)}
      </select>
      <span className="muted small">{t("team.youHint")}</span>
    </label>
  );
}

export function TeamServer() {
  const session = useSession();
  const [copied, setCopied] = useState<string | null>(null);
  if (!session?.local) return null;
  const share = session.share;
  const copy = async (url: string) => setCopied((await copyText(url)) ? url : null);
  return (
    <>
      <h3>{t("team.server")}</h3>
      {!share ? (
        <div className="muted">{t("team.serverOff")} <code>freezetime app --team</code></div>
      ) : (
        <>
          <div className="muted small">{t("team.serverOn")}</div>
          {share.addresses.length === 0 && <div className="warn">{t("team.noAddress")}</div>}
          {share.addresses.map((ip) => {
            const url = joinUrl(ip, share.token);
            return (
              <div className="row" key={ip}>
                <input className="grow mono" readOnly value={url} onFocus={(e) => e.target.select()} />
                <button onClick={() => copy(url)}>{copied === url ? t("team.copied") : t("team.copyLink")}</button>
              </div>
            );
          })}
          <div className="row">
            <button className="small-btn" onClick={() => window.confirm(t("team.newTokenConfirm")) && api.newToken().then(setSession).catch(() => {})}>
              {t("team.newToken")}
            </button>
            <span className="muted small">{t("team.serverRules")}</span>
          </div>
        </>
      )}
    </>
  );
}

export function Packs({ extra }: { extra?: { key: "notes" | "playlists"; label: Key }[] }) {
  const session = useSession();
  const [matches, setMatches] = useState<LibraryMatch[]>([]);
  const [boards, setBoards] = useState(0);
  const [what, setWhat] = useState<Record<string, boolean>>({ boards: true, team: true, notes: true, playlists: true });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const reload = () => {
    api.library().then((l) => setMatches(l.matches)).catch(() => {});
    api.boards().then((b) => setBoards(b.length)).catch(() => {});
  };
  useEffect(reload, []);

  const run = (work: Promise<string>) => {
    setBusy(true);
    setMsg(null);
    work.then((text) => setMsg({ text }), (e: Error) => setMsg({ text: e.message, error: true })).finally(() => setBusy(false));
  };
  const exportPack = () => run(
    api.packExport({ boards: what.boards ? null : [], team: what.team, matches: [...picked], ...Object.fromEntries((extra ?? []).map((x) => [x.key, what[x.key]])) })
      .then(({ blob, name }) => {
        download(blob, name);
        return t("pack.exported", { name });
      }),
  );
  const importPack = (f: File) => run(
    api.packImport(f).then((r: PackResult) => {
      reload();
      window.dispatchEvent(new Event("freezetime:session"));
      const sum = (k: "added" | "updated" | "skipped") => r.boards[k] + (r.notes?.[k] ?? 0) + (r.playlists?.[k] ?? 0);
      return t("pack.result", {
        added: sum("added"), updated: sum("updated"), skipped: sum("skipped"),
        matches: r.matches.added.length, matchesSkipped: r.matches.skipped.length, team: t(`pack.team.${r.team ?? "none"}` as Key),
      });
    }),
  );
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (!next.delete(id)) next.add(id);
    setPicked(next);
  };
  const check = (key: string, label: string) => (
    <label key={key} className="small"><input type="checkbox" checked={what[key]} onChange={(e) => setWhat({ ...what, [key]: e.target.checked })} /> {label}</label>
  );

  return (
    <>
      <h3>{t("pack.title")}</h3>
      <div className="muted small">{t("pack.sub")}</div>
      <div className="row">
        {check("boards", t("pack.boards", { n: boards }))}
        {check("team", t("pack.teamProfile"))}
        {(extra ?? []).map((x) => check(x.key, t(x.label)))}
      </div>
      {matches.length > 0 && (
        <details className="pack-matches">
          <summary>{t("pack.matches")}{picked.size > 0 ? ` · ${picked.size}` : ""}</summary>
          {matches.map((m) => (
            <label key={m.id} className="small">
              <input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m.id)} />{" "}
              {mapPretty(m.map)} · {Object.entries(m.score ?? {}).map(([name, s]) => `${name} ${s}`).join(" : ") || m.id}
            </label>
          ))}
        </details>
      )}
      <div className="row">
        <button disabled={busy} onClick={exportPack}>{t("pack.export")}</button>
        {session?.can_edit && (
          <>
            <button disabled={busy} onClick={() => file.current?.click()}>{t("pack.import")}</button>
            <input ref={file} type="file" accept=".zip,application/zip" hidden onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) importPack(f);
            }} />
          </>
        )}
        {msg && <span className={msg.error ? "error" : "muted small"}>{msg.text}</span>}
      </div>
    </>
  );
}
