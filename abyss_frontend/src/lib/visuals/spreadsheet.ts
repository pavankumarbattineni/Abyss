/**
 * Spreadsheets in answers (the `spreadsheet` visual): one workbook per block,
 * each sheet a tab. The chat previews it (components/visuals/spreadsheet.tsx);
 * the files are made in the browser when asked for -- Excel with every tab,
 * CSV for the tab on view -- so nothing is stored on the server and the data
 * in the saved message can be downloaded again any time.
 *
 * Pure helpers (no React, no DOM), shared by the preview, the downloads and
 * the build check (scripts/check-spreadsheet.mjs).
 */

export const COLUMN_TYPES = ["text", "number", "integer", "currency", "percent", "date", "url"] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];
export type CellValue = string | number | boolean | null;
export type SheetColumn = { label: string; type: ColumnType; currency?: string };
export type Sheet = { name: string; columns: SheetColumn[]; rows: CellValue[][] };

/** Rows a sheet keeps (the spec asks for at most this many). */
export const MAX_ROWS = 500;
export const MAX_SHEETS = 10;

// --- Sheet names (Excel: at most 31 characters, none of []:*?/\, unique) ----

export function excelSheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw, index) => {
    const clean = raw.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || `Sheet ${index + 1}`;
    let name = clean;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      name = clean.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

// --- Cell values by column type ---------------------------------------------

/** A number written with thousands separators, spaces or a % / currency sign -> the number. */
export function asNumber(value: CellValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[,\s%]/g, "").replace(/^[^\d+\-.]+/, "");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** "2026-11-27" (or a full ISO date-time) -> a UTC date; anything else -> null. */
export function asDate(value: CellValue): Date | null {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0));
  return Number.isNaN(date.getTime()) || date.getUTCMonth() !== +m[2] - 1 ? null : date;
}

const CURRENCY_SYMBOLS: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥", AUD: "A$", CAD: "C$", SGD: "S$" };

export function currencySymbol(code?: string): string {
  if (!code) return "";
  return CURRENCY_SYMBOLS[code.toUpperCase()] ?? `${code.toUpperCase()} `;
}

