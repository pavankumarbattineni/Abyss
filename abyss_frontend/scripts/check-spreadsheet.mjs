/**
 * Guards spreadsheets in answers (src/lib/visuals/spreadsheet.ts and the
 * `spreadsheet` schema): Excel-safe sheet names, CSV that can't run formulas,
 * typed Excel cells, forgiving rows -- and that a block's sheets really become
 * tabs of ONE workbook. Runs before every build. Run on its own:
 * node scripts/check-spreadsheet.mjs
 */
import { build } from "esbuild";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
import writeXlsxFile from "write-excel-file/node";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = async (entry) => {
  const out = await build({ entryPoints: [join(root, entry)], bundle: true, format: "esm", write: false, platform: "node", logLevel: "silent",
    alias: { "@": join(root, "src") } });
  return import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));
};
const lib = await load("src/lib/visuals/spreadsheet.ts");
const { spreadsheetSchema } = await load("src/lib/visuals/schemas.ts");

const text = { label: "t", type: "text" };
const num = { label: "n", type: "number" };
const cases = [
  ["sheet names: Excel's forbidden characters go, 31 at most, duplicates numbered", () =>
    assert.deepEqual(lib.excelSheetNames(["Q1/Q2 [draft]", "A".repeat(40), "Remote", "remote", ""]),
      ["Q1 Q2 draft", "A".repeat(31), "Remote", "remote (2)", "Sheet 5"])],
  ["CSV: text that looks like a formula can't run", () => {
    for (const bad of ["=HYPERLINK(1)", "+1", "-2+3", "@SUM(A1)"]) assert.equal(lib.csvField(bad, text)[0], "'");
  }],
  ["CSV: real numbers stay numbers, even written with separators", () => {
    assert.equal(lib.csvField(-12.5, num), "-12.5");
    assert.equal(lib.csvField("12,00,000", num), "1200000");
  }],
  ["CSV: quotes, commas and line breaks are quoted; UTF-8 marked for Excel", () => {
    assert.equal(lib.csvField('a "b", c', text), '"a ""b"", c"');
    assert.ok(lib.sheetToCsv({ name: "s", columns: [text], rows: [["₹"]] }).startsWith("﻿"));
  }],
  ["Excel cells are typed: numbers, percents, dates; text is never a formula", () => {
    assert.equal(lib.xlsxCell("85%", { label: "p", type: "percent" }).value, 0.85);
    assert.equal(lib.xlsxCell("2026-11-27", { label: "d", type: "date" }).value.toISOString().slice(0, 10), "2026-11-27");
    assert.equal(lib.xlsxCell("2026-13-45", { label: "d", type: "date" }).type, String);
    assert.equal(lib.xlsxCell("=1+1", text).type, String);
    assert.match(lib.xlsxCell(900000, { label: "s", type: "currency", currency: "INR" }).format, /₹/);
  }],
  ["links: only http(s) is clickable", () => {
    assert.equal(lib.safeUrl("javascript:alert(1)"), null);
    assert.equal(lib.safeUrl("https://example.com/a"), "https://example.com/a");
  }],
  ["schema: object rows, short rows, bare labels and duplicate tab names are made whole", () => {
    const d = spreadsheetSchema.parse({
      format: "spreadsheet",
      sheets: [
        { name: "Jobs", columns: [{ label: "Role" }, { label: "Pay", type: "money" }], rows: [{ Role: "A", Pay: 5 }, ["B"], ["C", 2, "extra"]] },
        { name: "Jobs", columns: ["Note"], rows: [["x"]] },
      ],
    });
    assert.deepEqual(d.sheets[0].rows, [["A", 5], ["B", null], ["C", 2]]);
    assert.equal(d.sheets[0].columns[1].type, "text");
    assert.deepEqual(d.sheets.map((s) => s.name), ["Jobs", "Jobs (2)"]);
    assert.equal(d.sheets[1].columns[0].label, "Note");
  }],
];

let failed = 0;
for (const [name, run] of cases) {
  try {
    run();
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

// One block, several sheets -> ONE workbook with one tab per sheet.
try {
  const sheets = [
    { name: "Bangalore", columns: [text, num], rows: [["a", 1]] },
    { name: "Remote", columns: [text], rows: [["b"]] },
  ];
  const files = unzipSync(new Uint8Array(await writeXlsxFile(lib.workbookSheets(sheets)).toBuffer()));
  const workbook = strFromU8(files["xl/workbook.xml"]);
  assert.ok(files["xl/worksheets/sheet1.xml"] && files["xl/worksheets/sheet2.xml"], "two worksheets");
  assert.ok(workbook.includes('name="Bangalore"') && workbook.includes('name="Remote"'), "tabs named");
} catch (error) {
  failed++;
  console.error(`FAIL one workbook, one tab per sheet: ${error.message}`);
}

if (failed) process.exit(1);
console.log(`spreadsheet check: all ${cases.length + 1} cases pass`);
