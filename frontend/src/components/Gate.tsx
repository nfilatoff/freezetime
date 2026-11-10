// What a visitor sees before the team server lets them in: why, and the roster to pick a nick from.
import { useState } from "react";
import { api, type Session } from "../api";
import { t, type Key } from "../i18n";
import { setSession } from "../session";
import { IconLogo } from "./Icons";

export function Gate({ session, joinFailed }: { session: Session; joinFailed: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const pick = (id: string) => api.login({ member: id }).then(setSession).catch((e: Error) => setError(e.message));
  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-logo"><IconLogo /></div>
        <h1>{session.team || "Freezetime"}</h1>
        {session.need === "team_mode" ? (
          <p>{t("gate.teamMode")} <code>freezetime app --team</code></p>
        ) : session.need === "token" ? (
          <p>{t(joinFailed ? "gate.badToken" : "gate.needToken")}</p>
        ) : (
          <>
            <p>{t("gate.pick")}</p>
            {session.members.length === 0 ? (
              <p className="muted">{t("gate.noMembers")}</p>
            ) : (
              <div className="gate-members">
                {session.members.map((m) => (
                  <button key={m.id} onClick={() => pick(m.id)}>
                    <b>{m.nick}</b>
                    {m.role && <span className="muted small">{t(`team.role.${m.role}` as Key)}</span>}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
