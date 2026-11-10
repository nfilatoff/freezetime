// A player's detail on the match's Players tab: kills by weapon, accuracy and flashes
// (GET /api/matches/<id>/player-stats, freezetime/player_stats.py).
import { useEffect, useState } from "react";
import { api, type PlayerStats, type Row } from "../api";
import { t } from "../i18n";
import { DataTable } from "./DataTable";

const NAMES: Record<string, string> = {
  m4a1_silencer: "M4A1-S", m4a1: "M4A4", usp_silencer: "USP-S", hkp2000: "P2000", ak47: "AK-47", awp: "AWP", ssg08: "SSG 08",
  deagle: "Desert Eagle", revolver: "R8", glock: "Glock-18", p250: "P250", cz75a: "CZ75-Auto", fiveseven: "Five-SeveN", tec9: "Tec-9",
  elite: "Dual Berettas", galilar: "Galil AR", famas: "FAMAS", sg556: "SG 553", aug: "AUG", mp9: "MP9", mac10: "MAC-10", mp7: "MP7",
  mp5sd: "MP5-SD", ump45: "UMP-45", p90: "P90", bizon: "PP-Bizon", nova: "Nova", xm1014: "XM1014", mag7: "MAG-7", sawedoff: "Sawed-Off",
  negev: "Negev", m249: "M249", g3sg1: "G3SG1", scar20: "SCAR-20", hegrenade: "HE", inferno: "Molotov", taser: "Zeus",
};
export const weaponName = (w: string) => NAMES[w] ?? (w.startsWith("knife") || w === "bayonet" ? t("ps.knife") : w);

const sec = (v: number | null) => (v == null ? "—" : `${v.toFixed(2)} ${t("ps.sec")}`);

let cache: { id: string; data: Promise<Record<string, PlayerStats>> } | null = null;
const load = (id: string) => {
  if (cache?.id !== id) {
    cache = { id, data: api.playerStats(id) };
    cache.data.catch(() => (cache = null));
  }
  return cache.data;
};

export function PlayerStatsPanel({ matchId, player, onClose }: { matchId: string; player: Row; onClose: () => void }) {
  const [all, setAll] = useState<Record<string, PlayerStats> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    load(matchId).then(setAll).catch((e: Error) => setError(e.message));
  }, [matchId]);
  const s = all?.[String(player.steamid)];
  return (
    <div className="ps-panel">
      <div className="row">
        <h3>{t("ps.title", { name: String(player.name ?? "") })}</h3>
        <span className="grow" />
        <button className="small-btn" onClick={onClose}>{t("common.close")}</button>
      </div>
      {error && <div className="error">{error}</div>}
      {!all && !error && <div className="muted">{t("common.loading")}</div>}
      {all && !s && <div className="muted">{t("table.noData")}</div>}
      {s && (
        <>
          <div className="ps-cards">
            <Card label={t("ps.accuracy")} value={s.accuracy.accuracy == null ? "—" : `${s.accuracy.accuracy}%`}
              note={t("ps.hitsOf", { hits: s.accuracy.hits, shots: s.accuracy.shots })} />
            <Card label={t("ps.headHits")} value={s.accuracy.hs_accuracy == null ? "—" : `${s.accuracy.hs_accuracy}%`}
              note={t("ps.headOf", { n: s.accuracy.head_hits, hits: s.accuracy.hits })} />
            <Card label={t("ps.blindAvg")} value={sec(s.flashes.enemy_blind_avg)}
              note={t("ps.blinded", { n: s.flashes.enemies_blinded, thrown: s.flashes.thrown, long: s.flashes.enemies_long })} />
            <Card label={t("ps.blindTotal")} value={`${s.flashes.enemy_blind_total.toFixed(1)} ${t("ps.sec")}`}
              note={t("ps.teamBlinded", { n: s.flashes.teammates_blinded, avg: sec(s.flashes.teammate_blind_avg) })} />
          </div>
          <DataTable
            title={t("ps.weapons")}
            rows={s.weapons.map((w) => ({ ...w, weapon: weaponName(w.weapon) }))}
            columns={["weapon", "kills", "headshots", "shots", "hits", "accuracy", "head_hits", "hs_accuracy", "damage"]}
          />
          <div className="muted small">{t("ps.note")}</div>
        </>
      )}
    </div>
  );
}

function Card({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="insight">
      <div className="insight-label">{label}</div>
      <div className="ps-value">{value}</div>
      <div className="muted small">{note}</div>
    </div>
  );
}
