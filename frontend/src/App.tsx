import { useEffect, useState } from "react";
import { api } from "./api";
import { hashParts } from "./router";
import { refreshSession, setSession, useSession } from "./session";
import { Gate } from "./components/Gate";
import { LibraryPage } from "./pages/Library";
import { MatchPage } from "./pages/Match";
import { AggregatePage } from "./pages/Aggregate";
import { HighlightsPage } from "./pages/Highlights";
import { CalloutsPage } from "./pages/Callouts";
import { ScoutPage } from "./pages/Scout";
import { BoardPage } from "./pages/Board";
import { TeamPage } from "./pages/Team";
import { NotesPage } from "./pages/Notes";
import { PlaylistPlayer, PlaylistsPage } from "./pages/Playlists";
import { ClipView } from "./components/ClipView";
import { LineupsView } from "./components/LineupsView";
import { IconBoard, IconLibrary, IconLogo, IconMap, IconScout, IconNote, IconPlaylist, IconStar, IconTeam, IconUs } from "./components/Icons";
import { LANGS, detectSystemLang, setLang, t, useLang, type Key, type Lang } from "./i18n";

function useHash(): string[] {
  const [parts, setParts] = useState(hashParts);
  useEffect(() => {
    const on = () => setParts(hashParts());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return parts;
}

export function App() {
  const [page, ...rest] = useHash();
  const lang = useLang();
  useEffect(() => detectSystemLang(() => api.system().then((s) => s.locale)), []);
  const session = useSession();
  const [joinFailed, setJoinFailed] = useState(false);
  useEffect(() => {
    // a join link carries the team token in the fragment: trade it for a cookie and drop it from the address
    const [first, token] = hashParts();
    if (first !== "join" || !token) {
      refreshSession().catch(() => {});
      return;
    }
    api.login({ token }).then(setSession).catch(() => {
      setJoinFailed(true);
      return refreshSession().catch(() => {});
    }).finally(() => {
      window.history.replaceState(null, "", "#/");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
  }, []);
  const [own, setOwn] = useState<string | null>(null);
  const allowed = !!session && !session.need;
  useEffect(() => {
    if (allowed) api.teams().then((d) => setOwn(d.own)).catch(() => {});
  }, [allowed]);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!allowed) return;
    const check = () => api.notes({ mine: true }).then((d) => setUnread(d.unread)).catch(() => {});
    check();
    const timer = setInterval(check, 60_000); // teammates write from their own computers
    window.addEventListener("freezetime:notes", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("freezetime:notes", check);
    };
  }, [allowed, session?.member?.id]);
  const us = own ? `scout/${encodeURIComponent(own)}` : null;
  const nav: [string, Key, typeof IconLibrary][] = [
    ["", "nav.library", IconLibrary],
    ["scout", "nav.scout", IconScout],
    ...(us ? [[us, "nav.us", IconUs] as [string, Key, typeof IconLibrary]] : []),
    ["team", "nav.team", IconTeam],
    ["board", "nav.board", IconBoard],
    ["notes", "nav.notes", IconNote],
    ["playlists", "nav.playlists", IconPlaylist],
    ["highlights", "nav.highlights", IconStar],
    ["callouts", "nav.callouts", IconMap],
  ];
  // the old pages stay reachable from the scout page: they live under it
  const active = page === "match" ? ""
    : page === "scout" && own && rest[0] === own ? us ?? ""
    : page === "aggregate" || page === "clip" || page === "lineups" ? "scout"
    : page === "playlist" ? "playlists"
    : page ?? "";
  if (!session) return null;
  if (session.need) return <Gate session={session} joinFailed={joinFailed} />;
  return (
    <div className={`shell ${session.local ? "" : "no-local"} ${session.can_edit ? "" : "no-edit"}`}>
      <aside className="sidebar">
        <a className="logo" href="#/" title="Freezetime">
          <IconLogo />
        </a>
        <nav>
          {nav.map(([key, label, Icon]) => (
            <a key={key} href={`#/${key}`} className={`navitem ${active === key ? "active" : ""}`}>
              <Icon />
              {t(label)}
              {key === "notes" && unread > 0 && <span className="nav-badge" title={t("notes.unread", { n: unread })}>{unread}</span>}
            </a>
          ))}
        </nav>
        {session.member && <a className="whoami" href="#/team" title={t("team.you")}>{session.member.nick}</a>}
        <LangSwitch lang={lang} />
      </aside>
      <div className="content">
        <header className="topbar">
          <a className="wordmark" href="#/">
            FREEZE<b>TIME</b>
            <small>{t("app.tagline")}</small>
          </a>
        </header>
        {/* Pages are remounted on a language change: canvases and memoized texts are drawn in the language */}
        <main key={lang}>
          {page === "match" && rest[0] ? (
            <MatchPage id={rest[0]} tab={rest[1] ?? "overview"} round={rest[2] ? Number(rest[2]) : undefined} at={rest[3] ? Number(rest[3]) : undefined} />
          ) : page === "board" ? (
            <BoardPage id={rest[0]} />
          ) : page === "notes" ? (
            <NotesPage tab={rest[0]} />
          ) : page === "playlists" ? (
            <PlaylistsPage id={rest[0]} />
          ) : page === "playlist" && rest[0] ? (
            <PlaylistPlayer id={rest[0]} index={Number(rest[1] ?? 0)} />
          ) : page === "team" ? (
            <TeamPage onOwn={setOwn} />
          ) : page === "callouts" ? (
            <CalloutsPage map={rest[0]} />
          ) : page === "scout" ? (
            <ScoutPage team={rest[0]} map={rest[1]} tab={rest[2] ?? "summary"} onOwn={setOwn} />
          ) : page === "aggregate" ? (
            <AggregatePage />
          ) : page === "clip" ? (
            <div className="page">
              <div className="pagehead"><h1>{t("clips.title")}</h1><div className="sub">{t("clips.sub")}</div></div>
              <ClipView />
            </div>
          ) : page === "lineups" ? (
            <div className="page">
              <div className="pagehead"><h1>{t("lineups.title")}</h1><div className="sub">{t("lineups.sub")}</div></div>
              <LineupsView />
            </div>
          ) : page === "highlights" ? (
            <HighlightsPage id={rest[0]} />
          ) : (
            <LibraryPage />
          )}
        </main>
      </div>
    </div>
  );
}

function LangSwitch({ lang }: { lang: Lang }) {
  return (
    <label className="lang" title={t("lang.label")}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
      </svg>
      <span>{lang.toUpperCase()}</span>
      {/* the native select is invisible on top of the label, so the narrow sidebar shows just the code */}
      <select value={lang} aria-label={t("lang.label")} onChange={(e) => setLang(e.target.value as Lang)}>
        {LANGS.map(([code, name]) => <option key={code} value={code}>{code.toUpperCase()} · {name}</option>)}
      </select>
    </label>
  );
}
