// Packs (.zip): boards, notes, playlists, the playbook and parsed matches, to carry to another computer.
import { useEffect, useRef, useState } from "react";
import { api, type LibraryMatch, type PackResult } from "../api";
import { download } from "../clipExport";
import { t, type Key } from "../i18n";
import { mapPretty } from "./MatchPicker";

const PARTS: { key: "notes" | "playlists" | "playbook"; label: Key }[] = [
  { key: "notes", label: "pack.notes" }, { key: "playlists", label: "pack.playlists" }, { key: "playbook", label: "pack.playbook" },
];

export function Packs() {
  const [matches, setMatches] = useState<LibraryMatch[]>([]);
  const [boards, setBoards] = useState(0);
  const [what, setWhat] = useState<Record<string, boolean>>({ boards: true, notes: true, playlists: true, playbook: true });
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
    api.packExport({ boards: what.boards ? null : [], matches: [...picked], ...Object.fromEntries(PARTS.map((x) => [x.key, what[x.key]])) })
      .then(({ blob, name }) => {
        download(blob, name);
        return t("pack.exported", { name });
      }),
  );
  const importPack = (f: File) => run(
    api.packImport(f).then((r: PackResult) => {
      reload();
      const sum = (k: "added" | "updated" | "skipped") => r.boards[k] + (r.notes?.[k] ?? 0) + (r.playlists?.[k] ?? 0) + (r.playbook?.[k] ?? 0);
      const text = t("pack.result", {
        added: sum("added"), updated: sum("updated"), skipped: sum("skipped"),
        matches: r.matches.added.length, matchesSkipped: r.matches.skipped.length,
      });
      return r.team ? `${text} ${t("pack.teamSkipped")}` : text;
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
        {PARTS.map((x) => check(x.key, t(x.label)))}
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
        <button disabled={busy} onClick={() => file.current?.click()}>{t("pack.import")}</button>
        <input ref={file} type="file" accept=".zip,application/zip" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) importPack(f);
        }} />
        {msg && <span className={msg.error ? "error" : "muted small"}>{msg.text}</span>}
      </div>
    </>
  );
}
