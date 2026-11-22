/** Tab-separated rows read from a rendered table -- pastes cleanly into
 * spreadsheets and reads fine as plain text. */
export function tableToTsv(table: HTMLTableElement): string {
  return Array.from(table.rows)
    .map((row) =>
      Array.from(row.cells)
        .map((c) => (c.innerText ?? c.textContent ?? "").replace(/\s+/g, " ").trim())
        .join("\t")
    )
    .join("\n");
}
