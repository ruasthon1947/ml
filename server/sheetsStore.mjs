// server/sheetsStore.mjs
import { GoogleAuth } from "google-auth-library";
import path from "node:path";
import fs from "node:fs";

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || "1sExCOOVJDT6J68DM93E_QPbZGs_-RzPOlfXACYd8mS4";
const SHEET_GID = Number(process.env.GOOGLE_SHEET_GID || "2122513566");

// ROOT RESOLUTION: Point directly to the root of the project where your file actually sits
const KEY_FILE = path.resolve(process.cwd(), "service-account.json");

let cache = { headers: [], records: [], fetchedAt: 0 };
let sheetTitleCache = null;
let authClient = null;

async function getAuthClient() {
  if (authClient) return authClient;
  
  if (!fs.existsSync(KEY_FILE)) {
    throw new Error(`Service account key not found at absolute location: ${KEY_FILE}`);
  }

  const auth = new GoogleAuth({
    keyFile: KEY_FILE,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  authClient = await auth.getClient();
  return authClient;
}

async function resolveSheetTitle(client) {
  if (sheetTitleCache) return sheetTitleCache;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets(properties(sheetId,title))`;
  const res = await client.request({ url });
  const sheets = res.data.sheets || [];
  
  const match = sheets.find((s) => s.properties.title === "CaseMaster") || 
                sheets.find((s) => s.properties.title.includes("Consolidated")) ||
                sheets.find((s) => s.properties.sheetId === SHEET_GID);
  
  if (!match) {
    throw new Error(`Could not find a valid target cases tab (like 'CaseMaster') in this spreadsheet.`);
  }
  
  sheetTitleCache = match.properties.title;
  console.log(`[Sheets Store Automation] Successfully bound target tab to: "${sheetTitleCache}"`);
  return sheetTitleCache;
}

function parseValues(values) {
  if (!values || values.length === 0) return { headers: [], records: [] };
  const headers = values[0];
  const records = values.slice(1).map((row) => {
    const record = {};
    headers.forEach((h, i) => (record[h] = row[i] ?? ""));
    return record;
  });
  return { headers, records };
}

export async function readExplicitTabRecords(tabName) {
  try {
    const client = await getAuthClient();
    const range = encodeURIComponent(`'${tabName.replace(/'/g, "''")}'`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}`;
    const res = await client.request({ url });
    const { records } = parseValues(res.data.values);
    return records;
  } catch (err) {
    console.error(`[Sheets Store Linker Error] Failed fetching tab content for: "${tabName}"`, err.message);
    return [];
  }
}

export async function readSheetCases({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && cache.records.length && now - cache.fetchedAt < CACHE_TTL_MS) {
    return { headers: cache.headers, records: cache.records };
  }

  const client = await getAuthClient();
  const title = await resolveSheetTitle(client);
  const range = encodeURIComponent(`'${title.replace(/'/g, "''")}'`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}`;
  const res = await client.request({ url });
  const { headers, records } = parseValues(res.data.values);

  cache = { headers, records, fetchedAt: now };
  return { headers, records };
}

export function queryCasesInMemory(records, headers, filterSpec = {}, limit = 200) {
  let rows = records;
  for (const [key, value] of Object.entries(filterSpec)) {
    if (!headers.includes(key) || value == null || value === "") continue;
    const needle = String(value).toLowerCase();
    rows = rows.filter((row) => String(row[key] ?? "").toLowerCase().includes(needle));
  }
  return rows.slice(0, limit);
}