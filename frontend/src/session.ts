// Who is using the app: this computer (the analyst), or a teammate let in by the team server.
// The backend decides (freezetime/app/access.py); the page only hides what would be refused.
import { useSyncExternalStore } from "react";
import { api, type Session } from "./api";

let current: Session | null = null;
const listeners = new Set<() => void>();

export const getSession = () => current;
export function setSession(s: Session) {
  current = s;
  listeners.forEach((f) => f());
}
export const refreshSession = () => api.session().then(setSession);
export const useSession = () =>
  useSyncExternalStore((f) => {
    listeners.add(f);
    return () => listeners.delete(f);
  }, getSession);

// a request was refused for want of the token or the nick: look again at who we are
window.addEventListener("freezetime:session", () => {
  refreshSession().catch(() => {});
});

/** The address teammates reach this app by: the team server's LAN address on the analyst's computer, else the page's own. */
export function shareBase(): string {
  const ip = current?.local ? current.share?.addresses[0] : undefined;
  return ip ? `${window.location.protocol}//${ip}${window.location.port ? `:${window.location.port}` : ""}` : window.location.origin;
}

/** A link to a place in the app that a teammate can open. */
export const shareUrl = (...parts: (string | number)[]) => `${shareBase()}/#/${parts.map((p) => encodeURIComponent(String(p))).join("/")}`;

export const joinUrl = (ip: string, token: string) =>
  `${window.location.protocol}//${ip}${window.location.port ? `:${window.location.port}` : ""}/#/join/${token}`;

/** Put text on the clipboard; false when the browser does not allow it (the caller then shows the text). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
