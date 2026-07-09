import fs from "node:fs";
import path from "node:path";

const CSV_FILE = path.join(process.cwd(), "local_db", "Consolidated_Cases.csv");
export const FILTERABLE_FIELDS = [
  "CrimeHead",
  "CrimeSubHead",
  "PoliceStation",
  "PoliceStationType",
  "District",
  "Court",
  "Officer",
  "OfficerRank",
  "OfficerDesignation",
  "Status",
  "CaseCategory",
  "Gravity",
  "Acts",
  "Sections",
  "ChargesheetStatus",
  "CaseNo",
  "CrimeNo",
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { cell += '"'; i += 1; }
      else if (ch === '"') { inQuotes = false; }
      else { cell += ch; }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}
export function readCases() {
  if (!fs.existsSync(CSV_FILE)) return { headers: [], records: [] };
  const text = fs.readFileSync(CSV_FILE, "utf8");
  const table = parseCsv(text);
  const headers = table[0] || [];
  const records = table.slice(1).filter((r) => r.some(Boolean)).map((row) => {
    const record = {};
    headers.forEach((h, i) => (record[h] = row[i] || ""));
    return record;
  });
  return { headers, records };
}
export function queryCases(filterSpec = {}, limit = 200) {
  const { headers, records } = readCases();
  let rows = records;
  for (const [key, value] of Object.entries(filterSpec)) {
    if (!headers.includes(key) || value == null || value === "") continue;
    const needle = String(value).toLowerCase();
    rows = rows.filter((row) => String(row[key] ?? "").toLowerCase().includes(needle));
  }
  return rows.slice(0, limit);
}