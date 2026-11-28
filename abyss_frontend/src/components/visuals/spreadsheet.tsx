"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, FileSpreadsheet, FileText, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui";
import { downloadBlob } from "@/lib/block-export";
import { cn } from "@/lib/utils";
import type { SpreadsheetData } from "@/lib/visuals/schemas";
import { displayCell, fileBase, safeUrl, sheetToCsv, sortKey, workbookSheets } from "@/lib/visuals/spreadsheet";

const NUMERIC = new Set(["number", "integer", "currency", "percent"]);

/**
 * A spreadsheet in an answer: a workbook whose sheets are tabs. The preview
 * searches and sorts the tab on view; "Excel" downloads one workbook with every
 * tab, "CSV" the tab on view. Both files are made here, in the browser, from the
 * block's own data -- nothing is stored on the server.
 */
export function SpreadsheetVisual({ data }: { data: SpreadsheetData }) {
  const [tab, setTab] = useState(0);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ column: number; desc: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const sheet = data.sheets[Math.min(tab, data.sheets.length - 1)];
  const name = fileBase(data.filename ?? data.title);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const shown = needle
      ? sheet.rows.filter((row) => row.some((cell, i) => displayCell(cell, sheet.columns[i]).toLowerCase().includes(needle)))
      : sheet.rows;
    if (!sort) return shown;
    const column = sheet.columns[sort.column];
    return [...shown].sort((a, b) => {
      const x = sortKey(a[sort.column], column);
      const y = sortKey(b[sort.column], column);
      // Empty cells last, whichever way.
      if (x === "" || y === "") return x === y ? 0 : x === "" ? 1 : -1;
      const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort.desc ? -order : order;
    });
  }, [sheet, query, sort]);

  const selectTab = (index: number) => {
    setTab(index);
    setSort(null);
    setQuery("");
  };

  const downloadExcel = async () => {
    setBusy(true);
    try {
      // The Excel writer loads only when a workbook is asked for.
      const { default: writeXlsxFile } = await import("write-excel-file/browser");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blob = await writeXlsxFile(workbookSheets(data.sheets) as any).toBlob();
      downloadBlob(blob, `${name}.xlsx`);
    } catch {
      toast.error("The Excel file couldn't be created. Try again, or download as CSV.");
    } finally {
      setBusy(false);
    }
  };

  const downloadCsv = () => {
    const suffix = data.sheets.length > 1 ? ` - ${fileBase(sheet.name)}` : "";
    downloadBlob(new Blob([sheetToCsv(sheet)], { type: "text/csv;charset=utf-8" }), `${name}${suffix}.csv`);
  };

  return (
    <div className="flex min-w-0 flex-col gap-3 font-sans text-sm">
      {data.sheets.length > 1 && (
        <div role="tablist" aria-label="Sheets" className="flex gap-1 overflow-x-auto border-b border-border-soft">
          {data.sheets.map((s, index) => (
            <button
              key={s.name}
              type="button"
              role="tab"
              aria-selected={index === tab}
              onClick={() => selectTab(index)}
              className={cn(
                "-mb-px shrink-0 border-b-2 px-3 py-1.5 whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                index === tab ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2" data-export-skip="">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-ring sm:max-w-64">
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search rows"
            aria-label="Search rows"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
        <span className="text-xs text-muted-foreground tabular-nums">
          {rows.length === sheet.rows.length ? `${sheet.rows.length} rows` : `${rows.length} of ${sheet.rows.length} rows`}
        </span>
        <div className="ml-auto flex gap-1.5">
          <Button type="button" size="sm" variant="outline" onClick={downloadExcel} disabled={busy}>
            <FileSpreadsheet className="size-3.5" aria-hidden="true" />
            {busy ? "Preparing…" : "Excel"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={downloadCsv}
            title={data.sheets.length > 1 ? `Download "${sheet.name}" as CSV` : "Download as CSV"}
          >
            <FileText className="size-3.5" aria-hidden="true" />
            CSV
          </Button>
        </div>
      </div>

      <div className="max-h-[28rem] min-w-0 overflow-auto rounded-lg border border-border-soft">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              {sheet.columns.map((column, index) => {
                const active = sort?.column === index;
                const Icon = active ? (sort.desc ? ArrowDown : ArrowUp) : ChevronsUpDown;
                return (
                  <th
                    key={`${column.label}-${index}`}
                    scope="col"
                    aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
                    className="border-b border-border-soft p-0 font-semibold whitespace-nowrap"
                  >
                    <button
                      type="button"
                      onClick={() => setSort(active ? (sort.desc ? null : { column: index, desc: true }) : { column: index, desc: false })}
                      className={cn(
                        "flex w-full items-center gap-1 px-3 py-2 hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none",
                        NUMERIC.has(column.type) && "justify-end",
                      )}
                    >
                      {column.label}
                      <Icon className={cn("size-3 shrink-0", active ? "text-foreground" : "text-muted-foreground/60")} aria-hidden="true" />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-b border-border-soft last:border-0 hover:bg-muted/40">
                {sheet.columns.map((column, c) => {
                  const value = row[c];
                  const url = column.type === "url" ? safeUrl(value) : null;
                  const shown = displayCell(value, column);
                  return (
                    <td
                      key={c}
                      title={shown.length > 40 ? shown : undefined}
                      className={cn("max-w-80 truncate px-3 py-1.5", NUMERIC.has(column.type) && "text-right tabular-nums")}
                    >
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-2 hover:text-sage-text">
                          {shown}
                        </a>
                      ) : (
                        shown
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={sheet.columns.length} className="px-3 py-6 text-center text-muted-foreground">
                  {sheet.rows.length ? "No rows match your search." : "This sheet has no rows."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
