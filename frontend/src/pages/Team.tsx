// Our team's profile: the name and the roster (nick, SteamID, role). Players of our demos who are
// not on the roster yet are offered below it, so a roster is a few clicks rather than typing ids.
import { useEffect, useRef, useState } from "react";
import { api, type TeamCandidate, type TeamInfo, type TeamMember } from "../api";
import { t, type Key } from "../i18n";
import { Packs, TeamServer, WhoAmI } from "../components/TeamShare";
import { useSession } from "../session";

const MAX_MEMBERS = 20;
const roleLabel = (role: string) => t(`team.role.${role}` as Key);
const draftId = () => Math.random().toString(16).slice(2, 10).padEnd(8, "0");

export function TeamPage({ onOwn }: { onOwn: (own: string | null) => void }) {
  const [info, setInfo] = useState<TeamInfo | null>(null);
  const [name, setName] = useState("");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [known, setKnown] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = useRef("");
  const session = useSession();
  const canEdit = !!session?.can_edit;

  const snapshot = (n: string, m: TeamMember[]) => JSON.stringify([n.trim(), m.map((x) => [x.id, x.nick.trim(), x.steamid.trim(), x.role])]);
  const show = (d: TeamInfo) => {
    setInfo(d);
    setName(d.team.name);
    setMembers(d.team.members);
    saved.current = snapshot(d.team.name, d.team.members);
  };
  useEffect(() => {
    api.team().then(show).catch((e: Error) => setMsg({ text: e.message, error: true }));
    api.teams().then((d) => setKnown(d.teams.map((x) => x.name))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!info) return <div className="page">{msg ? <div className="error">{msg.text}</div> : t("common.loading")}</div>;

  const dirty = snapshot(name, members) !== saved.current;
  const full = members.length >= MAX_MEMBERS;
  const edit = (id: string, patch: Partial<TeamMember>) => {
    setMsg(null);
    setMembers(members.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };
  const add = (c?: TeamCandidate) => {
    setMsg(null);
    setMembers([...members, { id: draftId(), nick: c?.nick.slice(0, 32) ?? "", steamid: c?.steamid ?? "", role: "" }]);
  };
  const listed = new Set(members.map((m) => m.steamid).filter(Boolean));
  const candidates = info.candidates.filter((c) => !listed.has(c.steamid));

  const save = () => {
    setBusy(true);
    api.saveTeam({ ...info.team, name, members })
      .then((d) => {
        show(d);
        window.dispatchEvent(new Event("freezetime:session")); // the roster to pick "who am I" from changed
        onOwn(d.team.name || null);
        setMsg({ text: t("team.saved") });
      })
      .catch((e: Error) => setMsg({ text: e.message, error: true }))
      .finally(() => setBusy(false));
  };

  return (
    <div className="page team-page">
      <div className="pagehead"><h1>{t("team.title")}</h1><div className="sub">{t("team.sub")}</div></div>

      <WhoAmI />
      <fieldset className="plain" disabled={!canEdit}>
      <label className="team-name">
        <span>{t("team.name")}</span>
        <input value={name} maxLength={60} list="team-known" placeholder={t("team.namePlaceholder")} onChange={(e) => { setMsg(null); setName(e.target.value); }} />
        <datalist id="team-known">{known.map((n) => <option key={n} value={n} />)}</datalist>
      </label>
      <div className="muted small">{t("team.nameHint")}</div>

      <h3>{t("team.roster")}</h3>
      {members.length === 0 ? (
        <div className="muted">{t("team.empty")}</div>
      ) : (
        <table className="team-roster">
          <thead>
            <tr><th>{t("team.nick")}</th><th>SteamID64</th><th>{t("team.roleCol")}</th><th /></tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td><input value={m.nick} maxLength={32} placeholder={t("team.nick")} onChange={(e) => edit(m.id, { nick: e.target.value })} /></td>
                <td>
                  <input className="mono" value={m.steamid} maxLength={17} inputMode="numeric" placeholder={t("team.steamidPlaceholder")}
                    onChange={(e) => edit(m.id, { steamid: e.target.value.replace(/\D/g, "") })} />
                </td>
                <td>
                  <select value={m.role} onChange={(e) => edit(m.id, { role: e.target.value })}>
                    <option value="">{t("team.role.none")}</option>
                    {info.roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                  </select>
                </td>
                <td>
                  <button className="small-btn" title={t("team.remove", { nick: m.nick })} aria-label={t("team.remove", { nick: m.nick })}
                    onClick={() => { setMsg(null); setMembers(members.filter((x) => x.id !== m.id)); }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row">
        <button disabled={full} onClick={() => add()}>{t("team.add")}</button>
        <button className="primary" disabled={!dirty || busy} onClick={save}>{t("common.save")}</button>
        {msg && <span className={msg.error ? "error" : "muted"}>{msg.text}</span>}
        {dirty && !msg && <span className="muted small">{t("team.unsaved")}</span>}
      </div>

      {candidates.length > 0 && (
        <>
          <h3>{t("team.fromDemos")}</h3>
          <div className="muted small">{t("team.fromDemosHint", { team: info.team.name })}</div>
          <div className="team-candidates">
            {candidates.map((c) => (
              <button key={c.steamid} disabled={full} title={c.steamid} onClick={() => add(c)}>
                + {c.nick} <span className="muted small">{t("scout.matchesCount", { n: c.matches })}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {info.team.name && info.candidates.length === 0 && members.length === 0 && <div className="muted small">{t("team.noDemos")}</div>}
      </fieldset>
      {!canEdit && <div className="muted small">{t("access.staff")}</div>}
      <TeamServer />
      <Packs />
    </div>
  );
}
