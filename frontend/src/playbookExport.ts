import { strToU8, zipSync } from "fflate";
import { type PlaybookAttachment, type PlaybookEntry, type PlaybookTask, recordingUrl } from "./api";
import { t } from "./i18n";
import { nadeLabel } from "./components/InsightCards";

export function attachmentLink(a: PlaybookAttachment): string {
  if (a.kind === "board") return `${location.origin}/#/board/${a.board}`;
  if (a.kind === "playlist") return `${location.origin}/#/playlist/${a.playlist}/0`;
  if (a.kind === "round") return `${location.origin}/#/match/${encodeURIComponent(a.match)}/replay/${a.round}/${a.start ?? 0}`;
  if (a.kind === "recording") return `${location.origin}${recordingUrl(a.match, a.file)}`;
  return a.url;
}

/** A task's heading: its slot, or "Player N" when the slot was left empty. */
export const slotLabel = (task: PlaybookTask, i: number) => task.slot || t("pb.playerN", { n: i + 1 });

export function playbookText(name: string, entries: PlaybookEntry[], markdown = false): string {
  const lines = [markdown ? `# ${name}` : name, ""];
  for (const e of entries) {
    lines.push(`${markdown ? "## " : ""}${e.name}`, [t(`pb.kind.${e.kind}`), e.map, e.side === "terrorist" ? "T" : e.side === "counter-terrorist" ? "CT" : "", e.category].filter(Boolean).join(" · "), e.description, "");
    e.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    for (const [i, task] of e.tasks.entries()) {
      lines.push("", `${markdown ? "### " : ""}${slotLabel(task, i)}`, task.text);
      for (const u of task.utility) lines.push(`- ${u.label || nadeLabel(u.type)}: ${u.commands}`, `  ${attachmentLink({ kind: "round", label: "", ...u.source })}`);
    }
    for (const a of e.attachments) lines.push(`- ${a.label || t(`pb.attachment.${a.kind}`)}: ${attachmentLink(a)}`);
    lines.push("", "");
  }
  return lines.join("\n");
}

const xml = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A small offline workbook: inline strings preserve nicks and literal console commands. */
export function playbookXlsx(entries: PlaybookEntry[]): Blob {
  const rows = [[t("pb.name"), t("pb.kind"), t("pb.map"), t("pb.side"), t("pb.category"), t("pb.description"), t("pb.steps"), t("pb.tasks"), t("pb.attachments")],
    ...entries.map((e) => [e.name, t(`pb.kind.${e.kind}`), e.map, e.side === "terrorist" ? "T" : e.side === "counter-terrorist" ? "CT" : "", e.category, e.description, e.steps.join("\n"),
      e.tasks.map((task, i) =>
        `${slotLabel(task, i)}: ${task.text}\n${task.utility.map((u) => `${u.label || nadeLabel(u.type)}: ${u.commands}`).join("\n")}`).join("\n\n"),
      e.attachments.map((a) => `${a.label || t(`pb.attachment.${a.kind}`)}: ${attachmentLink(a)}`).join("\n")])];
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const files = {
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(t("pb.title").slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${ns}"><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((s, j) => `<c r="${String.fromCharCode(65 + j)}${i + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(s)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`,
  };
  return new Blob([new Uint8Array(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))))],
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
