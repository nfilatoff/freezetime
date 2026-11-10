// Links to a place in the app and the clipboard.

/** A link to a place in the app, e.g. a replay moment or a board. */
export const shareUrl = (...parts: (string | number)[]) =>
  `${window.location.origin}/#/${parts.map((p) => encodeURIComponent(String(p))).join("/")}`;

/** Put text on the clipboard; false when the browser does not allow it (the caller then shows the text). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