/** How a cell reads in the preview. */
export function displayCell(value: CellValue, column: SheetColumn): string {
  if (value === null || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const n = asNumber(value);
  switch (column.type) {
    case "number":
      return n === null ? String(value) : n.toLocaleString(undefined, { maximumFractionDigits: 6 });
    case "integer":
      return n === null ? String(value) : Math.round(n).toLocaleString();
    case "currency":
      return n === null ? String(value) : `${currencySymbol(column.currency)}${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    case "percent":
      return n === null ? String(value) : `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
    default:
      return String(value);
  }
}

/** The value to sort a column by: numbers and dates by value, the rest as text. */
export function sortKey(value: CellValue, column: SheetColumn): number | string {
  if (value === null || value === "") return "";
  if (["number", "integer", "currency", "percent"].includes(column.type)) return asNumber(value) ?? String(value).toLowerCase();
  if (column.type === "date") return asDate(value)?.getTime() ?? String(value).toLowerCase();
  return String(value).toLowerCase();
}

/** A web link worth making clickable (http/https only). */
export function safeUrl(value: CellValue): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

// --- CSV (the tab on view) --------------------------------------------------

/**
 * One CSV field. Text that a spreadsheet app would run as a formula (starting
 * with = + - @, a tab or a return) gets a leading apostrophe -- the standard
 * defence against CSV injection; real numbers are written as numbers.
 */
export function csvField(value: CellValue, column: SheetColumn): string {
  if (value === null) return "";
  let text: string;
  if (typeof value === "number") text = String(value);
  else if (typeof value === "boolean") text = value ? "TRUE" : "FALSE";
  else {
    const n = ["number", "integer", "currency", "percent"].includes(column.type) ? asNumber(value) : null;
    text = n !== null ? String(n) : /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function sheetToCsv(sheet: Sheet): string {
  const header = sheet.columns.map((c) => csvField(c.label, { label: "", type: "text" })).join(",");
  const rows = sheet.rows.map((row) => sheet.columns.map((c, i) => csvField(row[i] ?? null, c)).join(","));
  // A byte-order mark so Excel opens UTF-8 (₹, accents) correctly.
  return "﻿" + [header, ...rows].join("\r\n");
}

// --- Excel (every tab) ------------------------------------------------------

type XlsxCell = { value?: string | number | boolean | Date; type?: unknown; format?: string; fontWeight?: "bold" } | null;

/** One typed Excel cell. Text is always text (never a formula), so files are safe to open. */
export function xlsxCell(value: CellValue, column: SheetColumn): XlsxCell {
  if (value === null || value === "") return null;
  if (typeof value === "boolean") return { value, type: Boolean };
  const n = asNumber(value);
  switch (column.type) {
    case "number":
      return n === null ? { value: String(value), type: String } : { value: n, type: Number, format: "#,##0.##" };
    case "integer":
      return n === null ? { value: String(value), type: String } : { value: Math.round(n), type: Number, format: "#,##0" };
    case "currency": {
      if (n === null) return { value: String(value), type: String };
      const symbol = currencySymbol(column.currency).replace(/"/g, "");
      return { value: n, type: Number, format: symbol ? `"${symbol}"#,##0.00` : "#,##0.00" };
    }
    case "percent":
      return n === null ? { value: String(value), type: String } : { value: n / 100, type: Number, format: "0.##%" };
    case "date": {
      const date = asDate(value);
      return date ? { value: date, type: Date, format: "yyyy-mm-dd" } : { value: String(value), type: String };
    }
    default:
      return { value: String(value), type: String };
  }
}

/** Column widths (in characters) from the longest value shown, within sensible bounds. */
export function columnWidths(sheet: Sheet): number[] {
  return sheet.columns.map((column, i) => {
    const longest = Math.max(column.label.length, ...sheet.rows.slice(0, 200).map((row) => displayCell(row[i] ?? null, column).length));
    return Math.min(Math.max(longest + 2, 8), 60);
  });
}

/** The workbook as write-excel-file takes it: one entry per tab, header row bold and frozen. */
export function workbookSheets(sheets: Sheet[]) {
  const names = excelSheetNames(sheets.map((s) => s.name));
  return sheets.map((sheet, index) => ({
    sheet: names[index],
    stickyRowsCount: 1,
    columns: columnWidths(sheet).map((width) => ({ width })),
    data: [
      sheet.columns.map((c) => ({ value: c.label, type: String, fontWeight: "bold" as const })),
      ...sheet.rows.map((row) => sheet.columns.map((c, i) => xlsxCell(row[i] ?? null, c))),
    ],
  }));
}

/**
 * A table from an answer (tab-separated, header first) as a sheet, for
 * "Download as Excel": a column whose every value is a number becomes a number
 * column, so Excel gets real numbers; the rest stays text.
 */
export function sheetFromTsv(tsv: string, name = "Table"): Sheet {
  const [header = [], ...body] = tsv.split("\n").map((line) => line.split("\t"));
  const rows: CellValue[][] = body.map((cells) => header.map((_, i) => (cells[i]?.trim() ? cells[i].trim() : null)));
  const columns: SheetColumn[] = header.map((label, i) => {
    const values = rows.map((row) => row[i]).filter((v) => v !== null);
    const numeric = values.length > 0 && values.every((v) => asNumber(v) !== null);
    return { label: label.trim() || `Column ${i + 1}`, type: numeric ? "number" : "text" };
  });
  return { name, columns, rows };
}

/** A file name from the block's name: letters, digits, spaces and dashes only. */
export function fileBase(name: string | undefined): string {
  const base = (name ?? "").replace(/\.(xlsx|csv)$/i, "").replace(/[^\p{L}\p{N} _-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return base || "spreadsheet";
}
