// vite.config.ts
import { defineConfig } from "file:///D:/kspp/ml/node_modules/vite/dist/node/index.js";
import react from "file:///D:/kspp/ml/node_modules/@vitejs/plugin-react/dist/index.js";

// server/googleSheets.mjs
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import "file:///D:/kspp/ml/node_modules/dotenv/config.js";
var SCOPES = "https://www.googleapis.com/auth/spreadsheets";
var MASTER_SHEET_ID = process.env.GOOGLE_MASTER_SHEET_ID || process.env.GOOGLE_SHEET_ID || "1sExCOOVJDT6J68DM93E_QPbZGs_-RzPOlfXACYd8mS4";
var CONSOLIDATED_SHEET_ID = process.env.GOOGLE_CONSOLIDATED_SHEET_ID || "1uyzVgCAPZW9CkzkNHFKH0QOJm_nbn5Sr4ul9ngv0ZoM";
var b64url = (value) => Buffer.from(value).toString("base64url");
var quoteRange = (tab, range = "A:ZZ") => encodeURIComponent(`'${tab.replace(/'/g, "''")}'!${range}`);
function resolveCredentialSource(configured) {
  const raw = configured.trim();
  if (raw.startsWith("{")) return raw;
  const candidates = [path.resolve(raw)];
  for (const fallback of ["service-account.json", "config/service-account.json", "local_db/service_account.json"]) {
    const resolved = path.resolve(fallback);
    if (!candidates.includes(resolved)) candidates.push(resolved);
  }
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      `Google Sheets credentials file not found. Set GOOGLE_SERVICE_ACCOUNT_JSON in .env to the JSON key or a valid file path. Checked: ${candidates.join(", ")}`
    );
  }
  return fs.readFileSync(found, "utf8");
}
function credential() {
  let configured = process.env.CATALYST_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!configured) {
    for (const fallback of ["service-account.json", "config/service-account.json", "local_db/service_account.json"]) {
      const resolved = path.resolve(fallback);
      if (fs.existsSync(resolved)) {
        configured = resolved;
        break;
      }
    }
  }
  if (!configured) {
    throw new Error("Google Sheets is not configured. Please add the service-account JSON key directly as GOOGLE_SERVICE_ACCOUNT_JSON to your .env file.");
  }
  const raw = resolveCredentialSource(configured);
  const account = JSON.parse(raw);
  if (account.client_email !== "catalyst-sync@karnatakastatepolice.iam.gserviceaccount.com" && account.client_email !== "sheet-158@karnatakastatepolice.iam.gserviceaccount.com") {
    console.warn("Warning: Using service account email:", account.client_email);
  }
  return account;
}
var tokenCache = { token: "", expiresAt: 0 };
async function token() {
  if (tokenCache.token && tokenCache.expiresAt > Date.now() + 6e4) return tokenCache.token;
  const account = credential();
  const now = Math.floor(Date.now() / 1e3);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: account.client_email, scope: SCOPES, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signature = crypto.createSign("RSA-SHA256").update(`${header}.${payload}`).end().sign(account.private_key, "base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${payload}.${signature}` }) });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(`Google authentication failed: ${data.error_description || data.error || response.statusText}`);
  tokenCache = { token: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1e3 };
  return tokenCache.token;
}
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", ...options.headers || {} } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Google Sheets request failed: ${data.error?.message || response.statusText}`);
  return data;
}
async function ensureTab(sheetId, tab) {
  const meta = await request(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`);
  const exists = meta.sheets?.some((s) => s.properties.title === tab);
  if (!exists) {
    console.log(`Creating tab ${tab} in spreadsheet ${sheetId}`);
    await request(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] })
    });
  }
}
async function readTable(sheetId, tab) {
  try {
    const data = await request(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${quoteRange(tab)}`);
    const values = data.values || [];
    const headers = values[0] || [];
    return { headers, rows: values.slice(1).filter((row) => row.some((cell) => String(cell || "").trim())).map((row) => Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? "")]))) };
  } catch (err) {
    if (err.message.includes("Unable to parse range")) {
      await ensureTab(sheetId, tab);
      return { headers: [], rows: [] };
    }
    throw err;
  }
}
async function writeTable(sheetId, tab, headers, rows) {
  await ensureTab(sheetId, tab);
  await request(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${quoteRange(tab)}:clear`, { method: "POST", body: "{}" });
  return request(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${quoteRange(tab, "A1")}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ majorDimension: "ROWS", values: [headers, ...rows.map((row) => headers.map((header) => String(row[header] ?? "")))] }) });
}
async function appendRow(sheetId, tab, rowArray) {
  await ensureTab(sheetId, tab);
  return request(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${quoteRange(tab, "A1")}:append?valueInputOption=RAW`, {
    method: "POST",
    body: JSON.stringify({ majorDimension: "ROWS", values: [rowArray] })
  });
}
async function updateRow(sheetId, tab, sheetRowIndex, rowArray) {
  const range = `${tab}!A${sheetRowIndex}`;
  return request(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ majorDimension: "ROWS", values: [rowArray] })
  });
}
function recordKey(row) {
  return String(row.CaseMasterID || row.CaseNo || row.CrimeNo || "").trim();
}
function norm(value) {
  return String(value ?? "").trim().toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function splitMulti(value) {
  const text = String(value ?? "").trim();
  if (!text) return [];
  return text.split(/;|\n/).map((part) => part.trim()).filter(Boolean);
}
function rowKey(row, field) {
  const text = String(row[field] ?? "").trim();
  if (!text) return "";
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? String(parsed) : text;
}
function maxNumericId(rows, field) {
  return rows.reduce((max, row) => {
    const parsed = Number.parseInt(rowKey(row, field), 10);
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
}
function makeIdAllocator(rows, field) {
  let current = maxNumericId(rows, field);
  return () => {
    current += 1;
    return String(current);
  };
}
function emptyRecord(headers) {
  return Object.fromEntries(headers.map((header) => [header, ""]));
}
function setCell(record, header, value) {
  if (header in record) record[header] = String(value ?? "");
}
function copyPreserved(record, existing, fields) {
  if (!existing) return;
  for (const field of fields) {
    if (field in record && !String(record[field] ?? "").trim()) {
      record[field] = String(existing[field] ?? "");
    }
  }
}
function existingByCaseAndName(rows, nameField) {
  const result = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const caseId = rowKey(row, "CaseMasterID");
    const name = norm(row[nameField]);
    if (caseId && name) result.set(`${caseId}::${name}`, row);
  }
  return result;
}
function replaceChildCases(existingRows, newRows, caseId) {
  const kept = existingRows.filter((row) => rowKey(row, "CaseMasterID") !== caseId);
  return kept.concat(newRows);
}
function buildAccusedRows(record, table) {
  const caseId = rowKey(record, "CaseMasterID");
  if (!caseId) return [];
  const existing = existingByCaseAndName(table.rows, "AccusedName");
  const nextId = makeIdAllocator(table.rows, "AccusedMasterID");
  const rows = [];
  for (const name of splitMulti(record.AccusedNames)) {
    const old = existing.get(`${caseId}::${norm(name)}`);
    const accusedId = rowKey(old || {}, "AccusedMasterID") || nextId();
    const row = emptyRecord(table.headers);
    setCell(row, "AccusedMasterID", accusedId);
    setCell(row, "CaseMasterID", caseId);
    setCell(row, "AccusedName", name);
    copyPreserved(row, old, ["AgeYear", "GenderID", "PersonID"]);
    rows.push(row);
  }
  return rows;
}
function buildVictimRows(record, table) {
  const caseId = rowKey(record, "CaseMasterID");
  if (!caseId) return [];
  const existing = existingByCaseAndName(table.rows, "VictimName");
  const nextId = makeIdAllocator(table.rows, "VictimMasterID");
  const rows = [];
  for (const name of splitMulti(record.VictimNames)) {
    const old = existing.get(`${caseId}::${norm(name)}`);
    const row = emptyRecord(table.headers);
    setCell(row, "VictimMasterID", rowKey(old || {}, "VictimMasterID") || nextId());
    setCell(row, "CaseMasterID", caseId);
    setCell(row, "VictimName", name);
    copyPreserved(row, old, ["AgeYear", "GenderID", "VictimPolice"]);
    rows.push(row);
  }
  return rows;
}
function buildComplainantRows(record, table) {
  const caseId = rowKey(record, "CaseMasterID");
  const name = String(record.Complainant ?? "").trim();
  if (!caseId || !name) return [];
  const existing = existingByCaseAndName(table.rows, "ComplainantName");
  const nextId = makeIdAllocator(table.rows, "ComplainantID");
  const old = existing.get(`${caseId}::${norm(name)}`);
  const row = emptyRecord(table.headers);
  setCell(row, "ComplainantID", rowKey(old || {}, "ComplainantID") || nextId());
  setCell(row, "CaseMasterID", caseId);
  setCell(row, "ComplainantName", name);
  copyPreserved(row, old, ["AgeYear", "OccupationID", "ReligionID", "CasteID", "GenderID"]);
  return [row];
}
async function syncChildTabs(record) {
  const caseId = rowKey(record, "CaseMasterID");
  if (!caseId) return;
  const [accused, victims, complainants] = await Promise.all([
    readTable(MASTER_SHEET_ID, "Accused"),
    readTable(MASTER_SHEET_ID, "Victim"),
    readTable(MASTER_SHEET_ID, "ComplainantDetails")
  ]);
  const accusedHeaders = accused.headers.length ? accused.headers : ["AccusedMasterID", "CaseMasterID", "AccusedName"];
  const victimHeaders = victims.headers.length ? victims.headers : ["VictimMasterID", "CaseMasterID", "VictimName"];
  const complainantHeaders = complainants.headers.length ? complainants.headers : ["ComplainantID", "CaseMasterID", "ComplainantName"];
  const accusedTable = { headers: accusedHeaders, rows: accused.rows };
  const victimTable = { headers: victimHeaders, rows: victims.rows };
  const complainantTable = { headers: complainantHeaders, rows: complainants.rows };
  const newAccused = buildAccusedRows(record, accusedTable);
  const newVictims = buildVictimRows(record, victimTable);
  const newComplainants = buildComplainantRows(record, complainantTable);
  const writes = [];
  if (newAccused.length || accused.rows.some((row) => rowKey(row, "CaseMasterID") === caseId)) {
    writes.push(
      writeTable(
        MASTER_SHEET_ID,
        "Accused",
        accusedHeaders,
        replaceChildCases(accused.rows, newAccused, caseId)
      )
    );
  }
  if (newVictims.length || victims.rows.some((row) => rowKey(row, "CaseMasterID") === caseId)) {
    writes.push(
      writeTable(
        MASTER_SHEET_ID,
        "Victim",
        victimHeaders,
        replaceChildCases(victims.rows, newVictims, caseId)
      )
    );
  }
  if (newComplainants.length || complainants.rows.some((row) => rowKey(row, "CaseMasterID") === caseId)) {
    writes.push(
      writeTable(
        MASTER_SHEET_ID,
        "ComplainantDetails",
        complainantHeaders,
        replaceChildCases(complainants.rows, newComplainants, caseId)
      )
    );
  }
  await Promise.all(writes);
}
var casesCache = { data: null, expiresAt: 0 };
async function casesFromGoogle() {
  if (casesCache.data && casesCache.expiresAt > Date.now()) {
    return casesCache.data;
  }
  const data = await readTable(CONSOLIDATED_SHEET_ID, process.env.GOOGLE_CONSOLIDATED_TAB || "Consolidated_Cases");
  casesCache = { data, expiresAt: Date.now() + 15e3 };
  return data;
}
async function upsertCaseInGoogle(record) {
  const tab = process.env.GOOGLE_CONSOLIDATED_TAB || "Consolidated_Cases";
  const consolidated = await readTable(CONSOLIDATED_SHEET_ID, tab);
  let headers = [...consolidated.headers];
  let headersChanged = false;
  if (!headers.length) {
    headers = Object.keys(record);
    headersChanged = true;
  } else {
    for (const key2 of Object.keys(record)) {
      if (!headers.includes(key2)) {
        headers.push(key2);
        headersChanged = true;
      }
    }
  }
  const key = recordKey(record);
  const index = consolidated.rows.findIndex((row) => recordKey(row) === key);
  if (headersChanged) {
    if (consolidated.rows.length === 0) {
      await writeTable(CONSOLIDATED_SHEET_ID, tab, headers, []);
    } else {
      await updateRow(CONSOLIDATED_SHEET_ID, tab, 1, headers);
    }
  }
  const rowArray = headers.map((h) => String(record[h] || ""));
  if (index >= 0) {
    await updateRow(CONSOLIDATED_SHEET_ID, tab, index + 2, rowArray);
  } else {
    await appendRow(CONSOLIDATED_SHEET_ID, tab, rowArray);
  }
  const master = await readTable(MASTER_SHEET_ID, "CaseMaster");
  let masterHeaders = [...master.headers];
  let masterHeadersChanged = false;
  if (!masterHeaders.length) {
    masterHeaders = Object.keys(record);
    masterHeadersChanged = true;
  } else {
    for (const k of Object.keys(record)) {
      if (!masterHeaders.includes(k)) {
        masterHeaders.push(k);
        masterHeadersChanged = true;
      }
    }
  }
  if (masterHeadersChanged && master.rows.length > 0) {
    await updateRow(MASTER_SHEET_ID, "CaseMaster", 1, masterHeaders);
  }
  if (masterHeaders.length) {
    const masterRowArray = masterHeaders.map((header) => String(record[header] || ""));
    const masterIndex = master.rows.findIndex((row) => recordKey(row) === key);
    if (masterIndex >= 0) {
      await updateRow(MASTER_SHEET_ID, "CaseMaster", masterIndex + 2, masterRowArray);
    } else {
      await appendRow(MASTER_SHEET_ID, "CaseMaster", masterRowArray);
    }
  }
  await syncChildTabs(record);
  casesCache = { data: null, expiresAt: 0 };
  return record;
}
async function employeeById(employeeId) {
  const table = await readTable(MASTER_SHEET_ID, "Employee");
  const target = String(employeeId || "").trim().toLowerCase();
  const rawId = target.replace(/^(emp|ksp|kgid)[-_\s]*/i, "");
  const row = table.rows.find((item) => {
    const id = String(item.EmployeeID || "").trim().toLowerCase();
    const kgid = String(item.KGID || "").trim().toLowerCase();
    return id === target || rawId && id === rawId || kgid === target || rawId && kgid.toLowerCase().endsWith(rawId);
  });
  return { table, row };
}
async function updateEmployee(employeeId, changes) {
  const { table, row } = await employeeById(employeeId);
  if (!row) throw new Error("Employee was not found in the Employee sheet.");
  const index = table.rows.indexOf(row);
  table.rows[index] = { ...row, ...changes };
  for (const key of Object.keys(changes)) {
    if (!table.headers.includes(key)) {
      table.headers.push(key);
    }
  }
  await writeTable(MASTER_SHEET_ID, "Employee", table.headers, table.rows);
  return table.rows[index];
}

// server/localDbPlugin.mjs
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path2 from "node:path";
import fs2 from "node:fs";
import { parse } from "file:///D:/kspp/ml/node_modules/csv-parse/lib/sync.js";
var execFileAsync = promisify(execFile);
function normalizeValue(value) {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).join("; ");
  }
  return String(value).trim();
}
function normalizeCrimeNo(str) {
  if (!str) return "";
  const cleaned = String(str).trim().toUpperCase().replace(/^CR-?/i, "");
  const parts = cleaned.split("/");
  if (parts.length === 2) {
    const seq = parts[0].replace(/^0+/, "");
    return `${seq}/${parts[1]}`;
  }
  return cleaned;
}
function splitList(value) {
  return String(value || "").split(";").map((item) => item.trim()).filter(Boolean);
}
var OPTION_FIELDS = [
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
  "ChargesheetStatus"
];
function buildOptions(records) {
  const options = {};
  for (const field of OPTION_FIELDS) {
    const values = /* @__PURE__ */ new Set();
    for (const record of records) {
      for (const value of splitList(record[field])) {
        values.add(value);
      }
      if (!String(record[field] || "").includes(";") && record[field]) {
        values.add(record[field]);
      }
    }
    options[field] = Array.from(values).sort((a, b) => a.localeCompare(b));
  }
  const crimeSubHeadsByHead = {};
  for (const record of records) {
    const head = record.CrimeHead || "";
    const subHead = record.CrimeSubHead || "";
    if (!head || !subHead) continue;
    crimeSubHeadsByHead[head] = crimeSubHeadsByHead[head] || [];
    if (!crimeSubHeadsByHead[head].includes(subHead)) {
      crimeSubHeadsByHead[head].push(subHead);
    }
  }
  Object.values(crimeSubHeadsByHead).forEach((values) => values.sort((a, b) => a.localeCompare(b)));
  options.crimeSubHeadsByHead = crimeSubHeadsByHead;
  return options;
}
function generateCrimeNo(records) {
  const currentYear = (/* @__PURE__ */ new Date()).getFullYear();
  let maxSeq = 0;
  for (const record of records) {
    const parts = String(record.CrimeNo || "").split("/");
    if (parts.length === 2 && parts[1] === String(currentYear)) {
      const seq = parseInt(parts[0].replace(/^0+/, ""), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }
  return `${String(maxSeq + 1).padStart(4, "0")}/${currentYear}`;
}
function nextNumericValue(records, field, fallback) {
  const max = records.reduce((current, record) => {
    const n = Number.parseInt(record[field], 10);
    return Number.isFinite(n) ? Math.max(current, n) : current;
  }, 0);
  return String(max > 0 ? max + 1 : fallback);
}
function recalcDerivedFields(record) {
  record.AccusedCount = String(splitList(record.AccusedNames).length);
  record.VictimCount = String(splitList(record.VictimNames).length);
  if (!record.ArrestCount) record.ArrestCount = "0";
  if (!record.ChargesheetCount) record.ChargesheetCount = "0";
  if (!record.ChargesheetStatus) record.ChargesheetStatus = "Pending";
  if (!record.Status) record.Status = "Under Investigation";
  if (!record.CaseCategory) record.CaseCategory = "FIR";
  if (!record.Gravity) record.Gravity = "Non-Heinous";
  if (!record.District) record.District = "Bangalore Urban";
}
function caseMatches(record, key) {
  const wanted = decodeURIComponent(String(key || "")).trim();
  if (!wanted) return false;
  const wantedNormalized = normalizeCrimeNo(wanted);
  if (String(record.CaseMasterID || "").trim() === wanted || String(record.CaseNo || "").trim() === wanted) {
    return true;
  }
  if (record.CrimeNo) {
    const recordCrimeNormalized = normalizeCrimeNo(record.CrimeNo);
    if (recordCrimeNormalized === wantedNormalized) return true;
    if (String(record.CrimeNo).trim() === wanted) return true;
  }
  return false;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e7) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}
function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
function sendError(res, status, error) {
  sendJson(res, status, { ok: false, error: error instanceof Error ? error.message : String(error) });
}
async function handleApi(req, res, next) {
  const url = new URL(req.url || "/", "http://local-db");
  if (url.pathname === "/api/chat") {
    next();
    return;
  }
  if (!url.pathname.startsWith("/api/")) {
    next();
    return;
  }
  try {
    if (req.method === "POST" && url.pathname === "/api/login") {
      const { employeeId, password, firebaseAuth } = await readBody(req);
      if (!employeeId || !password && !firebaseAuth) {
        sendError(res, 400, "Employee ID and password are required.");
        return;
      }
      const { row } = await employeeById(employeeId);
      if (!row) {
        if (firebaseAuth) {
          sendJson(res, 200, { ok: true, employeeId, name: `Officer ${employeeId}`, isFirstLogin: false });
          return;
        }
        sendError(res, 401, "Invalid credentials. Employee ID not found.");
        return;
      }
      if (!firebaseAuth && row.FirstAuth !== password) {
        sendError(res, 401, "Invalid credentials.");
        return;
      }
      const officerName = row.Name || (row.FirstName ? `Officer ${row.FirstName}` : `Officer ${employeeId}`);
      sendJson(res, 200, { ok: true, employeeId, name: officerName, isFirstLogin: row.HasLoggedIn !== "TRUE" });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/employee/password") {
      const { employeeId, password, phoneNumber, notificationPref, hasLoggedIn } = await readBody(req);
      if (!employeeId) {
        sendError(res, 400, "Employee ID is required.");
        return;
      }
      const updates = {};
      if (password) {
        updates.FirstAuth = password;
        updates.HasLoggedIn = "TRUE";
      }
      if (hasLoggedIn) {
        updates.HasLoggedIn = "TRUE";
      }
      if (phoneNumber) updates.PhoneNumber = phoneNumber;
      if (notificationPref !== void 0) updates.NotificationPref = String(notificationPref);
      await updateEmployee(employeeId, updates);
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/cases") {
      const { headers, rows } = await casesFromGoogle();
      sendJson(res, 200, { ok: true, headers, cases: rows, options: buildOptions(rows) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/cases/sync") {
      sendJson(res, 200, { ok: true, sync: { ok: true, skipped: true, message: "Sync handled dynamically via Node.js" } });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/cases/pull") {
      try {
        const tempCsv = path2.join(process.cwd(), "scratch", "temp_sync.csv");
        const exportScript = path2.join(process.cwd(), "local_db", "export_data.py");
        const env = { ...process.env, GOOGLE_SERVICE_ACCOUNT_JSON: process.env.CATALYST_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON };
        await execFileAsync("python", [exportScript, "--output", tempCsv], { env });
        if (fs2.existsSync(tempCsv)) {
          const csvData = fs2.readFileSync(tempCsv, "utf8");
          const records = parse(csvData, { columns: true, skip_empty_lines: true });
          if (records.length > 0) {
            const headers2 = Object.keys(records[0]);
            const CONSOLIDATED_SHEET_ID2 = process.env.GOOGLE_CONSOLIDATED_SHEET_ID || "1uyzVgCAPZW9CkzkNHFKH0QOJm_nbn5Sr4ul9ngv0ZoM";
            const tab = process.env.GOOGLE_CONSOLIDATED_TAB || "Consolidated_Cases";
            await writeTable(CONSOLIDATED_SHEET_ID2, tab, headers2, records);
          }
          fs2.unlinkSync(tempCsv);
        }
        const { headers, rows } = await casesFromGoogle();
        sendJson(res, 200, {
          ok: true,
          pull: { ok: true },
          writeResult: { pending: false },
          headers,
          cases: rows,
          options: buildOptions(rows)
        });
      } catch (err) {
        sendError(res, 500, `Sync failed: ${err.message}`);
      }
      return;
    }
    const caseMatch = url.pathname.match(/^\/api\/cases\/([^/]+)$/);
    if (req.method === "GET" && caseMatch) {
      const { headers, rows } = await casesFromGoogle();
      const record = rows.find((item) => caseMatches(item, caseMatch[1]));
      if (!record) {
        sendError(res, 404, "Case was not found.");
        return;
      }
      sendJson(res, 200, { ok: true, headers, case: record, options: buildOptions(rows) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/cases" || (req.method === "PATCH" || req.method === "PUT") && caseMatch) {
      const payload = await readBody(req);
      const { headers, rows: records } = await casesFromGoogle();
      const fields = payload.case || payload.fields || payload;
      const key = caseMatch ? caseMatch[1] : "";
      const knownFields = {};
      for (const [k, value] of Object.entries(fields)) {
        knownFields[k] = normalizeValue(value);
      }
      let index = records.findIndex((record2) => caseMatches(record2, key || knownFields.CrimeNo || knownFields.CaseNo || knownFields.CaseMasterID));
      const created = index === -1;
      const record = {};
      headers.forEach((header) => {
        record[header] = created ? "" : records[index][header] || "";
      });
      Object.assign(record, knownFields);
      if (!record.CaseMasterID || record.CaseMasterID === "Assigned on save") {
        record.CaseMasterID = nextNumericValue(records, "CaseMasterID", 1222);
      }
      if (!record.CaseNo || record.CaseNo === "Assigned on save") {
        const year = (/* @__PURE__ */ new Date()).getFullYear();
        record.CaseNo = `${year}${String(records.length + 1).padStart(6, "0")}`;
      }
      if (!record.CrimeNo || record.CrimeNo === "Assigned on save") {
        record.CrimeNo = generateCrimeNo(records);
      }
      recalcDerivedFields(record);
      console.log(`[Google Sheets Write] Upserting record for CaseMasterID: ${record.CaseMasterID}...`);
      try {
        await upsertCaseInGoogle(record);
        console.log(`[Google Sheets Write] \u2705 Successfully wrote CaseMasterID ${record.CaseMasterID} to Google Sheets!`);
      } catch (googleErr) {
        console.error(`[Google Sheets Write Error] \u274C Failed to write to Google Sheets:`, googleErr);
        throw new Error(`Google Sheets API write error: ${googleErr.message || String(googleErr)}`);
      }
      try {
        const MASTER_SHEET_ID2 = process.env.GOOGLE_MASTER_SHEET_ID || process.env.GOOGLE_SHEET_ID || "1sExCOOVJDT6J68DM93E_QPbZGs_-RzPOlfXACYd8mS4";
        const employeesTab = await readTable(MASTER_SHEET_ID2, "Employee");
        const unitsTab = await readTable(MASTER_SHEET_ID2, "Unit");
        const station = record.PoliceStation || record.Station;
        if (station) {
          let targetUnitId = String(station);
          const unitMatch = unitsTab.rows.find((u) => u.UnitName && u.UnitName.trim().toLowerCase() === station.trim().toLowerCase());
          if (unitMatch) {
            targetUnitId = String(unitMatch.UnitID);
          }
          const matchingEmployees = employeesTab.rows.filter(
            (e) => String(e.UnitID) === targetUnitId && e.PhoneNumber && e.PhoneNumber.trim() !== ""
          );
          if (matchingEmployees.length > 0) {
            console.log(`
[PUSH NOTIFICATION TRIGGER]`);
            console.log(`Case Update: ${record.CrimeNo || record.CaseNo} at ${station}`);
            matchingEmployees.forEach((emp) => {
              console.log(` -> Sending SMS/Push to Officer ${emp.Name} at ${emp.PhoneNumber}`);
            });
            console.log(`---------------------------
`);
          }
        }
      } catch (err) {
        console.error("Failed to simulate push notification:", err);
      }
      sendJson(res, 200, {
        ok: true,
        created,
        headers,
        case: record,
        options: buildOptions(records),
        sync: { ok: true, skipped: false, message: "Directly saved to Google Sheets" }
      });
      return;
    }
    sendError(res, 404, "Unknown API endpoint.");
  } catch (error) {
    console.error("[Local DB Handler Exception]:", error);
    sendError(res, 500, error);
  }
}
function localDbPlugin() {
  return {
    name: "local-db-api",
    configureServer(server) {
      server.middlewares.use(handleApi);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleApi);
    }
  };
}
var localDbPlugin_default = localDbPlugin;

// server/chatPlugin.mjs
import "file:///D:/kspp/ml/node_modules/dotenv/config.js";
import dns2 from "node:dns";

// server/geminiService.mjs
import dns from "node:dns";
import { GoogleGenAI } from "file:///D:/kspp/ml/node_modules/@google/genai/dist/node/index.mjs";

// server/sheetsStore.mjs
import { GoogleAuth } from "file:///D:/kspp/ml/node_modules/google-auth-library/build/src/index.js";
import path3 from "node:path";
import fs3 from "node:fs";
var SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || "1sExCOOVJDT6J68DM93E_QPbZGs_-RzPOlfXACYd8mS4";
var SHEET_GID = Number(process.env.GOOGLE_SHEET_GID || "2122513566");
var KEY_FILE = path3.resolve(process.cwd(), "service-account.json");
var authClient = null;
async function getAuthClient() {
  if (authClient) return authClient;
  if (!fs3.existsSync(KEY_FILE)) {
    throw new Error(`Service account key not found at absolute location: ${KEY_FILE}`);
  }
  const auth = new GoogleAuth({
    keyFile: KEY_FILE,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  });
  authClient = await auth.getClient();
  return authClient;
}
function parseValues(values) {
  if (!values || values.length === 0) return { headers: [], records: [] };
  const headers = values[0];
  const records = values.slice(1).map((row) => {
    const record = {};
    headers.forEach((h, i) => record[h] = row[i] ?? "");
    return record;
  });
  return { headers, records };
}
async function readExplicitTabRecords(tabName) {
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
function queryCasesInMemory(records, headers, filterSpec = {}, limit = 200) {
  let rows = records;
  for (const [key, value] of Object.entries(filterSpec)) {
    if (!headers.includes(key) || value == null || value === "") continue;
    const needle = String(value).toLowerCase();
    rows = rows.filter((row) => String(row[key] ?? "").toLowerCase().includes(needle));
  }
  return rows.slice(0, limit);
}

// server/rbac.mjs
var ROLE_RULES = {
  Constable: { forceStationFilter: true },
  Inspector: { forceStationFilter: false },
  SP: { forceStationFilter: false }
};
function getRules(role) {
  return ROLE_RULES[role] || ROLE_RULES.Constable;
}
function applyAccessControl(filterSpec, role, stationId) {
  const rules = getRules(role);
  const merged = { ...filterSpec };
  if (rules.forceStationFilter && stationId) {
    merged.PoliceStation = stationId;
  }
  return merged;
}

// server/geminiService.mjs
dns.setDefaultResultOrder("ipv4first");
var GEMINI_KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "").split(",").map((k) => k.trim()).filter(Boolean);
var GROQ_KEYS = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "").split(",").map((k) => k.trim()).filter(Boolean);
var FALLBACK_GEMINI_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash"];
var FALLBACK_GROQ_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
var STOP_WORDS = /* @__PURE__ */ new Set([
  "give",
  "details",
  "complete",
  "about",
  "this",
  "case",
  "cases",
  "bearing",
  "number",
  "with",
  "total",
  "recorded",
  "today",
  "show",
  "what",
  "are",
  "have",
  "from",
  "that",
  "which",
  "will",
  "would",
  "could",
  "should",
  "output",
  "kannada",
  "english",
  "please",
  "tell",
  "need",
  "only",
  "also",
  "list",
  "all",
  "the",
  "for",
  "any",
  "in",
  "at",
  "of",
  "is",
  "and",
  "or"
]);
function normalizeLocationOrTerm(term) {
  const t = String(term || "").toLowerCase().trim();
  if (t === "whitefiled" || t === "whitefield") return "whitefield";
  if (t === "koramangla" || t === "koramangala") return "koramangala";
  if (t === "indranagar" || t === "indiranagar") return "indiranagar";
  if (t === "basavangudi" || t === "basavanagudi") return "basavanagudi";
  return t;
}
function normalizeCrimeNo2(str) {
  if (!str) return "";
  const cleaned = String(str).trim().toUpperCase().replace(/^CR-?/i, "");
  const parts = cleaned.split("/");
  if (parts.length === 2) {
    const seq = parts[0].replace(/^0+/, "");
    return `${seq}/${parts[1]}`;
  }
  return cleaned;
}
async function generateWithGroq(prompt, apiKey) {
  for (const model of FALLBACK_GROQ_MODELS) {
    try {
      console.log(`[Copilot Engine] Calling Groq model '${model}'...`);
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (text) return text.trim();
      } else {
        const errJson = await res.json().catch(() => ({}));
        console.warn(`[Copilot Engine] Groq model '${model}' HTTP ${res.status}:`, errJson?.error?.message || res.statusText);
      }
    } catch (e) {
      console.warn(`[Copilot Engine] Groq model '${model}' error:`, e.message);
    }
  }
  throw new Error("All Groq models failed.");
}
async function generateWithFallback(fullPrompt) {
  let lastError = null;
  for (const modelName of FALLBACK_GEMINI_MODELS) {
    for (let i = 0; i < GEMINI_KEYS.length; i++) {
      const key = GEMINI_KEYS[i];
      try {
        const ai = new GoogleGenAI({ apiKey: key });
        const response = await ai.models.generateContent(
          {
            model: modelName,
            contents: fullPrompt,
            config: { temperature: 0 }
          },
          { timeout: 15e3 }
        );
        return response.text.trim();
      } catch (err) {
        const errorMsg = err.message || String(err);
        console.warn(`[Copilot Engine] \u26A0\uFE0F Gemini Key #${i + 1} failed on '${modelName}' (${err.status || "Quota/404"}). Retrying...`);
        lastError = err;
      }
    }
  }
  for (let i = 0; i < GROQ_KEYS.length; i++) {
    const key = GROQ_KEYS[i];
    try {
      console.log(`[Copilot Engine] \u{1F680} Executing request via Groq Engine Key #${i + 1}...`);
      return await generateWithGroq(fullPrompt, key);
    } catch (err) {
      console.warn(`[Copilot Engine] \u26A0\uFE0F Groq Key #${i + 1} failed:`, err.message);
      lastError = err;
    }
  }
  throw new Error(`All AI provider keys and models failed. Last error: ${lastError?.message}`);
}
function findMatchingCases(question, allCases) {
  if (!question || !allCases || allCases.length === 0) return [];
  const qLower = String(question).toLowerCase().trim();
  const qClean = qLower.replace(/[^\w\/\-\s]/g, " ");
  const matched = /* @__PURE__ */ new Set();
  for (const c of allCases) {
    if (!c) continue;
    const caseNo = String(c.CaseNo || "").toLowerCase().trim();
    const crimeNo = String(c.CrimeNo || "").toLowerCase().trim();
    const caseMasterId = String(c.CaseMasterID || "").toLowerCase().trim();
    const normCrime = normalizeCrimeNo2(c.CrimeNo).toLowerCase();
    if (caseNo && (qLower.includes(caseNo) || qClean.includes(caseNo))) {
      matched.add(c);
      continue;
    }
    if (caseNo.startsWith("fir/")) {
      const bareNo = caseNo.replace(/^fir\//i, "");
      if (bareNo && (qLower.includes(bareNo) || qClean.includes(bareNo))) {
        matched.add(c);
        continue;
      }
    }
    if (caseMasterId) {
      const re = new RegExp(`\\b${caseMasterId}\\b`, "i");
      if (re.test(qClean)) {
        matched.add(c);
        continue;
      }
    }
    if (crimeNo && (qLower.includes(crimeNo) || qClean.includes(crimeNo))) {
      matched.add(c);
      continue;
    }
    if (normCrime && normCrime.length >= 4) {
      const qNorm = normalizeCrimeNo2(qLower).toLowerCase();
      if (qLower.includes(normCrime) || qNorm.includes(normCrime)) {
        matched.add(c);
        continue;
      }
    }
  }
  if (matched.size > 0) return Array.from(matched);
  const numbersInQuery = qClean.match(/\b\d{3,16}\b/g) || [];
  if (numbersInQuery.length > 0) {
    for (const c of allCases) {
      if (!c) continue;
      const caseNo = String(c.CaseNo || "").toLowerCase().trim();
      const caseMasterId = String(c.CaseMasterID || "").toLowerCase().trim();
      const crimeNo = String(c.CrimeNo || "").toLowerCase().trim();
      for (const num of numbersInQuery) {
        if (num === "2026") continue;
        if (caseMasterId === num || caseNo === num || caseNo.endsWith(`/${num}`) || crimeNo === num || crimeNo.endsWith(`/${num}`)) {
          matched.add(c);
        }
      }
    }
    if (matched.size > 0) return Array.from(matched);
  }
  if (qLower.includes("today")) {
    const todayStr = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    for (const c of allCases) {
      if (String(c.CrimeRegisteredDate || "").startsWith(todayStr)) {
        matched.add(c);
      }
    }
    if (matched.size > 0) return Array.from(matched);
  }
  const tokens = qClean.split(/\s+/).map(normalizeLocationOrTerm).filter((t) => t.length > 2 && !STOP_WORDS.has(t));
  if (tokens.length > 0) {
    for (const c of allCases) {
      const rowStr = Object.values(c).join(" ").toLowerCase();
      if (tokens.every((term) => {
        if (term === "kidnapping" || term === "abduction") {
          return rowStr.includes("kidnapping") || rowStr.includes("abduction");
        }
        return rowStr.includes(term);
      })) {
        matched.add(c);
      }
    }
    if (matched.size > 0) return Array.from(matched);
    for (const c of allCases) {
      const rowStr = Object.values(c).join(" ").toLowerCase();
      if (tokens.some((term) => {
        if (term === "kidnapping" || term === "abduction") {
          return rowStr.includes("kidnapping") || rowStr.includes("abduction");
        }
        return rowStr.includes(term);
      })) {
        matched.add(c);
      }
    }
    if (matched.size > 0) return Array.from(matched);
  }
  return [];
}
async function handleChatQuery({ question, role, stationId, language }) {
  console.log(`[Copilot Engine] Processing query: "${question}"`);
  try {
    const [caseMasterRows, accusedRows, complainantRows, consolidatedData] = await Promise.all([
      readExplicitTabRecords("CaseMaster").catch(() => []),
      readExplicitTabRecords("Accused").catch(() => []),
      readExplicitTabRecords("ComplainantDetails").catch(() => []),
      casesFromGoogle().catch(() => ({ rows: [] }))
    ]);
    const allCases = consolidatedData.rows && consolidatedData.rows.length > 0 ? consolidatedData.rows : caseMasterRows;
    let contextualRows = findMatchingCases(question, allCases);
    const isSpecificSearch = /fir|cr-|\d{3,}/i.test(question || "");
    if (contextualRows.length === 0 && !isSpecificSearch && allCases.length > 0) {
      contextualRows = allCases.slice(0, 5);
    }
    contextualRows = contextualRows.slice(0, 20);
    if (contextualRows.length === 0) {
      return language === "kn" ? "\u0C97\u0CCC\u0CB0\u0CB5\u0CBE\u0CA8\u0CCD\u0CB5\u0CBF\u0CA4 \u0C85\u0CA7\u0CBF\u0C95\u0CBE\u0CB0\u0CBF\u0C97\u0CB3\u0CC7, \u0CA8\u0CBF\u0CAE\u0CCD\u0CAE \u0C85\u0CA7\u0CBF\u0C95\u0CBE\u0CB0 \u0CB5\u0CCD\u0CAF\u0CBE\u0CAA\u0CCD\u0CA4\u0CBF\u0CAF\u0CB2\u0CCD\u0CB2\u0CBF \u0C88 \u0C95\u0CC8\u0CAA\u0CBF\u0CA1\u0CBF/\u0CA6\u0CC2\u0CB0\u0CC1 \u0CB8\u0C82\u0C96\u0CCD\u0CAF\u0CC6\u0C97\u0CC6 \u0CB8\u0C82\u0CAC\u0C82\u0CA7\u0CBF\u0CB8\u0CBF\u0CA6 \u0CAF\u0CBE\u0CB5\u0CC1\u0CA6\u0CC7 \u0CA6\u0CBE\u0C96\u0CB2\u0CC6\u0C97\u0CB3\u0CC1 \u0C95\u0C82\u0CA1\u0CC1\u0CAC\u0C82\u0CA6\u0CBF\u0CB2\u0CCD\u0CB2." : "Respectful greetings Officer. Based on the verified database records currently available, no case records were found matching your query.";
    }
    contextualRows = contextualRows.map((cCase) => {
      if (!cCase) return {};
      const caseId = String(cCase.CaseMasterID || "").trim();
      const relatedAccusedList = accusedRows.filter((a) => a && String(a.CaseMasterID || "").trim() === caseId).map((a) => `${a.AccusedName || "Unknown"} (Age: ${a.AgeYear || "N/A"}, Gender: ${a.GenderID || "N/A"})`).join("\n");
      const relatedComplainants = complainantRows.filter((c) => c && String(c.CaseMasterID || "").trim() === caseId).map((c) => `Name: ${c.ComplainantName || "N/A"}
Complainant ID: ${c.ComplainantID || "N/A"}
Age: ${c.AgeYear || "N/A"} Years
Gender ID: ${c.GenderID || "N/A"}
Occupation ID: ${c.OccupationID || "N/A"}
Religion ID: ${c.ReligionID || "N/A"}
Caste ID: ${c.CasteID || "N/A"}`).join("\n");
      return {
        ...cCase,
        LinkedAccusedProfiles: cCase.AccusedNames || relatedAccusedList || "None listed.",
        TargetComplainantDetails: cCase.Complainant || relatedComplainants || "None listed."
      };
    });
    const headers = allCases.length > 0 ? Object.keys(allCases[0]) : [];
    const finalFilteredRows = queryCasesInMemory(contextualRows, [...headers, "LinkedAccusedProfiles", "TargetComplainantDetails"], applyAccessControl({}, role, stationId));
    if (finalFilteredRows.length === 0) {
      return language === "kn" ? "\u0C97\u0CCC\u0CB0\u0CB5\u0CBE\u0CA8\u0CCD\u0CB5\u0CBF\u0CA4 \u0C85\u0CA7\u0CBF\u0C95\u0CBE\u0CB0\u0CBF\u0C97\u0CB3\u0CC7, \u0CA8\u0CBF\u0CAE\u0CCD\u0CAE \u0C85\u0CA7\u0CBF\u0C95\u0CBE\u0CB0 \u0CB5\u0CCD\u0CAF\u0CBE\u0CAA\u0CCD\u0CA4\u0CBF\u0CAF\u0CB2\u0CCD\u0CB2\u0CBF \u0C88 \u0CB9\u0CC6\u0CB8\u0CB0\u0CBF\u0C97\u0CC6 \u0CB8\u0C82\u0CAC\u0C82\u0CA7\u0CBF\u0CB8\u0CBF\u0CA6 \u0CAF\u0CBE\u0CB5\u0CC1\u0CA6\u0CC7 \u0CA6\u0CBE\u0C96\u0CB2\u0CC6\u0C97\u0CB3\u0CC1 \u0C95\u0C82\u0CA1\u0CC1\u0CAC\u0C82\u0CA6\u0CBF\u0CB2\u0CCD\u0CB2." : "Respectful greetings Officer. Based on the verified database records currently available, there are no records found matching the requested query within your authorization scope.";
    }
    const isKannada = language === "kn" || /[\u0C80-\u0CFF]/.test(question || "");
    const formattedContext = finalFilteredRows.map((row, i) => {
      const fields = Object.entries(row).map(([k, v]) => `   - ${k}: ${v}`).join("\n");
      return `[CASE DATA BLOCK #${i + 1}]
${fields}`;
    }).join("\n\n");
    const totalSystemCount = allCases.length;
    const todayStr = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const todayCount = allCases.filter((r) => String(r.CrimeRegisteredDate || "").startsWith(todayStr)).length;
    const prompt = isKannada ? `
You are the official Karnataka Police Copilot AI Assistant. Your task is to intelligently fulfill the user's request using the verified database records provided below.

SYSTEM DATABASE OVERVIEW:
- \u0C92\u0C9F\u0CCD\u0C9F\u0CC1 \u0CA6\u0CBE\u0C96\u0CB2\u0CBE\u0CA6 \u0CAA\u0CCD\u0CB0\u0C95\u0CB0\u0CA3\u0C97\u0CB3\u0CC1 (Total cases in DB): ${totalSystemCount}
- \u0C87\u0C82\u0CA6\u0CC1 \u0CA6\u0CBE\u0C96\u0CB2\u0CBE\u0CA6 \u0CAA\u0CCD\u0CB0\u0C95\u0CB0\u0CA3\u0C97\u0CB3\u0CC1 (${todayStr}): ${todayCount}
- \u0C88 \u0CB5\u0CBF\u0CA8\u0C82\u0CA4\u0CBF\u0C97\u0CC6 \u0CB8\u0CBF\u0C95\u0CCD\u0C95 \u0C92\u0C9F\u0CCD\u0C9F\u0CC1 \u0CAA\u0CCD\u0CB0\u0C95\u0CB0\u0CA3\u0C97\u0CB3 \u0CB8\u0C82\u0C96\u0CCD\u0CAF\u0CC6: ${finalFilteredRows.length}

STRICT LANGUAGE MANDATE:
- You MUST read, process, and respond EXCLUSIVELY in Kannada (\u0C95\u0CA8\u0CCD\u0CA8\u0CA1).
- Every single label, header, status, and summary sentence MUST be written in proper Kannada script.
- Do NOT use English labels like "Case Number", "Offence", "Complainant", "Summary" when in Kannada mode.

REQUIRED KANNADA FORMAT LAYOUT (\u0CB8\u0C82\u0C95\u0CCD\u0CB7\u0CBF\u0CAA\u0CCD\u0CA4 \u0CAE\u0CA4\u0CCD\u0CA4\u0CC1 \u0CB8\u0CCD\u0CAA\u0CB7\u0CCD\u0C9F \u0CA8\u0CCB\u0C9F):
\u0CAA\u0CCD\u0CB0\u0CB6\u0CCD\u0CA8\u0CC6\u0C97\u0CC6 \u0CA8\u0CC7\u0CB0\u0CB5\u0CBE\u0C97\u0CBF \u0C89\u0CA4\u0CCD\u0CA4\u0CB0\u0CBF\u0CB8\u0CBF: \u0CB5\u0CBF\u0CA8\u0C82\u0CA4\u0CBF\u0C97\u0CC6 \u0CB8\u0C82\u0CAC\u0C82\u0CA7\u0CBF\u0CB8\u0CBF\u0CA6 \u0C92\u0C9F\u0CCD\u0C9F\u0CC1 \u0CAA\u0CCD\u0CB0\u0C95\u0CB0\u0CA3\u0C97\u0CB3 \u0CB8\u0C82\u0C96\u0CCD\u0CAF\u0CC6 **${finalFilteredRows.length}**.

\u0CAA\u0CCD\u0CB0\u0CA4\u0CBF\u0CAF\u0CCA\u0C82\u0CA6\u0CC1 \u0CAA\u0CCD\u0CB0\u0C95\u0CB0\u0CA3\u0CA6 \u0CB5\u0CBF\u0CB5\u0CB0\u0C97\u0CB3\u0CA8\u0CCD\u0CA8\u0CC1 \u0C88 \u0C95\u0CC6\u0CB3\u0C97\u0CBF\u0CA8\u0C82\u0CA4\u0CC6 \u0CB8\u0C82\u0C95\u0CCD\u0CB7\u0CBF\u0CAA\u0CCD\u0CA4\u0CB5\u0CBE\u0C97\u0CBF \u0CA8\u0CC0\u0CA1\u0CBF:
\u{1F4CC} **\u0CAA\u0CCD\u0CB0\u0C95\u0CB0\u0CA3\u0CA6 \u0CB8\u0C82\u0C96\u0CCD\u0CAF\u0CC6:** [CaseNo] (\u0C85\u0CAA\u0CB0\u0CBE\u0CA7 \u0CB8\u0C82\u0C96\u0CCD\u0CAF\u0CC6: [CrimeNo])
\u{1F3F7}\uFE0F **\u0C85\u0CAA\u0CB0\u0CBE\u0CA7\u0CA6 \u0CAA\u0CCD\u0CB0\u0C95\u0CBE\u0CB0:** [CrimeHead] - [CrimeSubHead] ([Gravity in Kannada])
\u{1F3DB}\uFE0F **\u0CAA\u0CCA\u0CB2\u0CC0\u0CB8\u0CCD \u0CA0\u0CBE\u0CA3\u0CC6 \u0CAE\u0CA4\u0CCD\u0CA4\u0CC1 \u0CA4\u0CA8\u0CBF\u0C96\u0CBE\u0CA7\u0CBF\u0C95\u0CBE\u0CB0\u0CBF:** [PoliceStation in Kannada] | [Officer in Kannada] (ID: [EmployeeID])
\u{1F464} **\u0CA6\u0CC2\u0CB0\u0CC1\u0CA6\u0CBE\u0CB0\u0CB0\u0CC1:** [Complainant in Kannada]
\u{1F6A8} **\u0C86\u0CB0\u0CCB\u0CAA\u0CBF\u0C97\u0CB3\u0CC1:** [AccusedNames in Kannada]
\u{1F4CA} **\u0CAA\u0CCD\u0CB0\u0CB8\u0CCD\u0CA4\u0CC1\u0CA4 \u0CB8\u0CCD\u0CA5\u0CBF\u0CA4\u0CBF:** [Status in Kannada] | \u0CA8\u0CCD\u0CAF\u0CBE\u0CAF\u0CBE\u0CB2\u0CAF: [Court in Kannada] | \u0C9A\u0CBE\u0CB0\u0CCD\u0C9C\u0CCD\u200C\u0CB6\u0CC0\u0C9F\u0CCD: [ChargesheetStatus in Kannada]
\u{1F4C5} **\u0CB8\u0CAE\u0CAF\u0CBE\u0CB5\u0CA7\u0CBF:** \u0C98\u0C9F\u0CA8\u0CC6: [IncidentFromDate] | \u0CA8\u0CCB\u0C82\u0CA6\u0CA3\u0CBF \u0CA6\u0CBF\u0CA8\u0CBE\u0C82\u0C95: [CrimeRegisteredDate]
\u{1F4DD} **\u0CB8\u0C82\u0C95\u0CCD\u0CB7\u0CBF\u0CAA\u0CCD\u0CA4 \u0CB8\u0CBE\u0CB0\u0CBE\u0C82\u0CB6:** [1-2 \u0CB5\u0CBE\u0C95\u0CCD\u0CAF\u0C97\u0CB3\u0CB2\u0CCD\u0CB2\u0CBF \u0CB8\u0C82\u0CAA\u0CC2\u0CB0\u0CCD\u0CA3 \u0C98\u0C9F\u0CA8\u0CC6\u0CAF \u0CB8\u0CCD\u0CAA\u0CB7\u0CCD\u0C9F \u0C95\u0CA8\u0CCD\u0CA8\u0CA1 \u0CB8\u0CBE\u0CB0\u0CBE\u0C82\u0CB6]

Verified Case System Context:
"""
${formattedContext}
"""

User Query: "${question}"
` : `
You are the official Karnataka Police Copilot AI Assistant. Your task is to intelligently fulfill the user's request using the verified database records provided below.

SYSTEM DATABASE OVERVIEW:
- Total cases recorded in database: ${totalSystemCount}
- Total cases recorded today (${todayStr}): ${todayCount}
- Total cases matching this request: ${finalFilteredRows.length}

INTENT DETECTION & RESPONSE PROTOCOLS:
1. LANGUAGE CONSTRAINT: You must read, process, and respond EXCLUSIVELY in English.
2. CONCISE & HIGHLY READABLE SUMMARY (AT A GLANCE):
   - Present ONLY the key, relevant, and important case details. Make it understandable at a single glance.
   - Answer query count questions directly (e.g. "Total cases matching request: ${finalFilteredRows.length}").
   - Do NOT print long multi-section templates with blank ID fields or raw numeric IDs.

For single or multiple cases, list each case using this clean layout:
\u{1F4CC} **Case Number:** [CaseNo] (Crime No: [CrimeNo])
\u{1F3F7}\uFE0F **Offence:** [CrimeHead] - [CrimeSubHead] ([Gravity])
\u{1F3DB}\uFE0F **Station & IO:** [PoliceStation] | [OfficerRank] [Officer] (ID: [EmployeeID])
\u{1F464} **Complainant:** [Complainant]
\u{1F6A8} **Accused:** [AccusedNames]
\u{1F4CA} **Status:** [Status] | Court: [Court] | Chargesheet: [ChargesheetStatus]
\u{1F4C5} **Timeline:** Incident: [IncidentFromDate] | Registered: [CrimeRegisteredDate]
\u{1F4DD} **Summary:** [1-2 sentences summarizing the core incident facts clearly and concisely]

Verified Case System Context:
"""
${formattedContext}
"""

User Query: "${question}"
`;
    return await generateWithFallback(prompt);
  } catch (err) {
    console.error(`[Copilot Engine Critical Exception Error State]:`, err);
    return "Error: Backend generation cycle interrupted due to rate constraints or database network issues. Please try again.";
  }
}

// server/chatPlugin.mjs
dns2.setDefaultResultOrder("ipv4first");
function normalizeCrimeNo3(str) {
  if (!str) return "";
  const cleaned = String(str).trim().toUpperCase().replace(/^CR-?/i, "");
  const parts = cleaned.split("/");
  if (parts.length === 2) {
    const seq = parts[0].replace(/^0+/, "");
    return `${seq}/${parts[1]}`;
  }
  return cleaned;
}
function readBody2(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}
async function handleChatApi(req, res, next) {
  const url = new URL(req.url || "/", "http://local-chat");
  if (req.method === "POST" && url.pathname === "/api/chat") {
    try {
      const { question, role, stationId, language } = await readBody2(req);
      const crimeNoRegex = /(?:CR-?)?\b\d{1,4}\/\d{4}\b/gi;
      const normalizedQuestion = String(question || "").replace(crimeNoRegex, (match) => {
        return normalizeCrimeNo3(match);
      });
      const answer = await handleChatQuery({
        question,
        normalizedQuestion,
        normalizedCrimeNo: normalizeCrimeNo3(question),
        role,
        stationId,
        language
      });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, answer }));
    } catch (err) {
      console.error(err);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/login") {
    try {
      const { employeeId, firebaseAuth } = await readBody2(req);
      console.log(`[Server API] Intercepted authentication loop for Employee ID: ${employeeId}`);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        ok: true,
        name: `Officer ${employeeId?.split("-").pop() || employeeId}`,
        isFirstLogin: !firebaseAuth
      }));
    } catch (err) {
      console.error(err);
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: err.message || "Invalid payload verification parameters." }));
    }
    return;
  }
  next();
}
function chatPlugin() {
  return {
    name: "chat-copilot-api",
    configureServer(server) {
      server.middlewares.use(handleChatApi);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleChatApi);
    }
  };
}
var chatPlugin_default = chatPlugin;

// vite.config.ts
var vite_config_default = defineConfig({
  plugins: [
    react(),
    localDbPlugin_default(),
    chatPlugin_default()
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:5173",
        changeOrigin: true,
        bypass: (req) => {
          const url = req.url || "";
          if (url.startsWith("/api")) {
            return url;
          }
        }
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiLCAic2VydmVyL2dvb2dsZVNoZWV0cy5tanMiLCAic2VydmVyL2xvY2FsRGJQbHVnaW4ubWpzIiwgInNlcnZlci9jaGF0UGx1Z2luLm1qcyIsICJzZXJ2ZXIvZ2VtaW5pU2VydmljZS5tanMiLCAic2VydmVyL3NoZWV0c1N0b3JlLm1qcyIsICJzZXJ2ZXIvcmJhYy5tanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxrc3BwXFxcXG1sXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJEOlxcXFxrc3BwXFxcXG1sXFxcXHZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9EOi9rc3BwL21sL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XHJcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XHJcbmltcG9ydCBsb2NhbERiUGx1Z2luIGZyb20gJy4vc2VydmVyL2xvY2FsRGJQbHVnaW4ubWpzJztcclxuaW1wb3J0IGNoYXRQbHVnaW4gZnJvbSAnLi9zZXJ2ZXIvY2hhdFBsdWdpbi5tanMnO1xyXG5cclxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcclxuICBwbHVnaW5zOiBbXHJcbiAgICByZWFjdCgpLFxyXG4gICAgbG9jYWxEYlBsdWdpbigpLFxyXG4gICAgY2hhdFBsdWdpbigpXHJcbiAgXSxcclxuICBzZXJ2ZXI6IHtcclxuICAgIHBvcnQ6IDUxNzMsXHJcbiAgICBwcm94eToge1xyXG4gICAgICAnL2FwaSc6IHtcclxuICAgICAgICB0YXJnZXQ6ICdodHRwOi8vbG9jYWxob3N0OjUxNzMnLFxyXG4gICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcclxuICAgICAgICBieXBhc3M6IChyZXEpID0+IHtcclxuICAgICAgICAgIGNvbnN0IHVybCA9IHJlcS51cmwgfHwgJyc7XHJcbiAgICAgICAgICBpZiAodXJsLnN0YXJ0c1dpdGgoJy9hcGknKSkge1xyXG4gICAgICAgICAgICByZXR1cm4gdXJsOyAvLyBCeXBhc3MgcHJveHkgZm9yIGFsbCAvYXBpIGVuZHBvaW50cyB0byBsZXQgVml0ZSBzZXJ2ZXIgcGx1Z2lucyBoYW5kbGUgdGhlbSBpbiBtZW1vcnlcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcbn0pO1xyXG5cclxuIiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxrc3BwXFxcXG1sXFxcXHNlcnZlclwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRDpcXFxca3NwcFxcXFxtbFxcXFxzZXJ2ZXJcXFxcZ29vZ2xlU2hlZXRzLm1qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vRDova3NwcC9tbC9zZXJ2ZXIvZ29vZ2xlU2hlZXRzLm1qc1wiO2ltcG9ydCBjcnlwdG8gZnJvbSBcIm5vZGU6Y3J5cHRvXCI7XHJcbmltcG9ydCBmcyBmcm9tIFwibm9kZTpmc1wiO1xyXG5pbXBvcnQgcGF0aCBmcm9tIFwibm9kZTpwYXRoXCI7XHJcbmltcG9ydCBcImRvdGVudi9jb25maWdcIjtcclxuXHJcbi8vIENyZWRlbnRpYWxzIGFyZSBkZWxpYmVyYXRlbHkgc2VydmVyLW9ubHkuICBUaGUgc2VydmljZS1hY2NvdW50IGUtbWFpbCBhbG9uZVxyXG4vLyBjYW5ub3QgYXV0aGVudGljYXRlIHRvIEdvb2dsZTsgc2V0IENBVEFMWVNUX1NFUlZJQ0VfQUNDT1VOVF9KU09OIHRvIHRoZSBKU09OXHJcbi8vIGtleSAob3IgYSBwYXRoIHRvIGl0KSBmb3IgY2F0YWx5c3Qtc3luY0BrYXJuYXRha2FzdGF0ZXBvbGljZS5pYW0uZ3NlcnZpY2VhY2NvdW50LmNvbS5cclxuY29uc3QgU0NPUEVTID0gXCJodHRwczovL3d3dy5nb29nbGVhcGlzLmNvbS9hdXRoL3NwcmVhZHNoZWV0c1wiO1xyXG5jb25zdCBNQVNURVJfU0hFRVRfSUQgPSBwcm9jZXNzLmVudi5HT09HTEVfTUFTVEVSX1NIRUVUX0lEIHx8IHByb2Nlc3MuZW52LkdPT0dMRV9TSEVFVF9JRCB8fCBcIjFzRXhDT09WSkRUNko2OERNOTNFX1FQYlpHc18tUnpQT2xmWEFDWWQ4bVM0XCI7XHJcbmNvbnN0IENPTlNPTElEQVRFRF9TSEVFVF9JRCA9IHByb2Nlc3MuZW52LkdPT0dMRV9DT05TT0xJREFURURfU0hFRVRfSUQgfHwgXCIxdXl6VmdDQVBaVzlDa3prTkhGS0gwUU9KbV9uYm41U3I0dWw5bmd2MFpvTVwiO1xyXG5cclxuY29uc3QgYjY0dXJsID0gKHZhbHVlKSA9PiBCdWZmZXIuZnJvbSh2YWx1ZSkudG9TdHJpbmcoXCJiYXNlNjR1cmxcIik7XHJcbmNvbnN0IHF1b3RlUmFuZ2UgPSAodGFiLCByYW5nZSA9IFwiQTpaWlwiKSA9PiBlbmNvZGVVUklDb21wb25lbnQoYCcke3RhYi5yZXBsYWNlKC8nL2csIFwiJydcIil9JyEke3JhbmdlfWApO1xyXG5cclxuZnVuY3Rpb24gcmVzb2x2ZUNyZWRlbnRpYWxTb3VyY2UoY29uZmlndXJlZCkge1xyXG4gIGNvbnN0IHJhdyA9IGNvbmZpZ3VyZWQudHJpbSgpO1xyXG4gIGlmIChyYXcuc3RhcnRzV2l0aChcIntcIikpIHJldHVybiByYXc7XHJcblxyXG4gIGNvbnN0IGNhbmRpZGF0ZXMgPSBbcGF0aC5yZXNvbHZlKHJhdyldO1xyXG4gIGZvciAoY29uc3QgZmFsbGJhY2sgb2YgW1wic2VydmljZS1hY2NvdW50Lmpzb25cIiwgXCJjb25maWcvc2VydmljZS1hY2NvdW50Lmpzb25cIiwgXCJsb2NhbF9kYi9zZXJ2aWNlX2FjY291bnQuanNvblwiXSkge1xyXG4gICAgY29uc3QgcmVzb2x2ZWQgPSBwYXRoLnJlc29sdmUoZmFsbGJhY2spO1xyXG4gICAgaWYgKCFjYW5kaWRhdGVzLmluY2x1ZGVzKHJlc29sdmVkKSkgY2FuZGlkYXRlcy5wdXNoKHJlc29sdmVkKTtcclxuICB9XHJcblxyXG4gIGNvbnN0IGZvdW5kID0gY2FuZGlkYXRlcy5maW5kKChjYW5kaWRhdGUpID0+IGZzLmV4aXN0c1N5bmMoY2FuZGlkYXRlKSk7XHJcbiAgaWYgKCFmb3VuZCkge1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKFxyXG4gICAgICBgR29vZ2xlIFNoZWV0cyBjcmVkZW50aWFscyBmaWxlIG5vdCBmb3VuZC4gU2V0IEdPT0dMRV9TRVJWSUNFX0FDQ09VTlRfSlNPTiBpbiAuZW52IHRvIHRoZSBKU09OIGtleSBvciBhIHZhbGlkIGZpbGUgcGF0aC4gQ2hlY2tlZDogJHtjYW5kaWRhdGVzLmpvaW4oXCIsIFwiKX1gLFxyXG4gICAgKTtcclxuICB9XHJcbiAgcmV0dXJuIGZzLnJlYWRGaWxlU3luYyhmb3VuZCwgXCJ1dGY4XCIpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjcmVkZW50aWFsKCkge1xyXG4gIGxldCBjb25maWd1cmVkID0gcHJvY2Vzcy5lbnYuQ0FUQUxZU1RfU0VSVklDRV9BQ0NPVU5UX0pTT04gfHwgcHJvY2Vzcy5lbnYuR09PR0xFX1NFUlZJQ0VfQUNDT1VOVF9KU09OO1xyXG4gIFxyXG4gIGlmICghY29uZmlndXJlZCkge1xyXG4gICAgZm9yIChjb25zdCBmYWxsYmFjayBvZiBbXCJzZXJ2aWNlLWFjY291bnQuanNvblwiLCBcImNvbmZpZy9zZXJ2aWNlLWFjY291bnQuanNvblwiLCBcImxvY2FsX2RiL3NlcnZpY2VfYWNjb3VudC5qc29uXCJdKSB7XHJcbiAgICAgIGNvbnN0IHJlc29sdmVkID0gcGF0aC5yZXNvbHZlKGZhbGxiYWNrKTtcclxuICAgICAgaWYgKGZzLmV4aXN0c1N5bmMocmVzb2x2ZWQpKSB7XHJcbiAgICAgICAgY29uZmlndXJlZCA9IHJlc29sdmVkO1xyXG4gICAgICAgIGJyZWFrO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBpZiAoIWNvbmZpZ3VyZWQpIHtcclxuICAgIHRocm93IG5ldyBFcnJvcihcIkdvb2dsZSBTaGVldHMgaXMgbm90IGNvbmZpZ3VyZWQuIFBsZWFzZSBhZGQgdGhlIHNlcnZpY2UtYWNjb3VudCBKU09OIGtleSBkaXJlY3RseSBhcyBHT09HTEVfU0VSVklDRV9BQ0NPVU5UX0pTT04gdG8geW91ciAuZW52IGZpbGUuXCIpO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgcmF3ID0gcmVzb2x2ZUNyZWRlbnRpYWxTb3VyY2UoY29uZmlndXJlZCk7XHJcbiAgY29uc3QgYWNjb3VudCA9IEpTT04ucGFyc2UocmF3KTtcclxuICAvLyBBbGxvdyB0aGUgc3BlY2lmaWMgc2hlZXQtMTU4IGFjY291bnQgdGhleSBwcm92aWRlZCBvciB0aGUgY2F0YWx5c3Qtc3luYyBvbmVcclxuICBpZiAoXHJcbiAgICBhY2NvdW50LmNsaWVudF9lbWFpbCAhPT0gXCJjYXRhbHlzdC1zeW5jQGthcm5hdGFrYXN0YXRlcG9saWNlLmlhbS5nc2VydmljZWFjY291bnQuY29tXCIgJiZcclxuICAgIGFjY291bnQuY2xpZW50X2VtYWlsICE9PSBcInNoZWV0LTE1OEBrYXJuYXRha2FzdGF0ZXBvbGljZS5pYW0uZ3NlcnZpY2VhY2NvdW50LmNvbVwiXHJcbiAgKSB7XHJcbiAgICBjb25zb2xlLndhcm4oXCJXYXJuaW5nOiBVc2luZyBzZXJ2aWNlIGFjY291bnQgZW1haWw6XCIsIGFjY291bnQuY2xpZW50X2VtYWlsKTtcclxuICB9XHJcbiAgcmV0dXJuIGFjY291bnQ7XHJcbn1cclxuXHJcbmxldCB0b2tlbkNhY2hlID0geyB0b2tlbjogXCJcIiwgZXhwaXJlc0F0OiAwIH07XHJcbmFzeW5jIGZ1bmN0aW9uIHRva2VuKCkge1xyXG4gIGlmICh0b2tlbkNhY2hlLnRva2VuICYmIHRva2VuQ2FjaGUuZXhwaXJlc0F0ID4gRGF0ZS5ub3coKSArIDYwXzAwMCkgcmV0dXJuIHRva2VuQ2FjaGUudG9rZW47XHJcbiAgY29uc3QgYWNjb3VudCA9IGNyZWRlbnRpYWwoKTtcclxuICBjb25zdCBub3cgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKTtcclxuICBjb25zdCBoZWFkZXIgPSBiNjR1cmwoSlNPTi5zdHJpbmdpZnkoeyBhbGc6IFwiUlMyNTZcIiwgdHlwOiBcIkpXVFwiIH0pKTtcclxuICBjb25zdCBwYXlsb2FkID0gYjY0dXJsKEpTT04uc3RyaW5naWZ5KHsgaXNzOiBhY2NvdW50LmNsaWVudF9lbWFpbCwgc2NvcGU6IFNDT1BFUywgYXVkOiBcImh0dHBzOi8vb2F1dGgyLmdvb2dsZWFwaXMuY29tL3Rva2VuXCIsIGlhdDogbm93LCBleHA6IG5vdyArIDM2MDAgfSkpO1xyXG4gIGNvbnN0IHNpZ25hdHVyZSA9IGNyeXB0by5jcmVhdGVTaWduKFwiUlNBLVNIQTI1NlwiKS51cGRhdGUoYCR7aGVhZGVyfS4ke3BheWxvYWR9YCkuZW5kKCkuc2lnbihhY2NvdW50LnByaXZhdGVfa2V5LCBcImJhc2U2NHVybFwiKTtcclxuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKFwiaHR0cHM6Ly9vYXV0aDIuZ29vZ2xlYXBpcy5jb20vdG9rZW5cIiwgeyBtZXRob2Q6IFwiUE9TVFwiLCBoZWFkZXJzOiB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkXCIgfSwgYm9keTogbmV3IFVSTFNlYXJjaFBhcmFtcyh7IGdyYW50X3R5cGU6IFwidXJuOmlldGY6cGFyYW1zOm9hdXRoOmdyYW50LXR5cGU6and0LWJlYXJlclwiLCBhc3NlcnRpb246IGAke2hlYWRlcn0uJHtwYXlsb2FkfS4ke3NpZ25hdHVyZX1gIH0pIH0pO1xyXG4gIGNvbnN0IGRhdGEgPSBhd2FpdCByZXNwb25zZS5qc29uKCk7XHJcbiAgaWYgKCFyZXNwb25zZS5vayB8fCAhZGF0YS5hY2Nlc3NfdG9rZW4pIHRocm93IG5ldyBFcnJvcihgR29vZ2xlIGF1dGhlbnRpY2F0aW9uIGZhaWxlZDogJHtkYXRhLmVycm9yX2Rlc2NyaXB0aW9uIHx8IGRhdGEuZXJyb3IgfHwgcmVzcG9uc2Uuc3RhdHVzVGV4dH1gKTtcclxuICB0b2tlbkNhY2hlID0geyB0b2tlbjogZGF0YS5hY2Nlc3NfdG9rZW4sIGV4cGlyZXNBdDogRGF0ZS5ub3coKSArIE51bWJlcihkYXRhLmV4cGlyZXNfaW4gfHwgMzYwMCkgKiAxMDAwIH07XHJcbiAgcmV0dXJuIHRva2VuQ2FjaGUudG9rZW47XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHJlcXVlc3QodXJsLCBvcHRpb25zID0ge30pIHtcclxuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKHVybCwgeyAuLi5vcHRpb25zLCBoZWFkZXJzOiB7IEF1dGhvcml6YXRpb246IGBCZWFyZXIgJHthd2FpdCB0b2tlbigpfWAsIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLCAuLi4ob3B0aW9ucy5oZWFkZXJzIHx8IHt9KSB9IH0pO1xyXG4gIGNvbnN0IGRhdGEgPSBhd2FpdCByZXNwb25zZS5qc29uKCkuY2F0Y2goKCkgPT4gKHt9KSk7XHJcbiAgaWYgKCFyZXNwb25zZS5vaykgdGhyb3cgbmV3IEVycm9yKGBHb29nbGUgU2hlZXRzIHJlcXVlc3QgZmFpbGVkOiAke2RhdGEuZXJyb3I/Lm1lc3NhZ2UgfHwgcmVzcG9uc2Uuc3RhdHVzVGV4dH1gKTtcclxuICByZXR1cm4gZGF0YTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZW5zdXJlVGFiKHNoZWV0SWQsIHRhYikge1xyXG4gIGNvbnN0IG1ldGEgPSBhd2FpdCByZXF1ZXN0KGBodHRwczovL3NoZWV0cy5nb29nbGVhcGlzLmNvbS92NC9zcHJlYWRzaGVldHMvJHtzaGVldElkfWApO1xyXG4gIGNvbnN0IGV4aXN0cyA9IG1ldGEuc2hlZXRzPy5zb21lKChzKSA9PiBzLnByb3BlcnRpZXMudGl0bGUgPT09IHRhYik7XHJcbiAgaWYgKCFleGlzdHMpIHtcclxuICAgIGNvbnNvbGUubG9nKGBDcmVhdGluZyB0YWIgJHt0YWJ9IGluIHNwcmVhZHNoZWV0ICR7c2hlZXRJZH1gKTtcclxuICAgIGF3YWl0IHJlcXVlc3QoYGh0dHBzOi8vc2hlZXRzLmdvb2dsZWFwaXMuY29tL3Y0L3NwcmVhZHNoZWV0cy8ke3NoZWV0SWR9OmJhdGNoVXBkYXRlYCwge1xyXG4gICAgICBtZXRob2Q6IFwiUE9TVFwiLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IHJlcXVlc3RzOiBbeyBhZGRTaGVldDogeyBwcm9wZXJ0aWVzOiB7IHRpdGxlOiB0YWIgfSB9IH1dIH0pXHJcbiAgICB9KTtcclxuICB9XHJcbn1cclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWFkVGFibGUoc2hlZXRJZCwgdGFiKSB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXF1ZXN0KGBodHRwczovL3NoZWV0cy5nb29nbGVhcGlzLmNvbS92NC9zcHJlYWRzaGVldHMvJHtzaGVldElkfS92YWx1ZXMvJHtxdW90ZVJhbmdlKHRhYil9YCk7XHJcbiAgICBjb25zdCB2YWx1ZXMgPSBkYXRhLnZhbHVlcyB8fCBbXTtcclxuICAgIGNvbnN0IGhlYWRlcnMgPSB2YWx1ZXNbMF0gfHwgW107XHJcbiAgICByZXR1cm4geyBoZWFkZXJzLCByb3dzOiB2YWx1ZXMuc2xpY2UoMSkuZmlsdGVyKChyb3cpID0+IHJvdy5zb21lKChjZWxsKSA9PiBTdHJpbmcoY2VsbCB8fCBcIlwiKS50cmltKCkpKS5tYXAoKHJvdykgPT4gT2JqZWN0LmZyb21FbnRyaWVzKGhlYWRlcnMubWFwKChoZWFkZXIsIGluZGV4KSA9PiBbaGVhZGVyLCBTdHJpbmcocm93W2luZGV4XSA/PyBcIlwiKV0pKSkgfTtcclxuICB9IGNhdGNoIChlcnIpIHtcclxuICAgIGlmIChlcnIubWVzc2FnZS5pbmNsdWRlcyhcIlVuYWJsZSB0byBwYXJzZSByYW5nZVwiKSkge1xyXG4gICAgICBhd2FpdCBlbnN1cmVUYWIoc2hlZXRJZCwgdGFiKTtcclxuICAgICAgcmV0dXJuIHsgaGVhZGVyczogW10sIHJvd3M6IFtdIH07XHJcbiAgICB9XHJcbiAgICB0aHJvdyBlcnI7XHJcbiAgfVxyXG59XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd3JpdGVUYWJsZShzaGVldElkLCB0YWIsIGhlYWRlcnMsIHJvd3MpIHtcclxuICBhd2FpdCBlbnN1cmVUYWIoc2hlZXRJZCwgdGFiKTtcclxuICBhd2FpdCByZXF1ZXN0KGBodHRwczovL3NoZWV0cy5nb29nbGVhcGlzLmNvbS92NC9zcHJlYWRzaGVldHMvJHtzaGVldElkfS92YWx1ZXMvJHtxdW90ZVJhbmdlKHRhYil9OmNsZWFyYCwgeyBtZXRob2Q6IFwiUE9TVFwiLCBib2R5OiBcInt9XCIgfSk7XHJcbiAgcmV0dXJuIHJlcXVlc3QoYGh0dHBzOi8vc2hlZXRzLmdvb2dsZWFwaXMuY29tL3Y0L3NwcmVhZHNoZWV0cy8ke3NoZWV0SWR9L3ZhbHVlcy8ke3F1b3RlUmFuZ2UodGFiLCBcIkExXCIpfT92YWx1ZUlucHV0T3B0aW9uPVJBV2AsIHsgbWV0aG9kOiBcIlBVVFwiLCBib2R5OiBKU09OLnN0cmluZ2lmeSh7IG1ham9yRGltZW5zaW9uOiBcIlJPV1NcIiwgdmFsdWVzOiBbaGVhZGVycywgLi4ucm93cy5tYXAoKHJvdykgPT4gaGVhZGVycy5tYXAoKGhlYWRlcikgPT4gU3RyaW5nKHJvd1toZWFkZXJdID8/IFwiXCIpKSldIH0pIH0pO1xyXG59XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gYXBwZW5kUm93KHNoZWV0SWQsIHRhYiwgcm93QXJyYXkpIHtcclxuICBhd2FpdCBlbnN1cmVUYWIoc2hlZXRJZCwgdGFiKTtcclxuICByZXR1cm4gcmVxdWVzdChgaHR0cHM6Ly9zaGVldHMuZ29vZ2xlYXBpcy5jb20vdjQvc3ByZWFkc2hlZXRzLyR7c2hlZXRJZH0vdmFsdWVzLyR7cXVvdGVSYW5nZSh0YWIsIFwiQTFcIil9OmFwcGVuZD92YWx1ZUlucHV0T3B0aW9uPVJBV2AsIHsgXHJcbiAgICBtZXRob2Q6IFwiUE9TVFwiLCBcclxuICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgbWFqb3JEaW1lbnNpb246IFwiUk9XU1wiLCB2YWx1ZXM6IFtyb3dBcnJheV0gfSkgXHJcbiAgfSk7XHJcbn1cclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB1cGRhdGVSb3coc2hlZXRJZCwgdGFiLCBzaGVldFJvd0luZGV4LCByb3dBcnJheSkge1xyXG4gIGNvbnN0IHJhbmdlID0gYCR7dGFifSFBJHtzaGVldFJvd0luZGV4fWA7XHJcbiAgcmV0dXJuIHJlcXVlc3QoYGh0dHBzOi8vc2hlZXRzLmdvb2dsZWFwaXMuY29tL3Y0L3NwcmVhZHNoZWV0cy8ke3NoZWV0SWR9L3ZhbHVlcy8ke2VuY29kZVVSSUNvbXBvbmVudChyYW5nZSl9P3ZhbHVlSW5wdXRPcHRpb249UkFXYCwge1xyXG4gICAgbWV0aG9kOiBcIlBVVFwiLFxyXG4gICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBtYWpvckRpbWVuc2lvbjogXCJST1dTXCIsIHZhbHVlczogW3Jvd0FycmF5XSB9KVxyXG4gIH0pO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZWNvcmRLZXkocm93KSB7IHJldHVybiBTdHJpbmcocm93LkNhc2VNYXN0ZXJJRCB8fCByb3cuQ2FzZU5vIHx8IHJvdy5DcmltZU5vIHx8IFwiXCIpLnRyaW0oKTsgfVxyXG5cclxuZnVuY3Rpb24gbm9ybSh2YWx1ZSkge1xyXG4gIHJldHVybiBTdHJpbmcodmFsdWUgPz8gXCJcIilcclxuICAgIC50cmltKClcclxuICAgIC50b0xvd2VyQ2FzZSgpXHJcbiAgICAucmVwbGFjZSgvJi9nLCBcIiBhbmQgXCIpXHJcbiAgICAucmVwbGFjZSgvW15hLXowLTldKy9nLCBcIiBcIilcclxuICAgIC5yZXBsYWNlKC9cXHMrL2csIFwiIFwiKVxyXG4gICAgLnRyaW0oKTtcclxufVxyXG5cclxuZnVuY3Rpb24gc3BsaXRNdWx0aSh2YWx1ZSkge1xyXG4gIGNvbnN0IHRleHQgPSBTdHJpbmcodmFsdWUgPz8gXCJcIikudHJpbSgpO1xyXG4gIGlmICghdGV4dCkgcmV0dXJuIFtdO1xyXG4gIHJldHVybiB0ZXh0LnNwbGl0KC87fFxcbi8pLm1hcCgocGFydCkgPT4gcGFydC50cmltKCkpLmZpbHRlcihCb29sZWFuKTtcclxufVxyXG5cclxuZnVuY3Rpb24gcm93S2V5KHJvdywgZmllbGQpIHtcclxuICBjb25zdCB0ZXh0ID0gU3RyaW5nKHJvd1tmaWVsZF0gPz8gXCJcIikudHJpbSgpO1xyXG4gIGlmICghdGV4dCkgcmV0dXJuIFwiXCI7XHJcbiAgY29uc3QgcGFyc2VkID0gTnVtYmVyLnBhcnNlSW50KHRleHQsIDEwKTtcclxuICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKHBhcnNlZCkgPyBTdHJpbmcocGFyc2VkKSA6IHRleHQ7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG1heE51bWVyaWNJZChyb3dzLCBmaWVsZCkge1xyXG4gIHJldHVybiByb3dzLnJlZHVjZSgobWF4LCByb3cpID0+IHtcclxuICAgIGNvbnN0IHBhcnNlZCA9IE51bWJlci5wYXJzZUludChyb3dLZXkocm93LCBmaWVsZCksIDEwKTtcclxuICAgIHJldHVybiBOdW1iZXIuaXNGaW5pdGUocGFyc2VkKSA/IE1hdGgubWF4KG1heCwgcGFyc2VkKSA6IG1heDtcclxuICB9LCAwKTtcclxufVxyXG5cclxuZnVuY3Rpb24gbWFrZUlkQWxsb2NhdG9yKHJvd3MsIGZpZWxkKSB7XHJcbiAgbGV0IGN1cnJlbnQgPSBtYXhOdW1lcmljSWQocm93cywgZmllbGQpO1xyXG4gIHJldHVybiAoKSA9PiB7XHJcbiAgICBjdXJyZW50ICs9IDE7XHJcbiAgICByZXR1cm4gU3RyaW5nKGN1cnJlbnQpO1xyXG4gIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGVtcHR5UmVjb3JkKGhlYWRlcnMpIHtcclxuICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKGhlYWRlcnMubWFwKChoZWFkZXIpID0+IFtoZWFkZXIsIFwiXCJdKSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHNldENlbGwocmVjb3JkLCBoZWFkZXIsIHZhbHVlKSB7XHJcbiAgaWYgKGhlYWRlciBpbiByZWNvcmQpIHJlY29yZFtoZWFkZXJdID0gU3RyaW5nKHZhbHVlID8/IFwiXCIpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjb3B5UHJlc2VydmVkKHJlY29yZCwgZXhpc3RpbmcsIGZpZWxkcykge1xyXG4gIGlmICghZXhpc3RpbmcpIHJldHVybjtcclxuICBmb3IgKGNvbnN0IGZpZWxkIG9mIGZpZWxkcykge1xyXG4gICAgaWYgKGZpZWxkIGluIHJlY29yZCAmJiAhU3RyaW5nKHJlY29yZFtmaWVsZF0gPz8gXCJcIikudHJpbSgpKSB7XHJcbiAgICAgIHJlY29yZFtmaWVsZF0gPSBTdHJpbmcoZXhpc3RpbmdbZmllbGRdID8/IFwiXCIpO1xyXG4gICAgfVxyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gZXhpc3RpbmdCeUNhc2VBbmROYW1lKHJvd3MsIG5hbWVGaWVsZCkge1xyXG4gIGNvbnN0IHJlc3VsdCA9IG5ldyBNYXAoKTtcclxuICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XHJcbiAgICBjb25zdCBjYXNlSWQgPSByb3dLZXkocm93LCBcIkNhc2VNYXN0ZXJJRFwiKTtcclxuICAgIGNvbnN0IG5hbWUgPSBub3JtKHJvd1tuYW1lRmllbGRdKTtcclxuICAgIGlmIChjYXNlSWQgJiYgbmFtZSkgcmVzdWx0LnNldChgJHtjYXNlSWR9Ojoke25hbWV9YCwgcm93KTtcclxuICB9XHJcbiAgcmV0dXJuIHJlc3VsdDtcclxufVxyXG5cclxuZnVuY3Rpb24gcmVwbGFjZUNoaWxkQ2FzZXMoZXhpc3RpbmdSb3dzLCBuZXdSb3dzLCBjYXNlSWQpIHtcclxuICBjb25zdCBrZXB0ID0gZXhpc3RpbmdSb3dzLmZpbHRlcigocm93KSA9PiByb3dLZXkocm93LCBcIkNhc2VNYXN0ZXJJRFwiKSAhPT0gY2FzZUlkKTtcclxuICByZXR1cm4ga2VwdC5jb25jYXQobmV3Um93cyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGJ1aWxkQWNjdXNlZFJvd3MocmVjb3JkLCB0YWJsZSkge1xyXG4gIGNvbnN0IGNhc2VJZCA9IHJvd0tleShyZWNvcmQsIFwiQ2FzZU1hc3RlcklEXCIpO1xyXG4gIGlmICghY2FzZUlkKSByZXR1cm4gW107XHJcblxyXG4gIGNvbnN0IGV4aXN0aW5nID0gZXhpc3RpbmdCeUNhc2VBbmROYW1lKHRhYmxlLnJvd3MsIFwiQWNjdXNlZE5hbWVcIik7XHJcbiAgY29uc3QgbmV4dElkID0gbWFrZUlkQWxsb2NhdG9yKHRhYmxlLnJvd3MsIFwiQWNjdXNlZE1hc3RlcklEXCIpO1xyXG4gIGNvbnN0IHJvd3MgPSBbXTtcclxuXHJcbiAgZm9yIChjb25zdCBuYW1lIG9mIHNwbGl0TXVsdGkocmVjb3JkLkFjY3VzZWROYW1lcykpIHtcclxuICAgIGNvbnN0IG9sZCA9IGV4aXN0aW5nLmdldChgJHtjYXNlSWR9Ojoke25vcm0obmFtZSl9YCk7XHJcbiAgICBjb25zdCBhY2N1c2VkSWQgPSByb3dLZXkob2xkIHx8IHt9LCBcIkFjY3VzZWRNYXN0ZXJJRFwiKSB8fCBuZXh0SWQoKTtcclxuICAgIGNvbnN0IHJvdyA9IGVtcHR5UmVjb3JkKHRhYmxlLmhlYWRlcnMpO1xyXG4gICAgc2V0Q2VsbChyb3csIFwiQWNjdXNlZE1hc3RlcklEXCIsIGFjY3VzZWRJZCk7XHJcbiAgICBzZXRDZWxsKHJvdywgXCJDYXNlTWFzdGVySURcIiwgY2FzZUlkKTtcclxuICAgIHNldENlbGwocm93LCBcIkFjY3VzZWROYW1lXCIsIG5hbWUpO1xyXG4gICAgY29weVByZXNlcnZlZChyb3csIG9sZCwgW1wiQWdlWWVhclwiLCBcIkdlbmRlcklEXCIsIFwiUGVyc29uSURcIl0pO1xyXG4gICAgcm93cy5wdXNoKHJvdyk7XHJcbiAgfVxyXG5cclxuICByZXR1cm4gcm93cztcclxufVxyXG5cclxuZnVuY3Rpb24gYnVpbGRWaWN0aW1Sb3dzKHJlY29yZCwgdGFibGUpIHtcclxuICBjb25zdCBjYXNlSWQgPSByb3dLZXkocmVjb3JkLCBcIkNhc2VNYXN0ZXJJRFwiKTtcclxuICBpZiAoIWNhc2VJZCkgcmV0dXJuIFtdO1xyXG5cclxuICBjb25zdCBleGlzdGluZyA9IGV4aXN0aW5nQnlDYXNlQW5kTmFtZSh0YWJsZS5yb3dzLCBcIlZpY3RpbU5hbWVcIik7XHJcbiAgY29uc3QgbmV4dElkID0gbWFrZUlkQWxsb2NhdG9yKHRhYmxlLnJvd3MsIFwiVmljdGltTWFzdGVySURcIik7XHJcbiAgY29uc3Qgcm93cyA9IFtdO1xyXG5cclxuICBmb3IgKGNvbnN0IG5hbWUgb2Ygc3BsaXRNdWx0aShyZWNvcmQuVmljdGltTmFtZXMpKSB7XHJcbiAgICBjb25zdCBvbGQgPSBleGlzdGluZy5nZXQoYCR7Y2FzZUlkfTo6JHtub3JtKG5hbWUpfWApO1xyXG4gICAgY29uc3Qgcm93ID0gZW1wdHlSZWNvcmQodGFibGUuaGVhZGVycyk7XHJcbiAgICBzZXRDZWxsKHJvdywgXCJWaWN0aW1NYXN0ZXJJRFwiLCByb3dLZXkob2xkIHx8IHt9LCBcIlZpY3RpbU1hc3RlcklEXCIpIHx8IG5leHRJZCgpKTtcclxuICAgIHNldENlbGwocm93LCBcIkNhc2VNYXN0ZXJJRFwiLCBjYXNlSWQpO1xyXG4gICAgc2V0Q2VsbChyb3csIFwiVmljdGltTmFtZVwiLCBuYW1lKTtcclxuICAgIGNvcHlQcmVzZXJ2ZWQocm93LCBvbGQsIFtcIkFnZVllYXJcIiwgXCJHZW5kZXJJRFwiLCBcIlZpY3RpbVBvbGljZVwiXSk7XHJcbiAgICByb3dzLnB1c2gocm93KTtcclxuICB9XHJcblxyXG4gIHJldHVybiByb3dzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBidWlsZENvbXBsYWluYW50Um93cyhyZWNvcmQsIHRhYmxlKSB7XHJcbiAgY29uc3QgY2FzZUlkID0gcm93S2V5KHJlY29yZCwgXCJDYXNlTWFzdGVySURcIik7XHJcbiAgY29uc3QgbmFtZSA9IFN0cmluZyhyZWNvcmQuQ29tcGxhaW5hbnQgPz8gXCJcIikudHJpbSgpO1xyXG4gIGlmICghY2FzZUlkIHx8ICFuYW1lKSByZXR1cm4gW107XHJcblxyXG4gIGNvbnN0IGV4aXN0aW5nID0gZXhpc3RpbmdCeUNhc2VBbmROYW1lKHRhYmxlLnJvd3MsIFwiQ29tcGxhaW5hbnROYW1lXCIpO1xyXG4gIGNvbnN0IG5leHRJZCA9IG1ha2VJZEFsbG9jYXRvcih0YWJsZS5yb3dzLCBcIkNvbXBsYWluYW50SURcIik7XHJcbiAgY29uc3Qgb2xkID0gZXhpc3RpbmcuZ2V0KGAke2Nhc2VJZH06OiR7bm9ybShuYW1lKX1gKTtcclxuICBjb25zdCByb3cgPSBlbXB0eVJlY29yZCh0YWJsZS5oZWFkZXJzKTtcclxuICBzZXRDZWxsKHJvdywgXCJDb21wbGFpbmFudElEXCIsIHJvd0tleShvbGQgfHwge30sIFwiQ29tcGxhaW5hbnRJRFwiKSB8fCBuZXh0SWQoKSk7XHJcbiAgc2V0Q2VsbChyb3csIFwiQ2FzZU1hc3RlcklEXCIsIGNhc2VJZCk7XHJcbiAgc2V0Q2VsbChyb3csIFwiQ29tcGxhaW5hbnROYW1lXCIsIG5hbWUpO1xyXG4gIGNvcHlQcmVzZXJ2ZWQocm93LCBvbGQsIFtcIkFnZVllYXJcIiwgXCJPY2N1cGF0aW9uSURcIiwgXCJSZWxpZ2lvbklEXCIsIFwiQ2FzdGVJRFwiLCBcIkdlbmRlcklEXCJdKTtcclxuICByZXR1cm4gW3Jvd107XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHN5bmNDaGlsZFRhYnMocmVjb3JkKSB7XHJcbiAgY29uc3QgY2FzZUlkID0gcm93S2V5KHJlY29yZCwgXCJDYXNlTWFzdGVySURcIik7XHJcbiAgaWYgKCFjYXNlSWQpIHJldHVybjtcclxuXHJcbiAgY29uc3QgW2FjY3VzZWQsIHZpY3RpbXMsIGNvbXBsYWluYW50c10gPSBhd2FpdCBQcm9taXNlLmFsbChbXHJcbiAgICByZWFkVGFibGUoTUFTVEVSX1NIRUVUX0lELCBcIkFjY3VzZWRcIiksXHJcbiAgICByZWFkVGFibGUoTUFTVEVSX1NIRUVUX0lELCBcIlZpY3RpbVwiKSxcclxuICAgIHJlYWRUYWJsZShNQVNURVJfU0hFRVRfSUQsIFwiQ29tcGxhaW5hbnREZXRhaWxzXCIpLFxyXG4gIF0pO1xyXG5cclxuICBjb25zdCBhY2N1c2VkSGVhZGVycyA9IGFjY3VzZWQuaGVhZGVycy5sZW5ndGggPyBhY2N1c2VkLmhlYWRlcnMgOiBbXCJBY2N1c2VkTWFzdGVySURcIiwgXCJDYXNlTWFzdGVySURcIiwgXCJBY2N1c2VkTmFtZVwiXTtcclxuICBjb25zdCB2aWN0aW1IZWFkZXJzID0gdmljdGltcy5oZWFkZXJzLmxlbmd0aCA/IHZpY3RpbXMuaGVhZGVycyA6IFtcIlZpY3RpbU1hc3RlcklEXCIsIFwiQ2FzZU1hc3RlcklEXCIsIFwiVmljdGltTmFtZVwiXTtcclxuICBjb25zdCBjb21wbGFpbmFudEhlYWRlcnMgPSBjb21wbGFpbmFudHMuaGVhZGVycy5sZW5ndGhcclxuICAgID8gY29tcGxhaW5hbnRzLmhlYWRlcnNcclxuICAgIDogW1wiQ29tcGxhaW5hbnRJRFwiLCBcIkNhc2VNYXN0ZXJJRFwiLCBcIkNvbXBsYWluYW50TmFtZVwiXTtcclxuXHJcbiAgY29uc3QgYWNjdXNlZFRhYmxlID0geyBoZWFkZXJzOiBhY2N1c2VkSGVhZGVycywgcm93czogYWNjdXNlZC5yb3dzIH07XHJcbiAgY29uc3QgdmljdGltVGFibGUgPSB7IGhlYWRlcnM6IHZpY3RpbUhlYWRlcnMsIHJvd3M6IHZpY3RpbXMucm93cyB9O1xyXG4gIGNvbnN0IGNvbXBsYWluYW50VGFibGUgPSB7IGhlYWRlcnM6IGNvbXBsYWluYW50SGVhZGVycywgcm93czogY29tcGxhaW5hbnRzLnJvd3MgfTtcclxuXHJcbiAgY29uc3QgbmV3QWNjdXNlZCA9IGJ1aWxkQWNjdXNlZFJvd3MocmVjb3JkLCBhY2N1c2VkVGFibGUpO1xyXG4gIGNvbnN0IG5ld1ZpY3RpbXMgPSBidWlsZFZpY3RpbVJvd3MocmVjb3JkLCB2aWN0aW1UYWJsZSk7XHJcbiAgY29uc3QgbmV3Q29tcGxhaW5hbnRzID0gYnVpbGRDb21wbGFpbmFudFJvd3MocmVjb3JkLCBjb21wbGFpbmFudFRhYmxlKTtcclxuXHJcbiAgY29uc3Qgd3JpdGVzID0gW107XHJcbiAgaWYgKG5ld0FjY3VzZWQubGVuZ3RoIHx8IGFjY3VzZWQucm93cy5zb21lKChyb3cpID0+IHJvd0tleShyb3csIFwiQ2FzZU1hc3RlcklEXCIpID09PSBjYXNlSWQpKSB7XHJcbiAgICB3cml0ZXMucHVzaChcclxuICAgICAgd3JpdGVUYWJsZShcclxuICAgICAgICBNQVNURVJfU0hFRVRfSUQsXHJcbiAgICAgICAgXCJBY2N1c2VkXCIsXHJcbiAgICAgICAgYWNjdXNlZEhlYWRlcnMsXHJcbiAgICAgICAgcmVwbGFjZUNoaWxkQ2FzZXMoYWNjdXNlZC5yb3dzLCBuZXdBY2N1c2VkLCBjYXNlSWQpLFxyXG4gICAgICApLFxyXG4gICAgKTtcclxuICB9XHJcbiAgaWYgKG5ld1ZpY3RpbXMubGVuZ3RoIHx8IHZpY3RpbXMucm93cy5zb21lKChyb3cpID0+IHJvd0tleShyb3csIFwiQ2FzZU1hc3RlcklEXCIpID09PSBjYXNlSWQpKSB7XHJcbiAgICB3cml0ZXMucHVzaChcclxuICAgICAgd3JpdGVUYWJsZShcclxuICAgICAgICBNQVNURVJfU0hFRVRfSUQsXHJcbiAgICAgICAgXCJWaWN0aW1cIixcclxuICAgICAgICB2aWN0aW1IZWFkZXJzLFxyXG4gICAgICAgIHJlcGxhY2VDaGlsZENhc2VzKHZpY3RpbXMucm93cywgbmV3VmljdGltcywgY2FzZUlkKSxcclxuICAgICAgKSxcclxuICAgICk7XHJcbiAgfVxyXG4gIGlmIChuZXdDb21wbGFpbmFudHMubGVuZ3RoIHx8IGNvbXBsYWluYW50cy5yb3dzLnNvbWUoKHJvdykgPT4gcm93S2V5KHJvdywgXCJDYXNlTWFzdGVySURcIikgPT09IGNhc2VJZCkpIHtcclxuICAgIHdyaXRlcy5wdXNoKFxyXG4gICAgICB3cml0ZVRhYmxlKFxyXG4gICAgICAgIE1BU1RFUl9TSEVFVF9JRCxcclxuICAgICAgICBcIkNvbXBsYWluYW50RGV0YWlsc1wiLFxyXG4gICAgICAgIGNvbXBsYWluYW50SGVhZGVycyxcclxuICAgICAgICByZXBsYWNlQ2hpbGRDYXNlcyhjb21wbGFpbmFudHMucm93cywgbmV3Q29tcGxhaW5hbnRzLCBjYXNlSWQpLFxyXG4gICAgICApLFxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIGF3YWl0IFByb21pc2UuYWxsKHdyaXRlcyk7XHJcbn1cclxuXHJcbmxldCBjYXNlc0NhY2hlID0geyBkYXRhOiBudWxsLCBleHBpcmVzQXQ6IDAgfTtcclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNhc2VzRnJvbUdvb2dsZSgpIHsgXHJcbiAgaWYgKGNhc2VzQ2FjaGUuZGF0YSAmJiBjYXNlc0NhY2hlLmV4cGlyZXNBdCA+IERhdGUubm93KCkpIHtcclxuICAgIHJldHVybiBjYXNlc0NhY2hlLmRhdGE7XHJcbiAgfVxyXG4gIGNvbnN0IGRhdGEgPSBhd2FpdCByZWFkVGFibGUoQ09OU09MSURBVEVEX1NIRUVUX0lELCBwcm9jZXNzLmVudi5HT09HTEVfQ09OU09MSURBVEVEX1RBQiB8fCBcIkNvbnNvbGlkYXRlZF9DYXNlc1wiKTtcclxuICBjYXNlc0NhY2hlID0geyBkYXRhLCBleHBpcmVzQXQ6IERhdGUubm93KCkgKyAxNTAwMCB9O1xyXG4gIHJldHVybiBkYXRhO1xyXG59XHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB1cHNlcnRDYXNlSW5Hb29nbGUocmVjb3JkKSB7XHJcbiAgY29uc3QgdGFiID0gcHJvY2Vzcy5lbnYuR09PR0xFX0NPTlNPTElEQVRFRF9UQUIgfHwgXCJDb25zb2xpZGF0ZWRfQ2FzZXNcIjtcclxuICBjb25zdCBjb25zb2xpZGF0ZWQgPSBhd2FpdCByZWFkVGFibGUoQ09OU09MSURBVEVEX1NIRUVUX0lELCB0YWIpO1xyXG4gIFxyXG4gIGxldCBoZWFkZXJzID0gWy4uLmNvbnNvbGlkYXRlZC5oZWFkZXJzXTtcclxuICBsZXQgaGVhZGVyc0NoYW5nZWQgPSBmYWxzZTtcclxuICBpZiAoIWhlYWRlcnMubGVuZ3RoKSB7XHJcbiAgICBoZWFkZXJzID0gT2JqZWN0LmtleXMocmVjb3JkKTtcclxuICAgIGhlYWRlcnNDaGFuZ2VkID0gdHJ1ZTtcclxuICB9IGVsc2Uge1xyXG4gICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMocmVjb3JkKSkge1xyXG4gICAgICBpZiAoIWhlYWRlcnMuaW5jbHVkZXMoa2V5KSkge1xyXG4gICAgICAgIGhlYWRlcnMucHVzaChrZXkpO1xyXG4gICAgICAgIGhlYWRlcnNDaGFuZ2VkID0gdHJ1ZTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgY29uc3Qga2V5ID0gcmVjb3JkS2V5KHJlY29yZCk7XHJcbiAgY29uc3QgaW5kZXggPSBjb25zb2xpZGF0ZWQucm93cy5maW5kSW5kZXgoKHJvdykgPT4gcmVjb3JkS2V5KHJvdykgPT09IGtleSk7XHJcbiAgXHJcbiAgLy8gRmlsbCBlbXB0eSBoZWFkZXIgZ2FwcyBvciB1cGRhdGUgaGVhZGVycyByb3cgaWYgbmV3IGNvbHVtbnMgd2VyZSBhZGRlZFxyXG4gIGlmIChoZWFkZXJzQ2hhbmdlZCkge1xyXG4gICAgaWYgKGNvbnNvbGlkYXRlZC5yb3dzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICBhd2FpdCB3cml0ZVRhYmxlKENPTlNPTElEQVRFRF9TSEVFVF9JRCwgdGFiLCBoZWFkZXJzLCBbXSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBhd2FpdCB1cGRhdGVSb3coQ09OU09MSURBVEVEX1NIRUVUX0lELCB0YWIsIDEsIGhlYWRlcnMpO1xyXG4gICAgfVxyXG4gIH1cclxuICBcclxuICBjb25zdCByb3dBcnJheSA9IGhlYWRlcnMubWFwKGggPT4gU3RyaW5nKHJlY29yZFtoXSB8fCBcIlwiKSk7XHJcbiAgaWYgKGluZGV4ID49IDApIHtcclxuICAgIGF3YWl0IHVwZGF0ZVJvdyhDT05TT0xJREFURURfU0hFRVRfSUQsIHRhYiwgaW5kZXggKyAyLCByb3dBcnJheSk7XHJcbiAgfSBlbHNlIHtcclxuICAgIGF3YWl0IGFwcGVuZFJvdyhDT05TT0xJREFURURfU0hFRVRfSUQsIHRhYiwgcm93QXJyYXkpO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgbWFzdGVyID0gYXdhaXQgcmVhZFRhYmxlKE1BU1RFUl9TSEVFVF9JRCwgXCJDYXNlTWFzdGVyXCIpO1xyXG4gIGxldCBtYXN0ZXJIZWFkZXJzID0gWy4uLm1hc3Rlci5oZWFkZXJzXTtcclxuICBsZXQgbWFzdGVySGVhZGVyc0NoYW5nZWQgPSBmYWxzZTtcclxuICBcclxuICBpZiAoIW1hc3RlckhlYWRlcnMubGVuZ3RoKSB7XHJcbiAgICBtYXN0ZXJIZWFkZXJzID0gT2JqZWN0LmtleXMocmVjb3JkKTtcclxuICAgIG1hc3RlckhlYWRlcnNDaGFuZ2VkID0gdHJ1ZTtcclxuICB9IGVsc2Uge1xyXG4gICAgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKHJlY29yZCkpIHtcclxuICAgICAgaWYgKCFtYXN0ZXJIZWFkZXJzLmluY2x1ZGVzKGspKSB7XHJcbiAgICAgICAgbWFzdGVySGVhZGVycy5wdXNoKGspO1xyXG4gICAgICAgIG1hc3RlckhlYWRlcnNDaGFuZ2VkID0gdHJ1ZTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgaWYgKG1hc3RlckhlYWRlcnNDaGFuZ2VkICYmIG1hc3Rlci5yb3dzLmxlbmd0aCA+IDApIHtcclxuICAgIGF3YWl0IHVwZGF0ZVJvdyhNQVNURVJfU0hFRVRfSUQsIFwiQ2FzZU1hc3RlclwiLCAxLCBtYXN0ZXJIZWFkZXJzKTtcclxuICB9XHJcblxyXG4gIGlmIChtYXN0ZXJIZWFkZXJzLmxlbmd0aCkge1xyXG4gICAgY29uc3QgbWFzdGVyUm93QXJyYXkgPSBtYXN0ZXJIZWFkZXJzLm1hcCgoaGVhZGVyKSA9PiBTdHJpbmcocmVjb3JkW2hlYWRlcl0gfHwgXCJcIikpO1xyXG4gICAgY29uc3QgbWFzdGVySW5kZXggPSBtYXN0ZXIucm93cy5maW5kSW5kZXgoKHJvdykgPT4gcmVjb3JkS2V5KHJvdykgPT09IGtleSk7XHJcbiAgICBpZiAobWFzdGVySW5kZXggPj0gMCkge1xyXG4gICAgICBhd2FpdCB1cGRhdGVSb3coTUFTVEVSX1NIRUVUX0lELCBcIkNhc2VNYXN0ZXJcIiwgbWFzdGVySW5kZXggKyAyLCBtYXN0ZXJSb3dBcnJheSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBhd2FpdCBhcHBlbmRSb3coTUFTVEVSX1NIRUVUX0lELCBcIkNhc2VNYXN0ZXJcIiwgbWFzdGVyUm93QXJyYXkpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXdhaXQgc3luY0NoaWxkVGFicyhyZWNvcmQpO1xyXG4gIFxyXG4gIGNhc2VzQ2FjaGUgPSB7IGRhdGE6IG51bGwsIGV4cGlyZXNBdDogMCB9O1xyXG4gIHJldHVybiByZWNvcmQ7XHJcbn1cclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBlbXBsb3llZUJ5SWQoZW1wbG95ZWVJZCkge1xyXG4gIGNvbnN0IHRhYmxlID0gYXdhaXQgcmVhZFRhYmxlKE1BU1RFUl9TSEVFVF9JRCwgXCJFbXBsb3llZVwiKTtcclxuICBjb25zdCB0YXJnZXQgPSBTdHJpbmcoZW1wbG95ZWVJZCB8fCBcIlwiKS50cmltKCkudG9Mb3dlckNhc2UoKTtcclxuICBjb25zdCByYXdJZCA9IHRhcmdldC5yZXBsYWNlKC9eKGVtcHxrc3B8a2dpZClbLV9cXHNdKi9pLCBcIlwiKTtcclxuICBjb25zdCByb3cgPSB0YWJsZS5yb3dzLmZpbmQoKGl0ZW0pID0+IHtcclxuICAgIGNvbnN0IGlkID0gU3RyaW5nKGl0ZW0uRW1wbG95ZWVJRCB8fCBcIlwiKS50cmltKCkudG9Mb3dlckNhc2UoKTtcclxuICAgIGNvbnN0IGtnaWQgPSBTdHJpbmcoaXRlbS5LR0lEIHx8IFwiXCIpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgcmV0dXJuIGlkID09PSB0YXJnZXQgfHwgKHJhd0lkICYmIGlkID09PSByYXdJZCkgfHwga2dpZCA9PT0gdGFyZ2V0IHx8IChyYXdJZCAmJiBrZ2lkLnRvTG93ZXJDYXNlKCkuZW5kc1dpdGgocmF3SWQpKTtcclxuICB9KTtcclxuICByZXR1cm4geyB0YWJsZSwgcm93IH07XHJcbn1cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHVwZGF0ZUVtcGxveWVlKGVtcGxveWVlSWQsIGNoYW5nZXMpIHtcclxuICBjb25zdCB7IHRhYmxlLCByb3cgfSA9IGF3YWl0IGVtcGxveWVlQnlJZChlbXBsb3llZUlkKTtcclxuICBpZiAoIXJvdykgdGhyb3cgbmV3IEVycm9yKFwiRW1wbG95ZWUgd2FzIG5vdCBmb3VuZCBpbiB0aGUgRW1wbG95ZWUgc2hlZXQuXCIpO1xyXG4gIGNvbnN0IGluZGV4ID0gdGFibGUucm93cy5pbmRleE9mKHJvdyk7XHJcbiAgdGFibGUucm93c1tpbmRleF0gPSB7IC4uLnJvdywgLi4uY2hhbmdlcyB9O1xyXG4gIFxyXG4gIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGNoYW5nZXMpKSB7XHJcbiAgICBpZiAoIXRhYmxlLmhlYWRlcnMuaW5jbHVkZXMoa2V5KSkge1xyXG4gICAgICB0YWJsZS5oZWFkZXJzLnB1c2goa2V5KTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGF3YWl0IHdyaXRlVGFibGUoTUFTVEVSX1NIRUVUX0lELCBcIkVtcGxveWVlXCIsIHRhYmxlLmhlYWRlcnMsIHRhYmxlLnJvd3MpO1xyXG4gIHJldHVybiB0YWJsZS5yb3dzW2luZGV4XTtcclxufSIsICJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiRDpcXFxca3NwcFxcXFxtbFxcXFxzZXJ2ZXJcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkQ6XFxcXGtzcHBcXFxcbWxcXFxcc2VydmVyXFxcXGxvY2FsRGJQbHVnaW4ubWpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9EOi9rc3BwL21sL3NlcnZlci9sb2NhbERiUGx1Z2luLm1qc1wiO2ltcG9ydCB7IGNhc2VzRnJvbUdvb2dsZSwgdXBzZXJ0Q2FzZUluR29vZ2xlLCBlbXBsb3llZUJ5SWQsIHVwZGF0ZUVtcGxveWVlLCB3cml0ZVRhYmxlLCByZWFkVGFibGUgfSBmcm9tIFwiLi9nb29nbGVTaGVldHMubWpzXCI7XHJcbmltcG9ydCB7IGV4ZWNGaWxlIH0gZnJvbSBcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiO1xyXG5pbXBvcnQgeyBwcm9taXNpZnkgfSBmcm9tIFwibm9kZTp1dGlsXCI7XHJcbmltcG9ydCBwYXRoIGZyb20gXCJub2RlOnBhdGhcIjtcclxuaW1wb3J0IGZzIGZyb20gXCJub2RlOmZzXCI7XHJcbmltcG9ydCB7IHBhcnNlIH0gZnJvbSBcImNzdi1wYXJzZS9zeW5jXCI7XHJcblxyXG5jb25zdCBleGVjRmlsZUFzeW5jID0gcHJvbWlzaWZ5KGV4ZWNGaWxlKTtcclxuXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZVZhbHVlKHZhbHVlKSB7XHJcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBcIlwiO1xyXG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xyXG4gICAgcmV0dXJuIHZhbHVlLm1hcCgoaXRlbSkgPT4gU3RyaW5nKGl0ZW0pLnRyaW0oKSkuZmlsdGVyKEJvb2xlYW4pLmpvaW4oXCI7IFwiKTtcclxuICB9XHJcbiAgcmV0dXJuIFN0cmluZyh2YWx1ZSkudHJpbSgpO1xyXG59XHJcblxyXG4vKipcclxuICogTm9ybWFsaXplcyBjcmltZSBudW1iZXJzIGZvciBmbGV4aWJsZSBtYXRjaGluZy5cclxuICogRS5nLiwgXCJDUi0wMDExLzIwMjZcIiwgXCIwMDExLzIwMjZcIiwgYW5kIFwiMTEvMjAyNlwiIGFsbCBub3JtYWxpemUgdG8gXCIxMS8yMDI2XCIuXHJcbiAqL1xyXG5mdW5jdGlvbiBub3JtYWxpemVDcmltZU5vKHN0cikge1xyXG4gIGlmICghc3RyKSByZXR1cm4gXCJcIjtcclxuICBjb25zdCBjbGVhbmVkID0gU3RyaW5nKHN0cilcclxuICAgIC50cmltKClcclxuICAgIC50b1VwcGVyQ2FzZSgpXHJcbiAgICAucmVwbGFjZSgvXkNSLT8vaSwgXCJcIik7IC8vIFN0cmlwIGxlYWRpbmcgXCJDUi1cIiBvciBcIkNSXCJcclxuXHJcbiAgY29uc3QgcGFydHMgPSBjbGVhbmVkLnNwbGl0KFwiL1wiKTtcclxuICBpZiAocGFydHMubGVuZ3RoID09PSAyKSB7XHJcbiAgICBjb25zdCBzZXEgPSBwYXJ0c1swXS5yZXBsYWNlKC9eMCsvLCBcIlwiKTsgLy8gU3RyaXAgbGVhZGluZyB6ZXJvcyBmcm9tIHNlcXVlbmNlXHJcbiAgICByZXR1cm4gYCR7c2VxfS8ke3BhcnRzWzFdfWA7XHJcbiAgfVxyXG4gIHJldHVybiBjbGVhbmVkO1xyXG59XHJcblxyXG5mdW5jdGlvbiBzcGxpdExpc3QodmFsdWUpIHtcclxuICByZXR1cm4gU3RyaW5nKHZhbHVlIHx8IFwiXCIpXHJcbiAgICAuc3BsaXQoXCI7XCIpXHJcbiAgICAubWFwKChpdGVtKSA9PiBpdGVtLnRyaW0oKSlcclxuICAgIC5maWx0ZXIoQm9vbGVhbik7XHJcbn1cclxuXHJcbmNvbnN0IE9QVElPTl9GSUVMRFMgPSBbXHJcbiAgXCJDcmltZUhlYWRcIiwgXCJDcmltZVN1YkhlYWRcIiwgXCJQb2xpY2VTdGF0aW9uXCIsIFwiUG9saWNlU3RhdGlvblR5cGVcIiwgXCJEaXN0cmljdFwiLFxyXG4gIFwiQ291cnRcIiwgXCJPZmZpY2VyXCIsIFwiT2ZmaWNlclJhbmtcIiwgXCJPZmZpY2VyRGVzaWduYXRpb25cIiwgXCJTdGF0dXNcIixcclxuICBcIkNhc2VDYXRlZ29yeVwiLCBcIkdyYXZpdHlcIiwgXCJBY3RzXCIsIFwiU2VjdGlvbnNcIiwgXCJDaGFyZ2VzaGVldFN0YXR1c1wiXHJcbl07XHJcblxyXG5mdW5jdGlvbiBidWlsZE9wdGlvbnMocmVjb3Jkcykge1xyXG4gIGNvbnN0IG9wdGlvbnMgPSB7fTtcclxuICBmb3IgKGNvbnN0IGZpZWxkIG9mIE9QVElPTl9GSUVMRFMpIHtcclxuICAgIGNvbnN0IHZhbHVlcyA9IG5ldyBTZXQoKTtcclxuICAgIGZvciAoY29uc3QgcmVjb3JkIG9mIHJlY29yZHMpIHtcclxuICAgICAgZm9yIChjb25zdCB2YWx1ZSBvZiBzcGxpdExpc3QocmVjb3JkW2ZpZWxkXSkpIHtcclxuICAgICAgICB2YWx1ZXMuYWRkKHZhbHVlKTtcclxuICAgICAgfVxyXG4gICAgICBpZiAoIVN0cmluZyhyZWNvcmRbZmllbGRdIHx8IFwiXCIpLmluY2x1ZGVzKFwiO1wiKSAmJiByZWNvcmRbZmllbGRdKSB7XHJcbiAgICAgICAgdmFsdWVzLmFkZChyZWNvcmRbZmllbGRdKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgb3B0aW9uc1tmaWVsZF0gPSBBcnJheS5mcm9tKHZhbHVlcykuc29ydCgoYSwgYikgPT4gYS5sb2NhbGVDb21wYXJlKGIpKTtcclxuICB9XHJcblxyXG4gIGNvbnN0IGNyaW1lU3ViSGVhZHNCeUhlYWQgPSB7fTtcclxuICBmb3IgKGNvbnN0IHJlY29yZCBvZiByZWNvcmRzKSB7XHJcbiAgICBjb25zdCBoZWFkID0gcmVjb3JkLkNyaW1lSGVhZCB8fCBcIlwiO1xyXG4gICAgY29uc3Qgc3ViSGVhZCA9IHJlY29yZC5DcmltZVN1YkhlYWQgfHwgXCJcIjtcclxuICAgIGlmICghaGVhZCB8fCAhc3ViSGVhZCkgY29udGludWU7XHJcbiAgICBjcmltZVN1YkhlYWRzQnlIZWFkW2hlYWRdID0gY3JpbWVTdWJIZWFkc0J5SGVhZFtoZWFkXSB8fCBbXTtcclxuICAgIGlmICghY3JpbWVTdWJIZWFkc0J5SGVhZFtoZWFkXS5pbmNsdWRlcyhzdWJIZWFkKSkge1xyXG4gICAgICBjcmltZVN1YkhlYWRzQnlIZWFkW2hlYWRdLnB1c2goc3ViSGVhZCk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIE9iamVjdC52YWx1ZXMoY3JpbWVTdWJIZWFkc0J5SGVhZCkuZm9yRWFjaCgodmFsdWVzKSA9PiB2YWx1ZXMuc29ydCgoYSwgYikgPT4gYS5sb2NhbGVDb21wYXJlKGIpKSk7XHJcbiAgb3B0aW9ucy5jcmltZVN1YkhlYWRzQnlIZWFkID0gY3JpbWVTdWJIZWFkc0J5SGVhZDtcclxuXHJcbiAgcmV0dXJuIG9wdGlvbnM7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdlbmVyYXRlQ3JpbWVObyhyZWNvcmRzKSB7XHJcbiAgY29uc3QgY3VycmVudFllYXIgPSBuZXcgRGF0ZSgpLmdldEZ1bGxZZWFyKCk7XHJcbiAgbGV0IG1heFNlcSA9IDA7XHJcbiAgZm9yIChjb25zdCByZWNvcmQgb2YgcmVjb3Jkcykge1xyXG4gICAgY29uc3QgcGFydHMgPSBTdHJpbmcocmVjb3JkLkNyaW1lTm8gfHwgXCJcIikuc3BsaXQoXCIvXCIpO1xyXG4gICAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMiAmJiBwYXJ0c1sxXSA9PT0gU3RyaW5nKGN1cnJlbnRZZWFyKSkge1xyXG4gICAgICBjb25zdCBzZXEgPSBwYXJzZUludChwYXJ0c1swXS5yZXBsYWNlKC9eMCsvLCBcIlwiKSwgMTApO1xyXG4gICAgICBpZiAoIWlzTmFOKHNlcSkgJiYgc2VxID4gbWF4U2VxKSBtYXhTZXEgPSBzZXE7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiBgJHtTdHJpbmcobWF4U2VxICsgMSkucGFkU3RhcnQoNCwgXCIwXCIpfS8ke2N1cnJlbnRZZWFyfWA7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG5leHROdW1lcmljVmFsdWUocmVjb3JkcywgZmllbGQsIGZhbGxiYWNrKSB7XHJcbiAgY29uc3QgbWF4ID0gcmVjb3Jkcy5yZWR1Y2UoKGN1cnJlbnQsIHJlY29yZCkgPT4ge1xyXG4gICAgY29uc3QgbiA9IE51bWJlci5wYXJzZUludChyZWNvcmRbZmllbGRdLCAxMCk7XHJcbiAgICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKG4pID8gTWF0aC5tYXgoY3VycmVudCwgbikgOiBjdXJyZW50O1xyXG4gIH0sIDApO1xyXG4gIHJldHVybiBTdHJpbmcobWF4ID4gMCA/IG1heCArIDEgOiBmYWxsYmFjayk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlY2FsY0Rlcml2ZWRGaWVsZHMocmVjb3JkKSB7XHJcbiAgcmVjb3JkLkFjY3VzZWRDb3VudCA9IFN0cmluZyhzcGxpdExpc3QocmVjb3JkLkFjY3VzZWROYW1lcykubGVuZ3RoKTtcclxuICByZWNvcmQuVmljdGltQ291bnQgPSBTdHJpbmcoc3BsaXRMaXN0KHJlY29yZC5WaWN0aW1OYW1lcykubGVuZ3RoKTtcclxuICBpZiAoIXJlY29yZC5BcnJlc3RDb3VudCkgcmVjb3JkLkFycmVzdENvdW50ID0gXCIwXCI7XHJcbiAgaWYgKCFyZWNvcmQuQ2hhcmdlc2hlZXRDb3VudCkgcmVjb3JkLkNoYXJnZXNoZWV0Q291bnQgPSBcIjBcIjtcclxuICBpZiAoIXJlY29yZC5DaGFyZ2VzaGVldFN0YXR1cykgcmVjb3JkLkNoYXJnZXNoZWV0U3RhdHVzID0gXCJQZW5kaW5nXCI7XHJcbiAgaWYgKCFyZWNvcmQuU3RhdHVzKSByZWNvcmQuU3RhdHVzID0gXCJVbmRlciBJbnZlc3RpZ2F0aW9uXCI7XHJcbiAgaWYgKCFyZWNvcmQuQ2FzZUNhdGVnb3J5KSByZWNvcmQuQ2FzZUNhdGVnb3J5ID0gXCJGSVJcIjtcclxuICBpZiAoIXJlY29yZC5HcmF2aXR5KSByZWNvcmQuR3Jhdml0eSA9IFwiTm9uLUhlaW5vdXNcIjtcclxuICBpZiAoIXJlY29yZC5EaXN0cmljdCkgcmVjb3JkLkRpc3RyaWN0ID0gXCJCYW5nYWxvcmUgVXJiYW5cIjtcclxufVxyXG5cclxuZnVuY3Rpb24gY2FzZU1hdGNoZXMocmVjb3JkLCBrZXkpIHtcclxuICBjb25zdCB3YW50ZWQgPSBkZWNvZGVVUklDb21wb25lbnQoU3RyaW5nKGtleSB8fCBcIlwiKSkudHJpbSgpO1xyXG4gIGlmICghd2FudGVkKSByZXR1cm4gZmFsc2U7XHJcblxyXG4gIGNvbnN0IHdhbnRlZE5vcm1hbGl6ZWQgPSBub3JtYWxpemVDcmltZU5vKHdhbnRlZCk7XHJcblxyXG4gIC8vIEV4YWN0IG1hdGNoIG9uIENhc2VNYXN0ZXJJRCBvciBDYXNlTm9cclxuICBpZiAoXHJcbiAgICBTdHJpbmcocmVjb3JkLkNhc2VNYXN0ZXJJRCB8fCBcIlwiKS50cmltKCkgPT09IHdhbnRlZCB8fFxyXG4gICAgU3RyaW5nKHJlY29yZC5DYXNlTm8gfHwgXCJcIikudHJpbSgpID09PSB3YW50ZWRcclxuICApIHtcclxuICAgIHJldHVybiB0cnVlO1xyXG4gIH1cclxuXHJcbiAgLy8gRmxleGlibGUgbm9ybWFsaXplZCBtYXRjaCBvbiBDcmltZU5vXHJcbiAgaWYgKHJlY29yZC5DcmltZU5vKSB7XHJcbiAgICBjb25zdCByZWNvcmRDcmltZU5vcm1hbGl6ZWQgPSBub3JtYWxpemVDcmltZU5vKHJlY29yZC5DcmltZU5vKTtcclxuICAgIGlmIChyZWNvcmRDcmltZU5vcm1hbGl6ZWQgPT09IHdhbnRlZE5vcm1hbGl6ZWQpIHJldHVybiB0cnVlO1xyXG4gICAgaWYgKFN0cmluZyhyZWNvcmQuQ3JpbWVObykudHJpbSgpID09PSB3YW50ZWQpIHJldHVybiB0cnVlO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIGZhbHNlO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZWFkQm9keShyZXEpIHtcclxuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgbGV0IGJvZHkgPSBcIlwiO1xyXG4gICAgcmVxLm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IHtcclxuICAgICAgYm9keSArPSBjaHVuaztcclxuICAgICAgaWYgKGJvZHkubGVuZ3RoID4gMTBfMDAwXzAwMCkge1xyXG4gICAgICAgIHJlamVjdChuZXcgRXJyb3IoXCJSZXF1ZXN0IGJvZHkgaXMgdG9vIGxhcmdlLlwiKSk7XHJcbiAgICAgICAgcmVxLmRlc3Ryb3koKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICByZXEub24oXCJlbmRcIiwgKCkgPT4ge1xyXG4gICAgICBpZiAoIWJvZHkpIHtcclxuICAgICAgICByZXNvbHZlKHt9KTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgdHJ5IHtcclxuICAgICAgICByZXNvbHZlKEpTT04ucGFyc2UoYm9keSkpO1xyXG4gICAgICB9IGNhdGNoIHtcclxuICAgICAgICByZWplY3QobmV3IEVycm9yKFwiUmVxdWVzdCBib2R5IG11c3QgYmUgdmFsaWQgSlNPTi5cIikpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuICAgIHJlcS5vbihcImVycm9yXCIsIHJlamVjdCk7XHJcbiAgfSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHNlbmRKc29uKHJlcywgc3RhdHVzLCBkYXRhKSB7XHJcbiAgcmVzLnN0YXR1c0NvZGUgPSBzdGF0dXM7XHJcbiAgcmVzLnNldEhlYWRlcihcIkNvbnRlbnQtVHlwZVwiLCBcImFwcGxpY2F0aW9uL2pzb247IGNoYXJzZXQ9dXRmLThcIik7XHJcbiAgcmVzLmVuZChKU09OLnN0cmluZ2lmeShkYXRhKSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHNlbmRFcnJvcihyZXMsIHN0YXR1cywgZXJyb3IpIHtcclxuICBzZW5kSnNvbihyZXMsIHN0YXR1cywgeyBvazogZmFsc2UsIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcikgfSk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUFwaShyZXEsIHJlcywgbmV4dCkge1xyXG4gIGNvbnN0IHVybCA9IG5ldyBVUkwocmVxLnVybCB8fCBcIi9cIiwgXCJodHRwOi8vbG9jYWwtZGJcIik7XHJcbiAgXHJcbiAgLy8gXHVEODNEXHVERTgwIFBhc3MgL2FwaS9jaGF0IGRpcmVjdGx5IHRvIGNoYXRQbHVnaW4ubWpzIHNvIGxvY2FsRGJQbHVnaW4gZG9lc24ndCBibG9jayBpdCB3aXRoIGEgNDA0XHJcbiAgaWYgKHVybC5wYXRobmFtZSA9PT0gXCIvYXBpL2NoYXRcIikge1xyXG4gICAgbmV4dCgpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgaWYgKCF1cmwucGF0aG5hbWUuc3RhcnRzV2l0aChcIi9hcGkvXCIpKSB7XHJcbiAgICBuZXh0KCk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG5cclxuICB0cnkge1xyXG4gICAgaWYgKHJlcS5tZXRob2QgPT09IFwiUE9TVFwiICYmIHVybC5wYXRobmFtZSA9PT0gXCIvYXBpL2xvZ2luXCIpIHtcclxuICAgICAgY29uc3QgeyBlbXBsb3llZUlkLCBwYXNzd29yZCwgZmlyZWJhc2VBdXRoIH0gPSBhd2FpdCByZWFkQm9keShyZXEpO1xyXG4gICAgICBpZiAoIWVtcGxveWVlSWQgfHwgKCFwYXNzd29yZCAmJiAhZmlyZWJhc2VBdXRoKSkge1xyXG4gICAgICAgIHNlbmRFcnJvcihyZXMsIDQwMCwgXCJFbXBsb3llZSBJRCBhbmQgcGFzc3dvcmQgYXJlIHJlcXVpcmVkLlwiKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgeyByb3cgfSA9IGF3YWl0IGVtcGxveWVlQnlJZChlbXBsb3llZUlkKTtcclxuICAgICAgaWYgKCFyb3cpIHtcclxuICAgICAgICBpZiAoZmlyZWJhc2VBdXRoKSB7XHJcbiAgICAgICAgICBzZW5kSnNvbihyZXMsIDIwMCwgeyBvazogdHJ1ZSwgZW1wbG95ZWVJZCwgbmFtZTogYE9mZmljZXIgJHtlbXBsb3llZUlkfWAsIGlzRmlyc3RMb2dpbjogZmFsc2UgfSk7XHJcbiAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHNlbmRFcnJvcihyZXMsIDQwMSwgXCJJbnZhbGlkIGNyZWRlbnRpYWxzLiBFbXBsb3llZSBJRCBub3QgZm91bmQuXCIpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG4gICAgICBpZiAoIWZpcmViYXNlQXV0aCAmJiByb3cuRmlyc3RBdXRoICE9PSBwYXNzd29yZCkge1xyXG4gICAgICAgIHNlbmRFcnJvcihyZXMsIDQwMSwgXCJJbnZhbGlkIGNyZWRlbnRpYWxzLlwiKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgY29uc3Qgb2ZmaWNlck5hbWUgPSByb3cuTmFtZSB8fCAocm93LkZpcnN0TmFtZSA/IGBPZmZpY2VyICR7cm93LkZpcnN0TmFtZX1gIDogYE9mZmljZXIgJHtlbXBsb3llZUlkfWApO1xyXG4gICAgICBzZW5kSnNvbihyZXMsIDIwMCwgeyBvazogdHJ1ZSwgZW1wbG95ZWVJZCwgbmFtZTogb2ZmaWNlck5hbWUsIGlzRmlyc3RMb2dpbjogcm93Lkhhc0xvZ2dlZEluICE9PSBcIlRSVUVcIiB9KTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChyZXEubWV0aG9kID09PSBcIlBPU1RcIiAmJiB1cmwucGF0aG5hbWUgPT09IFwiL2FwaS9lbXBsb3llZS9wYXNzd29yZFwiKSB7XHJcbiAgICAgIGNvbnN0IHsgZW1wbG95ZWVJZCwgcGFzc3dvcmQsIHBob25lTnVtYmVyLCBub3RpZmljYXRpb25QcmVmLCBoYXNMb2dnZWRJbiB9ID0gYXdhaXQgcmVhZEJvZHkocmVxKTtcclxuICAgICAgaWYgKCFlbXBsb3llZUlkKSB7XHJcbiAgICAgICAgc2VuZEVycm9yKHJlcywgNDAwLCBcIkVtcGxveWVlIElEIGlzIHJlcXVpcmVkLlwiKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgdXBkYXRlcyA9IHt9O1xyXG4gICAgICBpZiAocGFzc3dvcmQpIHtcclxuICAgICAgICB1cGRhdGVzLkZpcnN0QXV0aCA9IHBhc3N3b3JkO1xyXG4gICAgICAgIHVwZGF0ZXMuSGFzTG9nZ2VkSW4gPSBcIlRSVUVcIjtcclxuICAgICAgfVxyXG4gICAgICBpZiAoaGFzTG9nZ2VkSW4pIHtcclxuICAgICAgICB1cGRhdGVzLkhhc0xvZ2dlZEluID0gXCJUUlVFXCI7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKHBob25lTnVtYmVyKSB1cGRhdGVzLlBob25lTnVtYmVyID0gcGhvbmVOdW1iZXI7XHJcbiAgICAgIGlmIChub3RpZmljYXRpb25QcmVmICE9PSB1bmRlZmluZWQpIHVwZGF0ZXMuTm90aWZpY2F0aW9uUHJlZiA9IFN0cmluZyhub3RpZmljYXRpb25QcmVmKTtcclxuICAgICAgXHJcbiAgICAgIGF3YWl0IHVwZGF0ZUVtcGxveWVlKGVtcGxveWVlSWQsIHVwZGF0ZXMpO1xyXG4gICAgICBzZW5kSnNvbihyZXMsIDIwMCwgeyBvazogdHJ1ZSB9KTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChyZXEubWV0aG9kID09PSBcIkdFVFwiICYmIHVybC5wYXRobmFtZSA9PT0gXCIvYXBpL2Nhc2VzXCIpIHtcclxuICAgICAgY29uc3QgeyBoZWFkZXJzLCByb3dzIH0gPSBhd2FpdCBjYXNlc0Zyb21Hb29nbGUoKTtcclxuICAgICAgc2VuZEpzb24ocmVzLCAyMDAsIHsgb2s6IHRydWUsIGhlYWRlcnMsIGNhc2VzOiByb3dzLCBvcHRpb25zOiBidWlsZE9wdGlvbnMocm93cykgfSk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAocmVxLm1ldGhvZCA9PT0gXCJQT1NUXCIgJiYgdXJsLnBhdGhuYW1lID09PSBcIi9hcGkvY2FzZXMvc3luY1wiKSB7XHJcbiAgICAgIHNlbmRKc29uKHJlcywgMjAwLCB7IG9rOiB0cnVlLCBzeW5jOiB7IG9rOiB0cnVlLCBza2lwcGVkOiB0cnVlLCBtZXNzYWdlOiBcIlN5bmMgaGFuZGxlZCBkeW5hbWljYWxseSB2aWEgTm9kZS5qc1wiIH0gfSk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAocmVxLm1ldGhvZCA9PT0gXCJQT1NUXCIgJiYgdXJsLnBhdGhuYW1lID09PSBcIi9hcGkvY2FzZXMvcHVsbFwiKSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgdGVtcENzdiA9IHBhdGguam9pbihwcm9jZXNzLmN3ZCgpLCBcInNjcmF0Y2hcIiwgXCJ0ZW1wX3N5bmMuY3N2XCIpO1xyXG4gICAgICAgIGNvbnN0IGV4cG9ydFNjcmlwdCA9IHBhdGguam9pbihwcm9jZXNzLmN3ZCgpLCBcImxvY2FsX2RiXCIsIFwiZXhwb3J0X2RhdGEucHlcIik7XHJcbiAgICAgICAgY29uc3QgZW52ID0geyAuLi5wcm9jZXNzLmVudiwgR09PR0xFX1NFUlZJQ0VfQUNDT1VOVF9KU09OOiBwcm9jZXNzLmVudi5DQVRBTFlTVF9TRVJWSUNFX0FDQ09VTlRfSlNPTiB8fCBwcm9jZXNzLmVudi5HT09HTEVfU0VSVklDRV9BQ0NPVU5UX0pTT04gfTtcclxuICAgICAgICBcclxuICAgICAgICBhd2FpdCBleGVjRmlsZUFzeW5jKFwicHl0aG9uXCIsIFtleHBvcnRTY3JpcHQsIFwiLS1vdXRwdXRcIiwgdGVtcENzdl0sIHsgZW52IH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChmcy5leGlzdHNTeW5jKHRlbXBDc3YpKSB7XHJcbiAgICAgICAgICBjb25zdCBjc3ZEYXRhID0gZnMucmVhZEZpbGVTeW5jKHRlbXBDc3YsIFwidXRmOFwiKTtcclxuICAgICAgICAgIGNvbnN0IHJlY29yZHMgPSBwYXJzZShjc3ZEYXRhLCB7IGNvbHVtbnM6IHRydWUsIHNraXBfZW1wdHlfbGluZXM6IHRydWUgfSk7XHJcbiAgICAgICAgICBpZiAocmVjb3Jkcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGhlYWRlcnMgPSBPYmplY3Qua2V5cyhyZWNvcmRzWzBdKTtcclxuICAgICAgICAgICAgY29uc3QgQ09OU09MSURBVEVEX1NIRUVUX0lEID0gcHJvY2Vzcy5lbnYuR09PR0xFX0NPTlNPTElEQVRFRF9TSEVFVF9JRCB8fCBcIjF1eXpWZ0NBUFpXOUNremtOSEZLSDBRT0ptX25ibjVTcjR1bDluZ3YwWm9NXCI7XHJcbiAgICAgICAgICAgIGNvbnN0IHRhYiA9IHByb2Nlc3MuZW52LkdPT0dMRV9DT05TT0xJREFURURfVEFCIHx8IFwiQ29uc29saWRhdGVkX0Nhc2VzXCI7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBhd2FpdCB3cml0ZVRhYmxlKENPTlNPTElEQVRFRF9TSEVFVF9JRCwgdGFiLCBoZWFkZXJzLCByZWNvcmRzKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGZzLnVubGlua1N5bmModGVtcENzdik7IC8vIENsZWFudXBcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgeyBoZWFkZXJzLCByb3dzIH0gPSBhd2FpdCBjYXNlc0Zyb21Hb29nbGUoKTtcclxuICAgICAgICBzZW5kSnNvbihyZXMsIDIwMCwge1xyXG4gICAgICAgICAgb2s6IHRydWUsXHJcbiAgICAgICAgICBwdWxsOiB7IG9rOiB0cnVlIH0sXHJcbiAgICAgICAgICB3cml0ZVJlc3VsdDogeyBwZW5kaW5nOiBmYWxzZSB9LFxyXG4gICAgICAgICAgaGVhZGVycyxcclxuICAgICAgICAgIGNhc2VzOiByb3dzLFxyXG4gICAgICAgICAgb3B0aW9uczogYnVpbGRPcHRpb25zKHJvd3MpLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICBzZW5kRXJyb3IocmVzLCA1MDAsIGBTeW5jIGZhaWxlZDogJHtlcnIubWVzc2FnZX1gKTtcclxuICAgICAgfVxyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgY2FzZU1hdGNoID0gdXJsLnBhdGhuYW1lLm1hdGNoKC9eXFwvYXBpXFwvY2FzZXNcXC8oW14vXSspJC8pO1xyXG4gICAgaWYgKHJlcS5tZXRob2QgPT09IFwiR0VUXCIgJiYgY2FzZU1hdGNoKSB7XHJcbiAgICAgIGNvbnN0IHsgaGVhZGVycywgcm93cyB9ID0gYXdhaXQgY2FzZXNGcm9tR29vZ2xlKCk7XHJcbiAgICAgIGNvbnN0IHJlY29yZCA9IHJvd3MuZmluZCgoaXRlbSkgPT4gY2FzZU1hdGNoZXMoaXRlbSwgY2FzZU1hdGNoWzFdKSk7XHJcbiAgICAgIGlmICghcmVjb3JkKSB7XHJcbiAgICAgICAgc2VuZEVycm9yKHJlcywgNDA0LCBcIkNhc2Ugd2FzIG5vdCBmb3VuZC5cIik7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcbiAgICAgIHNlbmRKc29uKHJlcywgMjAwLCB7IG9rOiB0cnVlLCBoZWFkZXJzLCBjYXNlOiByZWNvcmQsIG9wdGlvbnM6IGJ1aWxkT3B0aW9ucyhyb3dzKSB9KTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICgocmVxLm1ldGhvZCA9PT0gXCJQT1NUXCIgJiYgdXJsLnBhdGhuYW1lID09PSBcIi9hcGkvY2FzZXNcIikgfHwgKChyZXEubWV0aG9kID09PSBcIlBBVENIXCIgfHwgcmVxLm1ldGhvZCA9PT0gXCJQVVRcIikgJiYgY2FzZU1hdGNoKSkge1xyXG4gICAgICBjb25zdCBwYXlsb2FkID0gYXdhaXQgcmVhZEJvZHkocmVxKTtcclxuICAgICAgY29uc3QgeyBoZWFkZXJzLCByb3dzOiByZWNvcmRzIH0gPSBhd2FpdCBjYXNlc0Zyb21Hb29nbGUoKTtcclxuICAgICAgY29uc3QgZmllbGRzID0gcGF5bG9hZC5jYXNlIHx8IHBheWxvYWQuZmllbGRzIHx8IHBheWxvYWQ7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCBrZXkgPSBjYXNlTWF0Y2ggPyBjYXNlTWF0Y2hbMV0gOiBcIlwiO1xyXG4gICAgICBcclxuICAgICAgY29uc3Qga25vd25GaWVsZHMgPSB7fTtcclxuICAgICAgZm9yIChjb25zdCBbaywgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGZpZWxkcykpIHtcclxuICAgICAgICBrbm93bkZpZWxkc1trXSA9IG5vcm1hbGl6ZVZhbHVlKHZhbHVlKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgbGV0IGluZGV4ID0gcmVjb3Jkcy5maW5kSW5kZXgoKHJlY29yZCkgPT4gY2FzZU1hdGNoZXMocmVjb3JkLCBrZXkgfHwga25vd25GaWVsZHMuQ3JpbWVObyB8fCBrbm93bkZpZWxkcy5DYXNlTm8gfHwga25vd25GaWVsZHMuQ2FzZU1hc3RlcklEKSk7XHJcbiAgICAgIGNvbnN0IGNyZWF0ZWQgPSBpbmRleCA9PT0gLTE7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCByZWNvcmQgPSB7fTtcclxuICAgICAgaGVhZGVycy5mb3JFYWNoKChoZWFkZXIpID0+IHtcclxuICAgICAgICByZWNvcmRbaGVhZGVyXSA9IGNyZWF0ZWQgPyBcIlwiIDogcmVjb3Jkc1tpbmRleF1baGVhZGVyXSB8fCBcIlwiO1xyXG4gICAgICB9KTtcclxuICAgICAgT2JqZWN0LmFzc2lnbihyZWNvcmQsIGtub3duRmllbGRzKTtcclxuXHJcbiAgICAgIC8vIFx1RDgzRFx1REU4MCBTYWZlIEF1dG8tSUQgR2VuZXJhdGlvbiBpZiBtaXNzaW5nIG9yIGludmFsaWRcclxuICAgICAgaWYgKCFyZWNvcmQuQ2FzZU1hc3RlcklEIHx8IHJlY29yZC5DYXNlTWFzdGVySUQgPT09IFwiQXNzaWduZWQgb24gc2F2ZVwiKSB7XHJcbiAgICAgICAgcmVjb3JkLkNhc2VNYXN0ZXJJRCA9IG5leHROdW1lcmljVmFsdWUocmVjb3JkcywgXCJDYXNlTWFzdGVySURcIiwgMTIyMik7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKCFyZWNvcmQuQ2FzZU5vIHx8IHJlY29yZC5DYXNlTm8gPT09IFwiQXNzaWduZWQgb24gc2F2ZVwiKSB7XHJcbiAgICAgICAgY29uc3QgeWVhciA9IG5ldyBEYXRlKCkuZ2V0RnVsbFllYXIoKTtcclxuICAgICAgICByZWNvcmQuQ2FzZU5vID0gYCR7eWVhcn0ke1N0cmluZyhyZWNvcmRzLmxlbmd0aCArIDEpLnBhZFN0YXJ0KDYsIFwiMFwiKX1gO1xyXG4gICAgICB9XHJcbiAgICAgIGlmICghcmVjb3JkLkNyaW1lTm8gfHwgcmVjb3JkLkNyaW1lTm8gPT09IFwiQXNzaWduZWQgb24gc2F2ZVwiKSB7XHJcbiAgICAgICAgcmVjb3JkLkNyaW1lTm8gPSBnZW5lcmF0ZUNyaW1lTm8ocmVjb3Jkcyk7XHJcbiAgICAgIH1cclxuICAgICAgcmVjYWxjRGVyaXZlZEZpZWxkcyhyZWNvcmQpO1xyXG4gICAgICBcclxuICAgICAgLy8gXHVEODNEXHVERTgwIERpcmVjdCBHb29nbGUgU2hlZXRzIFVwc2VydCB3aXRoIGV4cGxpY2l0IGxvZ2dpbmdcclxuICAgICAgY29uc29sZS5sb2coYFtHb29nbGUgU2hlZXRzIFdyaXRlXSBVcHNlcnRpbmcgcmVjb3JkIGZvciBDYXNlTWFzdGVySUQ6ICR7cmVjb3JkLkNhc2VNYXN0ZXJJRH0uLi5gKTtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBhd2FpdCB1cHNlcnRDYXNlSW5Hb29nbGUocmVjb3JkKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgW0dvb2dsZSBTaGVldHMgV3JpdGVdIFx1MjcwNSBTdWNjZXNzZnVsbHkgd3JvdGUgQ2FzZU1hc3RlcklEICR7cmVjb3JkLkNhc2VNYXN0ZXJJRH0gdG8gR29vZ2xlIFNoZWV0cyFgKTtcclxuICAgICAgfSBjYXRjaCAoZ29vZ2xlRXJyKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihgW0dvb2dsZSBTaGVldHMgV3JpdGUgRXJyb3JdIFx1Mjc0QyBGYWlsZWQgdG8gd3JpdGUgdG8gR29vZ2xlIFNoZWV0czpgLCBnb29nbGVFcnIpO1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgR29vZ2xlIFNoZWV0cyBBUEkgd3JpdGUgZXJyb3I6ICR7Z29vZ2xlRXJyLm1lc3NhZ2UgfHwgU3RyaW5nKGdvb2dsZUVycil9YCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIFNpbXVsYXRlIFB1c2ggTm90aWZpY2F0aW9uXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgTUFTVEVSX1NIRUVUX0lEID0gcHJvY2Vzcy5lbnYuR09PR0xFX01BU1RFUl9TSEVFVF9JRCB8fCBwcm9jZXNzLmVudi5HT09HTEVfU0hFRVRfSUQgfHwgXCIxc0V4Q09PVkpEVDZKNjhETTkzRV9RUGJaR3NfLVJ6UE9sZlhBQ1lkOG1TNFwiO1xyXG4gICAgICAgIGNvbnN0IGVtcGxveWVlc1RhYiA9IGF3YWl0IHJlYWRUYWJsZShNQVNURVJfU0hFRVRfSUQsIFwiRW1wbG95ZWVcIik7XHJcbiAgICAgICAgY29uc3QgdW5pdHNUYWIgPSBhd2FpdCByZWFkVGFibGUoTUFTVEVSX1NIRUVUX0lELCBcIlVuaXRcIik7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3Qgc3RhdGlvbiA9IHJlY29yZC5Qb2xpY2VTdGF0aW9uIHx8IHJlY29yZC5TdGF0aW9uO1xyXG4gICAgICAgIGlmIChzdGF0aW9uKSB7XHJcbiAgICAgICAgICBsZXQgdGFyZ2V0VW5pdElkID0gU3RyaW5nKHN0YXRpb24pO1xyXG4gICAgICAgICAgY29uc3QgdW5pdE1hdGNoID0gdW5pdHNUYWIucm93cy5maW5kKHUgPT4gdS5Vbml0TmFtZSAmJiB1LlVuaXROYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpID09PSBzdGF0aW9uLnRyaW0oKS50b0xvd2VyQ2FzZSgpKTtcclxuICAgICAgICAgIGlmICh1bml0TWF0Y2gpIHtcclxuICAgICAgICAgICAgdGFyZ2V0VW5pdElkID0gU3RyaW5nKHVuaXRNYXRjaC5Vbml0SUQpO1xyXG4gICAgICAgICAgfVxyXG5cclxuICAgICAgICAgIGNvbnN0IG1hdGNoaW5nRW1wbG95ZWVzID0gZW1wbG95ZWVzVGFiLnJvd3MuZmlsdGVyKGUgPT4gXHJcbiAgICAgICAgICAgIFN0cmluZyhlLlVuaXRJRCkgPT09IHRhcmdldFVuaXRJZCAmJiBlLlBob25lTnVtYmVyICYmIGUuUGhvbmVOdW1iZXIudHJpbSgpICE9PSBcIlwiXHJcbiAgICAgICAgICApO1xyXG4gICAgICAgICAgaWYgKG1hdGNoaW5nRW1wbG95ZWVzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFxcbltQVVNIIE5PVElGSUNBVElPTiBUUklHR0VSXWApO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgQ2FzZSBVcGRhdGU6ICR7cmVjb3JkLkNyaW1lTm8gfHwgcmVjb3JkLkNhc2VOb30gYXQgJHtzdGF0aW9ufWApO1xyXG4gICAgICAgICAgICBtYXRjaGluZ0VtcGxveWVlcy5mb3JFYWNoKGVtcCA9PiB7XHJcbiAgICAgICAgICAgICAgY29uc29sZS5sb2coYCAtPiBTZW5kaW5nIFNNUy9QdXNoIHRvIE9mZmljZXIgJHtlbXAuTmFtZX0gYXQgJHtlbXAuUGhvbmVOdW1iZXJ9YCk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXFxuYCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKFwiRmFpbGVkIHRvIHNpbXVsYXRlIHB1c2ggbm90aWZpY2F0aW9uOlwiLCBlcnIpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBzZW5kSnNvbihyZXMsIDIwMCwge1xyXG4gICAgICAgIG9rOiB0cnVlLFxyXG4gICAgICAgIGNyZWF0ZWQsXHJcbiAgICAgICAgaGVhZGVycyxcclxuICAgICAgICBjYXNlOiByZWNvcmQsXHJcbiAgICAgICAgb3B0aW9uczogYnVpbGRPcHRpb25zKHJlY29yZHMpLFxyXG4gICAgICAgIHN5bmM6IHsgb2s6IHRydWUsIHNraXBwZWQ6IGZhbHNlLCBtZXNzYWdlOiBcIkRpcmVjdGx5IHNhdmVkIHRvIEdvb2dsZSBTaGVldHNcIiB9LFxyXG4gICAgICB9KTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIHNlbmRFcnJvcihyZXMsIDQwNCwgXCJVbmtub3duIEFQSSBlbmRwb2ludC5cIik7XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoXCJbTG9jYWwgREIgSGFuZGxlciBFeGNlcHRpb25dOlwiLCBlcnJvcik7XHJcbiAgICBzZW5kRXJyb3IocmVzLCA1MDAsIGVycm9yKTtcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGxvY2FsRGJQbHVnaW4oKSB7XHJcbiAgcmV0dXJuIHtcclxuICAgIG5hbWU6IFwibG9jYWwtZGItYXBpXCIsXHJcbiAgICBjb25maWd1cmVTZXJ2ZXIoc2VydmVyKSB7XHJcbiAgICAgIHNlcnZlci5taWRkbGV3YXJlcy51c2UoaGFuZGxlQXBpKTtcclxuICAgIH0sXHJcbiAgICBjb25maWd1cmVQcmV2aWV3U2VydmVyKHNlcnZlcikge1xyXG4gICAgICBzZXJ2ZXIubWlkZGxld2FyZXMudXNlKGhhbmRsZUFwaSk7XHJcbiAgICB9LFxyXG4gIH07XHJcbn1cclxuXHJcbmV4cG9ydCBkZWZhdWx0IGxvY2FsRGJQbHVnaW47XHJcblxyXG4iLCAiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIkQ6XFxcXGtzcHBcXFxcbWxcXFxcc2VydmVyXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJEOlxcXFxrc3BwXFxcXG1sXFxcXHNlcnZlclxcXFxjaGF0UGx1Z2luLm1qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vRDova3NwcC9tbC9zZXJ2ZXIvY2hhdFBsdWdpbi5tanNcIjtpbXBvcnQgXCJkb3RlbnYvY29uZmlnXCI7XHJcbmltcG9ydCBkbnMgZnJvbSBcIm5vZGU6ZG5zXCI7XHJcbmltcG9ydCB7IGhhbmRsZUNoYXRRdWVyeSB9IGZyb20gXCIuL2dlbWluaVNlcnZpY2UubWpzXCI7XHJcblxyXG4vLyBGb3JjZSBOb2RlLmpzIHRvIHJlc29sdmUgSVB2NCBhZGRyZXNzZXMgZmlyc3QgdG8gZml4IEVUSU1FRE9VVCAvIGZldGNoIGZhaWxlZCBlcnJvcnNcclxuZG5zLnNldERlZmF1bHRSZXN1bHRPcmRlcihcImlwdjRmaXJzdFwiKTtcclxuXHJcbi8qKlxyXG4gKiBOb3JtYWxpemVzIGNyaW1lIG51bWJlcnMgZm9yIGZsZXhpYmxlIG1hdGNoaW5nLlxyXG4gKiBFLmcuLCBcIjAwMTEvMjAyNlwiLCBcIkNSLTAwMTEvMjAyNlwiLCBhbmQgXCIxMS8yMDI2XCIgYWxsIG5vcm1hbGl6ZSB0byBcIjExLzIwMjZcIi5cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVDcmltZU5vKHN0cikge1xyXG4gIGlmICghc3RyKSByZXR1cm4gXCJcIjtcclxuICBjb25zdCBjbGVhbmVkID0gU3RyaW5nKHN0cilcclxuICAgIC50cmltKClcclxuICAgIC50b1VwcGVyQ2FzZSgpXHJcbiAgICAucmVwbGFjZSgvXkNSLT8vaSwgXCJcIik7IC8vIFN0cmlwIGxlYWRpbmcgXCJDUi1cIiBvciBcIkNSXCJcclxuXHJcbiAgY29uc3QgcGFydHMgPSBjbGVhbmVkLnNwbGl0KFwiL1wiKTtcclxuICBpZiAocGFydHMubGVuZ3RoID09PSAyKSB7XHJcbiAgICBjb25zdCBzZXEgPSBwYXJ0c1swXS5yZXBsYWNlKC9eMCsvLCBcIlwiKTsgLy8gU3RyaXAgbGVhZGluZyB6ZXJvcyBmcm9tIHNlcXVlbmNlXHJcbiAgICByZXR1cm4gYCR7c2VxfS8ke3BhcnRzWzFdfWA7XHJcbiAgfVxyXG4gIHJldHVybiBjbGVhbmVkO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZWFkQm9keShyZXEpIHtcclxuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgbGV0IGJvZHkgPSBcIlwiO1xyXG4gICAgcmVxLm9uKFwiZGF0YVwiLCAoYykgPT4gKGJvZHkgKz0gYykpO1xyXG4gICAgcmVxLm9uKFwiZW5kXCIsICgpID0+IHtcclxuICAgICAgdHJ5IHsgXHJcbiAgICAgICAgcmVzb2x2ZShib2R5ID8gSlNPTi5wYXJzZShib2R5KSA6IHt9KTsgXHJcbiAgICAgIH0gY2F0Y2ggeyBcclxuICAgICAgICByZWplY3QobmV3IEVycm9yKFwiSW52YWxpZCBKU09OIGJvZHlcIikpOyBcclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICByZXEub24oXCJlcnJvclwiLCByZWplY3QpO1xyXG4gIH0pO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVDaGF0QXBpKHJlcSwgcmVzLCBuZXh0KSB7XHJcbiAgY29uc3QgdXJsID0gbmV3IFVSTChyZXEudXJsIHx8IFwiL1wiLCBcImh0dHA6Ly9sb2NhbC1jaGF0XCIpO1xyXG5cclxuICAvLyAxLiBDaGF0IEVuZHBvaW50IFJvdXRlIEhhbmRsZXJcclxuICBpZiAocmVxLm1ldGhvZCA9PT0gXCJQT1NUXCIgJiYgdXJsLnBhdGhuYW1lID09PSBcIi9hcGkvY2hhdFwiKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCB7IHF1ZXN0aW9uLCByb2xlLCBzdGF0aW9uSWQsIGxhbmd1YWdlIH0gPSBhd2FpdCByZWFkQm9keShyZXEpO1xyXG5cclxuICAgICAgLy8gRXh0cmFjdCBhbmQgbm9ybWFsaXplIGFueSBjcmltZSBudW1iZXJzIChlLmcuIDAwMTEvMjAyNiBvciBDUi0wMDExLzIwMjYpIGluIHRoZSB1c2VyJ3MgcXVlc3Rpb25cclxuICAgICAgY29uc3QgY3JpbWVOb1JlZ2V4ID0gLyg/OkNSLT8pP1xcYlxcZHsxLDR9XFwvXFxkezR9XFxiL2dpO1xyXG4gICAgICBjb25zdCBub3JtYWxpemVkUXVlc3Rpb24gPSBTdHJpbmcocXVlc3Rpb24gfHwgXCJcIikucmVwbGFjZShjcmltZU5vUmVnZXgsIChtYXRjaCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBub3JtYWxpemVDcmltZU5vKG1hdGNoKTtcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCBhbnN3ZXIgPSBhd2FpdCBoYW5kbGVDaGF0UXVlcnkoeyBcclxuICAgICAgICBxdWVzdGlvbiwgXHJcbiAgICAgICAgbm9ybWFsaXplZFF1ZXN0aW9uLCBcclxuICAgICAgICBub3JtYWxpemVkQ3JpbWVObzogbm9ybWFsaXplQ3JpbWVObyhxdWVzdGlvbiksXHJcbiAgICAgICAgcm9sZSwgXHJcbiAgICAgICAgc3RhdGlvbklkLCBcclxuICAgICAgICBsYW5ndWFnZSBcclxuICAgICAgfSk7XHJcblxyXG4gICAgICByZXMuc2V0SGVhZGVyKFwiQ29udGVudC1UeXBlXCIsIFwiYXBwbGljYXRpb24vanNvblwiKTtcclxuICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IG9rOiB0cnVlLCBhbnN3ZXIgfSkpO1xyXG4gICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoZXJyKTtcclxuICAgICAgcmVzLnN0YXR1c0NvZGUgPSA1MDA7XHJcbiAgICAgIHJlcy5zZXRIZWFkZXIoXCJDb250ZW50LVR5cGVcIiwgXCJhcHBsaWNhdGlvbi9qc29uXCIpO1xyXG4gICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHsgb2s6IGZhbHNlLCBlcnJvcjogZXJyLm1lc3NhZ2UgfSkpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgLy8gMi4gTG9naW4gRW5kcG9pbnQgUm91dGUgSGFuZGxlclxyXG4gIGlmIChyZXEubWV0aG9kID09PSBcIlBPU1RcIiAmJiB1cmwucGF0aG5hbWUgPT09IFwiL2FwaS9sb2dpblwiKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCB7IGVtcGxveWVlSWQsIGZpcmViYXNlQXV0aCB9ID0gYXdhaXQgcmVhZEJvZHkocmVxKTtcclxuICAgICAgY29uc29sZS5sb2coYFtTZXJ2ZXIgQVBJXSBJbnRlcmNlcHRlZCBhdXRoZW50aWNhdGlvbiBsb29wIGZvciBFbXBsb3llZSBJRDogJHtlbXBsb3llZUlkfWApO1xyXG4gICAgICBcclxuICAgICAgcmVzLnNldEhlYWRlcihcIkNvbnRlbnQtVHlwZVwiLCBcImFwcGxpY2F0aW9uL2pzb25cIik7XHJcbiAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoeyBcclxuICAgICAgICBvazogdHJ1ZSwgXHJcbiAgICAgICAgbmFtZTogYE9mZmljZXIgJHtlbXBsb3llZUlkPy5zcGxpdChcIi1cIikucG9wKCkgfHwgZW1wbG95ZWVJZH1gLCBcclxuICAgICAgICBpc0ZpcnN0TG9naW46ICFmaXJlYmFzZUF1dGggXHJcbiAgICAgIH0pKTtcclxuICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGVycik7XHJcbiAgICAgIHJlcy5zdGF0dXNDb2RlID0gNDAwO1xyXG4gICAgICByZXMuc2V0SGVhZGVyKFwiQ29udGVudC1UeXBlXCIsIFwiYXBwbGljYXRpb24vanNvblwiKTtcclxuICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IG9rOiBmYWxzZSwgZXJyb3I6IGVyci5tZXNzYWdlIHx8IFwiSW52YWxpZCBwYXlsb2FkIHZlcmlmaWNhdGlvbiBwYXJhbWV0ZXJzLlwiIH0pKTtcclxuICAgIH1cclxuICAgIHJldHVybjtcclxuICB9XHJcblxyXG4gIG5leHQoKTtcclxufVxyXG5cclxuZnVuY3Rpb24gY2hhdFBsdWdpbigpIHtcclxuICByZXR1cm4ge1xyXG4gICAgbmFtZTogXCJjaGF0LWNvcGlsb3QtYXBpXCIsXHJcbiAgICBjb25maWd1cmVTZXJ2ZXIoc2VydmVyKSB7XHJcbiAgICAgIHNlcnZlci5taWRkbGV3YXJlcy51c2UoaGFuZGxlQ2hhdEFwaSk7XHJcbiAgICB9LFxyXG4gICAgY29uZmlndXJlUHJldmlld1NlcnZlcihzZXJ2ZXIpIHtcclxuICAgICAgc2VydmVyLm1pZGRsZXdhcmVzLnVzZShoYW5kbGVDaGF0QXBpKTtcclxuICAgIH0sXHJcbiAgfTtcclxufVxyXG5cclxuZXhwb3J0IGRlZmF1bHQgY2hhdFBsdWdpbjsiLCAiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIkQ6XFxcXGtzcHBcXFxcbWxcXFxcc2VydmVyXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJEOlxcXFxrc3BwXFxcXG1sXFxcXHNlcnZlclxcXFxnZW1pbmlTZXJ2aWNlLm1qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vRDova3NwcC9tbC9zZXJ2ZXIvZ2VtaW5pU2VydmljZS5tanNcIjtpbXBvcnQgZG5zIGZyb20gXCJub2RlOmRuc1wiO1xuZG5zLnNldERlZmF1bHRSZXN1bHRPcmRlcihcImlwdjRmaXJzdFwiKTtcblxuaW1wb3J0IHsgR29vZ2xlR2VuQUkgfSBmcm9tIFwiQGdvb2dsZS9nZW5haVwiO1xuaW1wb3J0IHsgcXVlcnlDYXNlc0luTWVtb3J5LCByZWFkRXhwbGljaXRUYWJSZWNvcmRzIH0gZnJvbSBcIi4vc2hlZXRzU3RvcmUubWpzXCI7XG5pbXBvcnQgeyBjYXNlc0Zyb21Hb29nbGUgfSBmcm9tIFwiLi9nb29nbGVTaGVldHMubWpzXCI7XG5pbXBvcnQgeyBhcHBseUFjY2Vzc0NvbnRyb2wgfSBmcm9tIFwiLi9yYmFjLm1qc1wiO1xuXG5jb25zdCBHRU1JTklfS0VZUyA9IChwcm9jZXNzLmVudi5HRU1JTklfQVBJX0tFWVMgfHwgcHJvY2Vzcy5lbnYuR0VNSU5JX0FQSV9LRVkgfHwgXCJcIilcbiAgLnNwbGl0KFwiLFwiKVxuICAubWFwKChrKSA9PiBrLnRyaW0oKSlcbiAgLmZpbHRlcihCb29sZWFuKTtcblxuY29uc3QgR1JPUV9LRVlTID0gKHByb2Nlc3MuZW52LkdST1FfQVBJX0tFWVMgfHwgcHJvY2Vzcy5lbnYuR1JPUV9BUElfS0VZIHx8IFwiXCIpXG4gIC5zcGxpdChcIixcIilcbiAgLm1hcCgoaykgPT4gay50cmltKCkpXG4gIC5maWx0ZXIoQm9vbGVhbik7XG5cbmNvbnN0IEZBTExCQUNLX0dFTUlOSV9NT0RFTFMgPSBbXCJnZW1pbmktMi4wLWZsYXNoXCIsIFwiZ2VtaW5pLTEuNS1mbGFzaFwiXTtcbmNvbnN0IEZBTExCQUNLX0dST1FfTU9ERUxTID0gW1wibGxhbWEtMy4zLTcwYi12ZXJzYXRpbGVcIiwgXCJsbGFtYS0zLjEtOGItaW5zdGFudFwiXTtcblxuY29uc3QgU1RPUF9XT1JEUyA9IG5ldyBTZXQoW1xuICBcImdpdmVcIiwgXCJkZXRhaWxzXCIsIFwiY29tcGxldGVcIiwgXCJhYm91dFwiLCBcInRoaXNcIiwgXCJjYXNlXCIsIFwiY2FzZXNcIiwgXCJiZWFyaW5nXCIsXG4gIFwibnVtYmVyXCIsIFwid2l0aFwiLCBcInRvdGFsXCIsIFwicmVjb3JkZWRcIiwgXCJ0b2RheVwiLCBcInNob3dcIiwgXCJ3aGF0XCIsIFwiYXJlXCIsXG4gIFwiaGF2ZVwiLCBcImZyb21cIiwgXCJ0aGF0XCIsIFwid2hpY2hcIiwgXCJ3aWxsXCIsIFwid291bGRcIiwgXCJjb3VsZFwiLCBcInNob3VsZFwiLFxuICBcIm91dHB1dFwiLCBcImthbm5hZGFcIiwgXCJlbmdsaXNoXCIsIFwicGxlYXNlXCIsIFwidGVsbFwiLCBcIm5lZWRcIiwgXCJvbmx5XCIsIFwiYWxzb1wiLFxuICBcImxpc3RcIiwgXCJhbGxcIiwgXCJ0aGVcIiwgXCJmb3JcIiwgXCJhbnlcIiwgXCJpblwiLCBcImF0XCIsIFwib2ZcIiwgXCJpc1wiLCBcImFuZFwiLCBcIm9yXCJcbl0pO1xuXG5mdW5jdGlvbiBub3JtYWxpemVMb2NhdGlvbk9yVGVybSh0ZXJtKSB7XG4gIGNvbnN0IHQgPSBTdHJpbmcodGVybSB8fCBcIlwiKS50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcbiAgaWYgKHQgPT09IFwid2hpdGVmaWxlZFwiIHx8IHQgPT09IFwid2hpdGVmaWVsZFwiKSByZXR1cm4gXCJ3aGl0ZWZpZWxkXCI7XG4gIGlmICh0ID09PSBcImtvcmFtYW5nbGFcIiB8fCB0ID09PSBcImtvcmFtYW5nYWxhXCIpIHJldHVybiBcImtvcmFtYW5nYWxhXCI7XG4gIGlmICh0ID09PSBcImluZHJhbmFnYXJcIiB8fCB0ID09PSBcImluZGlyYW5hZ2FyXCIpIHJldHVybiBcImluZGlyYW5hZ2FyXCI7XG4gIGlmICh0ID09PSBcImJhc2F2YW5ndWRpXCIgfHwgdCA9PT0gXCJiYXNhdmFuYWd1ZGlcIikgcmV0dXJuIFwiYmFzYXZhbmFndWRpXCI7XG4gIHJldHVybiB0O1xufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgY3JpbWUgbnVtYmVycyBmb3IgZmxleGlibGUgbWF0Y2hpbmcuXG4gKiBFLmcuLCBcIjAwMTEvMjAyNlwiLCBcIkNSLTAwMTEvMjAyNlwiLCBhbmQgXCIxMS8yMDI2XCIgYWxsIG5vcm1hbGl6ZSB0byBcIjExLzIwMjZcIi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUNyaW1lTm8oc3RyKSB7XG4gIGlmICghc3RyKSByZXR1cm4gXCJcIjtcbiAgY29uc3QgY2xlYW5lZCA9IFN0cmluZyhzdHIpXG4gICAgLnRyaW0oKVxuICAgIC50b1VwcGVyQ2FzZSgpXG4gICAgLnJlcGxhY2UoL15DUi0/L2ksIFwiXCIpOyAvLyBTdHJpcCBsZWFkaW5nIFwiQ1ItXCIgb3IgXCJDUlwiXG5cbiAgY29uc3QgcGFydHMgPSBjbGVhbmVkLnNwbGl0KFwiL1wiKTtcbiAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMikge1xuICAgIGNvbnN0IHNlcSA9IHBhcnRzWzBdLnJlcGxhY2UoL14wKy8sIFwiXCIpOyAvLyBTdHJpcCBsZWFkaW5nIHplcm9zIGZyb20gc2VxdWVuY2VcbiAgICByZXR1cm4gYCR7c2VxfS8ke3BhcnRzWzFdfWA7XG4gIH1cbiAgcmV0dXJuIGNsZWFuZWQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdlbmVyYXRlV2l0aEdyb3EocHJvbXB0LCBhcGlLZXkpIHtcbiAgZm9yIChjb25zdCBtb2RlbCBvZiBGQUxMQkFDS19HUk9RX01PREVMUykge1xuICAgIHRyeSB7XG4gICAgICBjb25zb2xlLmxvZyhgW0NvcGlsb3QgRW5naW5lXSBDYWxsaW5nIEdyb3EgbW9kZWwgJyR7bW9kZWx9Jy4uLmApO1xuICAgICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goXCJodHRwczovL2FwaS5ncm9xLmNvbS9vcGVuYWkvdjEvY2hhdC9jb21wbGV0aW9uc1wiLCB7XG4gICAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICBcIkF1dGhvcml6YXRpb25cIjogYEJlYXJlciAke2FwaUtleX1gLFxuICAgICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiXG4gICAgICAgIH0sXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBtb2RlbDogbW9kZWwsXG4gICAgICAgICAgbWVzc2FnZXM6IFt7IHJvbGU6IFwidXNlclwiLCBjb250ZW50OiBwcm9tcHQgfV0sXG4gICAgICAgICAgdGVtcGVyYXR1cmU6IDAuMFxuICAgICAgICB9KVxuICAgICAgfSk7XG5cbiAgICAgIGlmIChyZXMub2spIHtcbiAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IHJlcy5qc29uKCk7XG4gICAgICAgIGNvbnN0IHRleHQgPSBkYXRhLmNob2ljZXM/LlswXT8ubWVzc2FnZT8uY29udGVudDtcbiAgICAgICAgaWYgKHRleHQpIHJldHVybiB0ZXh0LnRyaW0oKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IGVyckpzb24gPSBhd2FpdCByZXMuanNvbigpLmNhdGNoKCgpID0+ICh7fSkpO1xuICAgICAgICBjb25zb2xlLndhcm4oYFtDb3BpbG90IEVuZ2luZV0gR3JvcSBtb2RlbCAnJHttb2RlbH0nIEhUVFAgJHtyZXMuc3RhdHVzfTpgLCBlcnJKc29uPy5lcnJvcj8ubWVzc2FnZSB8fCByZXMuc3RhdHVzVGV4dCk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS53YXJuKGBbQ29waWxvdCBFbmdpbmVdIEdyb3EgbW9kZWwgJyR7bW9kZWx9JyBlcnJvcjpgLCBlLm1lc3NhZ2UpO1xuICAgIH1cbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoXCJBbGwgR3JvcSBtb2RlbHMgZmFpbGVkLlwiKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2VuZXJhdGVXaXRoRmFsbGJhY2soZnVsbFByb21wdCkge1xuICBsZXQgbGFzdEVycm9yID0gbnVsbDtcblxuICAvLyAxLiBUcnkgR2VtaW5pIEFQSSBrZXlzXG4gIGZvciAoY29uc3QgbW9kZWxOYW1lIG9mIEZBTExCQUNLX0dFTUlOSV9NT0RFTFMpIHtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IEdFTUlOSV9LRVlTLmxlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBrZXkgPSBHRU1JTklfS0VZU1tpXTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGFpID0gbmV3IEdvb2dsZUdlbkFJKHsgYXBpS2V5OiBrZXkgfSk7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYWkubW9kZWxzLmdlbmVyYXRlQ29udGVudChcbiAgICAgICAgICB7XG4gICAgICAgICAgICBtb2RlbDogbW9kZWxOYW1lLFxuICAgICAgICAgICAgY29udGVudHM6IGZ1bGxQcm9tcHQsXG4gICAgICAgICAgICBjb25maWc6IHsgdGVtcGVyYXR1cmU6IDAuMCB9XG4gICAgICAgICAgfSxcbiAgICAgICAgICB7IHRpbWVvdXQ6IDE1MDAwIH1cbiAgICAgICAgKTtcbiAgICAgICAgcmV0dXJuIHJlc3BvbnNlLnRleHQudHJpbSgpO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGNvbnN0IGVycm9yTXNnID0gZXJyLm1lc3NhZ2UgfHwgU3RyaW5nKGVycik7XG4gICAgICAgIGNvbnNvbGUud2FybihgW0NvcGlsb3QgRW5naW5lXSBcdTI2QTBcdUZFMEYgR2VtaW5pIEtleSAjJHtpICsgMX0gZmFpbGVkIG9uICcke21vZGVsTmFtZX0nICgke2Vyci5zdGF0dXMgfHwgJ1F1b3RhLzQwNCd9KS4gUmV0cnlpbmcuLi5gKTtcbiAgICAgICAgbGFzdEVycm9yID0gZXJyO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIDIuIFRyeSBHcm9xIEFQSSBrZXlzIGFzIGZhbGxiYWNrIGVuZ2luZVxuICBmb3IgKGxldCBpID0gMDsgaSA8IEdST1FfS0VZUy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGtleSA9IEdST1FfS0VZU1tpXTtcbiAgICB0cnkge1xuICAgICAgY29uc29sZS5sb2coYFtDb3BpbG90IEVuZ2luZV0gXHVEODNEXHVERTgwIEV4ZWN1dGluZyByZXF1ZXN0IHZpYSBHcm9xIEVuZ2luZSBLZXkgIyR7aSArIDF9Li4uYCk7XG4gICAgICByZXR1cm4gYXdhaXQgZ2VuZXJhdGVXaXRoR3JvcShmdWxsUHJvbXB0LCBrZXkpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY29uc29sZS53YXJuKGBbQ29waWxvdCBFbmdpbmVdIFx1MjZBMFx1RkUwRiBHcm9xIEtleSAjJHtpICsgMX0gZmFpbGVkOmAsIGVyci5tZXNzYWdlKTtcbiAgICAgIGxhc3RFcnJvciA9IGVycjtcbiAgICB9XG4gIH1cblxuICB0aHJvdyBuZXcgRXJyb3IoYEFsbCBBSSBwcm92aWRlciBrZXlzIGFuZCBtb2RlbHMgZmFpbGVkLiBMYXN0IGVycm9yOiAke2xhc3RFcnJvcj8ubWVzc2FnZX1gKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZpbmRNYXRjaGluZ0Nhc2VzKHF1ZXN0aW9uLCBhbGxDYXNlcykge1xuICBpZiAoIXF1ZXN0aW9uIHx8ICFhbGxDYXNlcyB8fCBhbGxDYXNlcy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgY29uc3QgcUxvd2VyID0gU3RyaW5nKHF1ZXN0aW9uKS50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcbiAgY29uc3QgcUNsZWFuID0gcUxvd2VyLnJlcGxhY2UoL1teXFx3XFwvXFwtXFxzXS9nLCBcIiBcIik7XG5cbiAgY29uc3QgbWF0Y2hlZCA9IG5ldyBTZXQoKTtcblxuICAvLyAxLiBEaXJlY3QgQ2FzZU5vLCBDYXNlTWFzdGVySUQsIENyaW1lTm8gZXhhY3QgbWF0Y2hpbmdcbiAgZm9yIChjb25zdCBjIG9mIGFsbENhc2VzKSB7XG4gICAgaWYgKCFjKSBjb250aW51ZTtcbiAgICBjb25zdCBjYXNlTm8gPSBTdHJpbmcoYy5DYXNlTm8gfHwgXCJcIikudG9Mb3dlckNhc2UoKS50cmltKCk7XG4gICAgY29uc3QgY3JpbWVObyA9IFN0cmluZyhjLkNyaW1lTm8gfHwgXCJcIikudG9Mb3dlckNhc2UoKS50cmltKCk7XG4gICAgY29uc3QgY2FzZU1hc3RlcklkID0gU3RyaW5nKGMuQ2FzZU1hc3RlcklEIHx8IFwiXCIpLnRvTG93ZXJDYXNlKCkudHJpbSgpO1xuICAgIGNvbnN0IG5vcm1DcmltZSA9IG5vcm1hbGl6ZUNyaW1lTm8oYy5DcmltZU5vKS50b0xvd2VyQ2FzZSgpO1xuXG4gICAgLy8gQ2hlY2sgQ2FzZU5vXG4gICAgaWYgKGNhc2VObyAmJiAocUxvd2VyLmluY2x1ZGVzKGNhc2VObykgfHwgcUNsZWFuLmluY2x1ZGVzKGNhc2VObykpKSB7XG4gICAgICBtYXRjaGVkLmFkZChjKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIENoZWNrIENhc2VObyB3aXRob3V0IEZJUi8gcHJlZml4IChlLmcuIDIwMjYvMTA0MilcbiAgICBpZiAoY2FzZU5vLnN0YXJ0c1dpdGgoXCJmaXIvXCIpKSB7XG4gICAgICBjb25zdCBiYXJlTm8gPSBjYXNlTm8ucmVwbGFjZSgvXmZpclxcLy9pLCBcIlwiKTtcbiAgICAgIGlmIChiYXJlTm8gJiYgKHFMb3dlci5pbmNsdWRlcyhiYXJlTm8pIHx8IHFDbGVhbi5pbmNsdWRlcyhiYXJlTm8pKSkge1xuICAgICAgICBtYXRjaGVkLmFkZChjKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQ2hlY2sgQ2FzZU1hc3RlcklEIGFzIGZ1bGwgc3RhbmRhbG9uZSB3b3JkXG4gICAgaWYgKGNhc2VNYXN0ZXJJZCkge1xuICAgICAgY29uc3QgcmUgPSBuZXcgUmVnRXhwKGBcXFxcYiR7Y2FzZU1hc3RlcklkfVxcXFxiYCwgXCJpXCIpO1xuICAgICAgaWYgKHJlLnRlc3QocUNsZWFuKSkge1xuICAgICAgICBtYXRjaGVkLmFkZChjKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQ2hlY2sgQ3JpbWVOb1xuICAgIGlmIChjcmltZU5vICYmIChxTG93ZXIuaW5jbHVkZXMoY3JpbWVObykgfHwgcUNsZWFuLmluY2x1ZGVzKGNyaW1lTm8pKSkge1xuICAgICAgbWF0Y2hlZC5hZGQoYyk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBDaGVjayBub3JtYWxpemVkIENyaW1lTm8gKGUuZy4gQ1ItNjExNC8yMDI2IC0+IDYxMTQvMjAyNilcbiAgICBpZiAobm9ybUNyaW1lICYmIG5vcm1DcmltZS5sZW5ndGggPj0gNCkge1xuICAgICAgY29uc3QgcU5vcm0gPSBub3JtYWxpemVDcmltZU5vKHFMb3dlcikudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmIChxTG93ZXIuaW5jbHVkZXMobm9ybUNyaW1lKSB8fCBxTm9ybS5pbmNsdWRlcyhub3JtQ3JpbWUpKSB7XG4gICAgICAgIG1hdGNoZWQuYWRkKGMpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBpZiAobWF0Y2hlZC5zaXplID4gMCkgcmV0dXJuIEFycmF5LmZyb20obWF0Y2hlZCk7XG5cbiAgLy8gMi4gVG9rZW4gbnVtZXJpYyBtYXRjaGluZyBmb3Igd2hvbGUgbnVtZXJpYyB0b2tlbnMgaW4gcXVlcnlcbiAgY29uc3QgbnVtYmVyc0luUXVlcnkgPSBxQ2xlYW4ubWF0Y2goL1xcYlxcZHszLDE2fVxcYi9nKSB8fCBbXTtcbiAgaWYgKG51bWJlcnNJblF1ZXJ5Lmxlbmd0aCA+IDApIHtcbiAgICBmb3IgKGNvbnN0IGMgb2YgYWxsQ2FzZXMpIHtcbiAgICAgIGlmICghYykgY29udGludWU7XG4gICAgICBjb25zdCBjYXNlTm8gPSBTdHJpbmcoYy5DYXNlTm8gfHwgXCJcIikudG9Mb3dlckNhc2UoKS50cmltKCk7XG4gICAgICBjb25zdCBjYXNlTWFzdGVySWQgPSBTdHJpbmcoYy5DYXNlTWFzdGVySUQgfHwgXCJcIikudG9Mb3dlckNhc2UoKS50cmltKCk7XG4gICAgICBjb25zdCBjcmltZU5vID0gU3RyaW5nKGMuQ3JpbWVObyB8fCBcIlwiKS50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcblxuICAgICAgZm9yIChjb25zdCBudW0gb2YgbnVtYmVyc0luUXVlcnkpIHtcbiAgICAgICAgaWYgKG51bSA9PT0gXCIyMDI2XCIpIGNvbnRpbnVlOyAvLyBza2lwIGNvbW1vbiBjdXJyZW50IHllYXIgc3RhbmRhbG9uZSB0b2tlblxuICAgICAgICBpZiAoY2FzZU1hc3RlcklkID09PSBudW0gfHwgY2FzZU5vID09PSBudW0gfHwgY2FzZU5vLmVuZHNXaXRoKGAvJHtudW19YCkgfHwgY3JpbWVObyA9PT0gbnVtIHx8IGNyaW1lTm8uZW5kc1dpdGgoYC8ke251bX1gKSkge1xuICAgICAgICAgIG1hdGNoZWQuYWRkKGMpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChtYXRjaGVkLnNpemUgPiAwKSByZXR1cm4gQXJyYXkuZnJvbShtYXRjaGVkKTtcbiAgfVxuXG4gIC8vIDMuIERhdGUgLyBBZ2dyZWdhdGUgcXVlcnkgbWF0Y2hpbmcgKGUuZy4gXCJ0b2RheVwiKVxuICBpZiAocUxvd2VyLmluY2x1ZGVzKFwidG9kYXlcIikpIHtcbiAgICBjb25zdCB0b2RheVN0ciA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zcGxpdChcIlRcIilbMF07IC8vIGUuZy4gMjAyNi0wNy0yM1xuICAgIGZvciAoY29uc3QgYyBvZiBhbGxDYXNlcykge1xuICAgICAgaWYgKFN0cmluZyhjLkNyaW1lUmVnaXN0ZXJlZERhdGUgfHwgXCJcIikuc3RhcnRzV2l0aCh0b2RheVN0cikpIHtcbiAgICAgICAgbWF0Y2hlZC5hZGQoYyk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChtYXRjaGVkLnNpemUgPiAwKSByZXR1cm4gQXJyYXkuZnJvbShtYXRjaGVkKTtcbiAgfVxuXG4gIC8vIDQuIE11bHRpLXRlcm0gQ2F0ZWdvcnkgLyBTdGF0aW9uIHNlYXJjaCBtYXRjaGluZyAoZS5nLiBraWRuYXBwaW5nIGluIHdoaXRlZmllbGQpXG4gIGNvbnN0IHRva2VucyA9IHFDbGVhbi5zcGxpdCgvXFxzKy8pLm1hcChub3JtYWxpemVMb2NhdGlvbk9yVGVybSkuZmlsdGVyKHQgPT4gdC5sZW5ndGggPiAyICYmICFTVE9QX1dPUkRTLmhhcyh0KSk7XG4gIGlmICh0b2tlbnMubGVuZ3RoID4gMCkge1xuICAgIC8vIFRyeSBtYXRjaGluZyBBTEwgc2VhcmNoIHRva2VucyBpbiB0aGUgcm93XG4gICAgZm9yIChjb25zdCBjIG9mIGFsbENhc2VzKSB7XG4gICAgICBjb25zdCByb3dTdHIgPSBPYmplY3QudmFsdWVzKGMpLmpvaW4oXCIgXCIpLnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAodG9rZW5zLmV2ZXJ5KHRlcm0gPT4ge1xuICAgICAgICBpZiAodGVybSA9PT0gXCJraWRuYXBwaW5nXCIgfHwgdGVybSA9PT0gXCJhYmR1Y3Rpb25cIikge1xuICAgICAgICAgIHJldHVybiByb3dTdHIuaW5jbHVkZXMoXCJraWRuYXBwaW5nXCIpIHx8IHJvd1N0ci5pbmNsdWRlcyhcImFiZHVjdGlvblwiKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcm93U3RyLmluY2x1ZGVzKHRlcm0pO1xuICAgICAgfSkpIHtcbiAgICAgICAgbWF0Y2hlZC5hZGQoYyk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChtYXRjaGVkLnNpemUgPiAwKSByZXR1cm4gQXJyYXkuZnJvbShtYXRjaGVkKTtcblxuICAgIC8vIEZhbGxiYWNrOiBtYXRjaCBBTlkgc2lnbmlmaWNhbnQgc2VhcmNoIHRva2VuXG4gICAgZm9yIChjb25zdCBjIG9mIGFsbENhc2VzKSB7XG4gICAgICBjb25zdCByb3dTdHIgPSBPYmplY3QudmFsdWVzKGMpLmpvaW4oXCIgXCIpLnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAodG9rZW5zLnNvbWUodGVybSA9PiB7XG4gICAgICAgIGlmICh0ZXJtID09PSBcImtpZG5hcHBpbmdcIiB8fCB0ZXJtID09PSBcImFiZHVjdGlvblwiKSB7XG4gICAgICAgICAgcmV0dXJuIHJvd1N0ci5pbmNsdWRlcyhcImtpZG5hcHBpbmdcIikgfHwgcm93U3RyLmluY2x1ZGVzKFwiYWJkdWN0aW9uXCIpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByb3dTdHIuaW5jbHVkZXModGVybSk7XG4gICAgICB9KSkge1xuICAgICAgICBtYXRjaGVkLmFkZChjKTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKG1hdGNoZWQuc2l6ZSA+IDApIHJldHVybiBBcnJheS5mcm9tKG1hdGNoZWQpO1xuICB9XG5cbiAgcmV0dXJuIFtdO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGFuZGxlQ2hhdFF1ZXJ5KHsgcXVlc3Rpb24sIHJvbGUsIHN0YXRpb25JZCwgbGFuZ3VhZ2UgfSkge1xuICBjb25zb2xlLmxvZyhgW0NvcGlsb3QgRW5naW5lXSBQcm9jZXNzaW5nIHF1ZXJ5OiBcIiR7cXVlc3Rpb259XCJgKTtcbiAgXG4gIHRyeSB7XG4gICAgLy8gMS4gRmV0Y2ggdGFibGVzIHNpbXVsdGFuZW91c2x5XG4gICAgY29uc3QgW2Nhc2VNYXN0ZXJSb3dzLCBhY2N1c2VkUm93cywgY29tcGxhaW5hbnRSb3dzLCBjb25zb2xpZGF0ZWREYXRhXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgIHJlYWRFeHBsaWNpdFRhYlJlY29yZHMoXCJDYXNlTWFzdGVyXCIpLmNhdGNoKCgpID0+IFtdKSxcbiAgICAgIHJlYWRFeHBsaWNpdFRhYlJlY29yZHMoXCJBY2N1c2VkXCIpLmNhdGNoKCgpID0+IFtdKSxcbiAgICAgIHJlYWRFeHBsaWNpdFRhYlJlY29yZHMoXCJDb21wbGFpbmFudERldGFpbHNcIikuY2F0Y2goKCkgPT4gW10pLFxuICAgICAgY2FzZXNGcm9tR29vZ2xlKCkuY2F0Y2goKCkgPT4gKHsgcm93czogW10gfSkpXG4gICAgXSk7XG5cbiAgICAvLyBVc2UgY29uc29saWRhdGVkIHJvd3MgYXMgcHJpbWFyeSBjYXNlIHJlY29yZHMgc2luY2UgaXQgbWVyZ2VzIENhc2VNYXN0ZXIgYW5kIGZ1bGwgZGV0YWlsc1xuICAgIGNvbnN0IGFsbENhc2VzID0gY29uc29saWRhdGVkRGF0YS5yb3dzICYmIGNvbnNvbGlkYXRlZERhdGEucm93cy5sZW5ndGggPiAwXG4gICAgICA/IGNvbnNvbGlkYXRlZERhdGEucm93c1xuICAgICAgOiBjYXNlTWFzdGVyUm93cztcblxuICAgIGxldCBjb250ZXh0dWFsUm93cyA9IGZpbmRNYXRjaGluZ0Nhc2VzKHF1ZXN0aW9uLCBhbGxDYXNlcyk7XG5cbiAgICAvLyBGYWxsYmFjayBDb250ZXh0IEd1YXJkOiBPbmx5IGlmIHF1ZXJ5IGlzIGdlbmVyaWMsIGRlZmF1bHQgdG8gc2FtcGxlIGNhc2VzXG4gICAgY29uc3QgaXNTcGVjaWZpY1NlYXJjaCA9IC9maXJ8Y3ItfFxcZHszLH0vaS50ZXN0KHF1ZXN0aW9uIHx8IFwiXCIpO1xuICAgIGlmIChjb250ZXh0dWFsUm93cy5sZW5ndGggPT09IDAgJiYgIWlzU3BlY2lmaWNTZWFyY2ggJiYgYWxsQ2FzZXMubGVuZ3RoID4gMCkge1xuICAgICAgY29udGV4dHVhbFJvd3MgPSBhbGxDYXNlcy5zbGljZSgwLCA1KTtcbiAgICB9XG5cbiAgICAvLyBTYWZldHkgY29udGV4dCBjYXA6IHByZXZlbnQgcGF5bG9hZCBsaW1pdCBlcnJvcnMgYnkgY2FwcGluZyB0byBtYXggMjAgY2FzZXNcbiAgICBjb250ZXh0dWFsUm93cyA9IGNvbnRleHR1YWxSb3dzLnNsaWNlKDAsIDIwKTtcblxuICAgIGlmIChjb250ZXh0dWFsUm93cy5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiBsYW5ndWFnZSA9PT0gXCJrblwiXG4gICAgICAgID8gXCJcdTBDOTdcdTBDQ0NcdTBDQjBcdTBDQjVcdTBDQkVcdTBDQThcdTBDQ0RcdTBDQjVcdTBDQkZcdTBDQTQgXHUwQzg1XHUwQ0E3XHUwQ0JGXHUwQzk1XHUwQ0JFXHUwQ0IwXHUwQ0JGXHUwQzk3XHUwQ0IzXHUwQ0M3LCBcdTBDQThcdTBDQkZcdTBDQUVcdTBDQ0RcdTBDQUUgXHUwQzg1XHUwQ0E3XHUwQ0JGXHUwQzk1XHUwQ0JFXHUwQ0IwIFx1MENCNVx1MENDRFx1MENBRlx1MENCRVx1MENBQVx1MENDRFx1MENBNFx1MENCRlx1MENBRlx1MENCMlx1MENDRFx1MENCMlx1MENCRiBcdTBDODggXHUwQzk1XHUwQ0M4XHUwQ0FBXHUwQ0JGXHUwQ0ExXHUwQ0JGL1x1MENBNlx1MENDMlx1MENCMFx1MENDMSBcdTBDQjhcdTBDODJcdTBDOTZcdTBDQ0RcdTBDQUZcdTBDQzZcdTBDOTdcdTBDQzYgXHUwQ0I4XHUwQzgyXHUwQ0FDXHUwQzgyXHUwQ0E3XHUwQ0JGXHUwQ0I4XHUwQ0JGXHUwQ0E2IFx1MENBRlx1MENCRVx1MENCNVx1MENDMVx1MENBNlx1MENDNyBcdTBDQTZcdTBDQkVcdTBDOTZcdTBDQjJcdTBDQzZcdTBDOTdcdTBDQjNcdTBDQzEgXHUwQzk1XHUwQzgyXHUwQ0ExXHUwQ0MxXHUwQ0FDXHUwQzgyXHUwQ0E2XHUwQ0JGXHUwQ0IyXHUwQ0NEXHUwQ0IyLlwiXG4gICAgICAgIDogXCJSZXNwZWN0ZnVsIGdyZWV0aW5ncyBPZmZpY2VyLiBCYXNlZCBvbiB0aGUgdmVyaWZpZWQgZGF0YWJhc2UgcmVjb3JkcyBjdXJyZW50bHkgYXZhaWxhYmxlLCBubyBjYXNlIHJlY29yZHMgd2VyZSBmb3VuZCBtYXRjaGluZyB5b3VyIHF1ZXJ5LlwiO1xuICAgIH1cblxuICAgIC8vIDIuIEluamVjdCByZWxhdGlvbmFsIGRldGFpbHMgb250byB0aGUgY2FzZSBibG9ja3Mgc2FmZWx5XG4gICAgY29udGV4dHVhbFJvd3MgPSBjb250ZXh0dWFsUm93cy5tYXAoY0Nhc2UgPT4ge1xuICAgICAgaWYgKCFjQ2FzZSkgcmV0dXJuIHt9O1xuICAgICAgY29uc3QgY2FzZUlkID0gU3RyaW5nKGNDYXNlLkNhc2VNYXN0ZXJJRCB8fCBcIlwiKS50cmltKCk7XG4gICAgICBcbiAgICAgIGNvbnN0IHJlbGF0ZWRBY2N1c2VkTGlzdCA9IGFjY3VzZWRSb3dzXG4gICAgICAgIC5maWx0ZXIoYSA9PiBhICYmIFN0cmluZyhhLkNhc2VNYXN0ZXJJRCB8fCBcIlwiKS50cmltKCkgPT09IGNhc2VJZClcbiAgICAgICAgLm1hcChhID0+IGAke2EuQWNjdXNlZE5hbWUgfHwgXCJVbmtub3duXCJ9IChBZ2U6ICR7YS5BZ2VZZWFyIHx8IFwiTi9BXCJ9LCBHZW5kZXI6ICR7YS5HZW5kZXJJRCB8fCBcIk4vQVwifSlgKVxuICAgICAgICAuam9pbihcIlxcblwiKTtcblxuICAgICAgY29uc3QgcmVsYXRlZENvbXBsYWluYW50cyA9IGNvbXBsYWluYW50Um93c1xuICAgICAgICAuZmlsdGVyKGMgPT4gYyAmJiBTdHJpbmcoYy5DYXNlTWFzdGVySUQgfHwgXCJcIikudHJpbSgpID09PSBjYXNlSWQpXG4gICAgICAgIC5tYXAoYyA9PiBgTmFtZTogJHtjLkNvbXBsYWluYW50TmFtZSB8fCBcIk4vQVwifVxcbkNvbXBsYWluYW50IElEOiAke2MuQ29tcGxhaW5hbnRJRCB8fCBcIk4vQVwifVxcbkFnZTogJHtjLkFnZVllYXIgfHwgXCJOL0FcIn0gWWVhcnNcXG5HZW5kZXIgSUQ6ICR7Yy5HZW5kZXJJRCB8fCBcIk4vQVwifVxcbk9jY3VwYXRpb24gSUQ6ICR7Yy5PY2N1cGF0aW9uSUQgfHwgXCJOL0FcIn1cXG5SZWxpZ2lvbiBJRDogJHtjLlJlbGlnaW9uSUQgfHwgXCJOL0FcIn1cXG5DYXN0ZSBJRDogJHtjLkNhc3RlSUQgfHwgXCJOL0FcIn1gKVxuICAgICAgICAuam9pbihcIlxcblwiKTtcbiAgICAgIFxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4uY0Nhc2UsXG4gICAgICAgIExpbmtlZEFjY3VzZWRQcm9maWxlczogY0Nhc2UuQWNjdXNlZE5hbWVzIHx8IHJlbGF0ZWRBY2N1c2VkTGlzdCB8fCBcIk5vbmUgbGlzdGVkLlwiLFxuICAgICAgICBUYXJnZXRDb21wbGFpbmFudERldGFpbHM6IGNDYXNlLkNvbXBsYWluYW50IHx8IHJlbGF0ZWRDb21wbGFpbmFudHMgfHwgXCJOb25lIGxpc3RlZC5cIlxuICAgICAgfTtcbiAgICB9KTtcblxuICAgIC8vIEFwcGx5IFJvbGUtQmFzZWQgQWNjZXNzIENvbnRyb2wgZmlsdGVyc1xuICAgIGNvbnN0IGhlYWRlcnMgPSBhbGxDYXNlcy5sZW5ndGggPiAwID8gT2JqZWN0LmtleXMoYWxsQ2FzZXNbMF0pIDogW107XG4gICAgY29uc3QgZmluYWxGaWx0ZXJlZFJvd3MgPSBxdWVyeUNhc2VzSW5NZW1vcnkoY29udGV4dHVhbFJvd3MsIFsuLi5oZWFkZXJzLCBcIkxpbmtlZEFjY3VzZWRQcm9maWxlc1wiLCBcIlRhcmdldENvbXBsYWluYW50RGV0YWlsc1wiXSwgYXBwbHlBY2Nlc3NDb250cm9sKHt9LCByb2xlLCBzdGF0aW9uSWQpKTtcblxuICAgIGlmIChmaW5hbEZpbHRlcmVkUm93cy5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiBsYW5ndWFnZSA9PT0gXCJrblwiXG4gICAgICAgID8gXCJcdTBDOTdcdTBDQ0NcdTBDQjBcdTBDQjVcdTBDQkVcdTBDQThcdTBDQ0RcdTBDQjVcdTBDQkZcdTBDQTQgXHUwQzg1XHUwQ0E3XHUwQ0JGXHUwQzk1XHUwQ0JFXHUwQ0IwXHUwQ0JGXHUwQzk3XHUwQ0IzXHUwQ0M3LCBcdTBDQThcdTBDQkZcdTBDQUVcdTBDQ0RcdTBDQUUgXHUwQzg1XHUwQ0E3XHUwQ0JGXHUwQzk1XHUwQ0JFXHUwQ0IwIFx1MENCNVx1MENDRFx1MENBRlx1MENCRVx1MENBQVx1MENDRFx1MENBNFx1MENCRlx1MENBRlx1MENCMlx1MENDRFx1MENCMlx1MENCRiBcdTBDODggXHUwQ0I5XHUwQ0M2XHUwQ0I4XHUwQ0IwXHUwQ0JGXHUwQzk3XHUwQ0M2IFx1MENCOFx1MEM4Mlx1MENBQ1x1MEM4Mlx1MENBN1x1MENCRlx1MENCOFx1MENCRlx1MENBNiBcdTBDQUZcdTBDQkVcdTBDQjVcdTBDQzFcdTBDQTZcdTBDQzcgXHUwQ0E2XHUwQ0JFXHUwQzk2XHUwQ0IyXHUwQ0M2XHUwQzk3XHUwQ0IzXHUwQ0MxIFx1MEM5NVx1MEM4Mlx1MENBMVx1MENDMVx1MENBQ1x1MEM4Mlx1MENBNlx1MENCRlx1MENCMlx1MENDRFx1MENCMi5cIlxuICAgICAgICA6IFwiUmVzcGVjdGZ1bCBncmVldGluZ3MgT2ZmaWNlci4gQmFzZWQgb24gdGhlIHZlcmlmaWVkIGRhdGFiYXNlIHJlY29yZHMgY3VycmVudGx5IGF2YWlsYWJsZSwgdGhlcmUgYXJlIG5vIHJlY29yZHMgZm91bmQgbWF0Y2hpbmcgdGhlIHJlcXVlc3RlZCBxdWVyeSB3aXRoaW4geW91ciBhdXRob3JpemF0aW9uIHNjb3BlLlwiO1xuICAgIH1cblxuICAgIC8vIDMuIEJ1aWxkIHByb21wdCBwYXlsb2FkIGZvciBHZW1pbmkgLyBHcm9xXG4gICAgY29uc3QgaXNLYW5uYWRhID0gbGFuZ3VhZ2UgPT09IFwia25cIiB8fCAvW1xcdTBDODAtXFx1MENGRl0vLnRlc3QocXVlc3Rpb24gfHwgXCJcIik7XG5cbiAgICBjb25zdCBmb3JtYXR0ZWRDb250ZXh0ID0gZmluYWxGaWx0ZXJlZFJvd3MubWFwKChyb3csIGkpID0+IHtcbiAgICAgIGNvbnN0IGZpZWxkcyA9IE9iamVjdC5lbnRyaWVzKHJvdykubWFwKChbaywgdl0pID0+IGAgICAtICR7a306ICR7dn1gKS5qb2luKFwiXFxuXCIpO1xuICAgICAgcmV0dXJuIGBbQ0FTRSBEQVRBIEJMT0NLICMke2kgKyAxfV1cXG4ke2ZpZWxkc31gO1xuICAgIH0pLmpvaW4oXCJcXG5cXG5cIik7XG5cbiAgICBjb25zdCB0b3RhbFN5c3RlbUNvdW50ID0gYWxsQ2FzZXMubGVuZ3RoO1xuICAgIGNvbnN0IHRvZGF5U3RyID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNwbGl0KFwiVFwiKVswXTtcbiAgICBjb25zdCB0b2RheUNvdW50ID0gYWxsQ2FzZXMuZmlsdGVyKHIgPT4gU3RyaW5nKHIuQ3JpbWVSZWdpc3RlcmVkRGF0ZSB8fCBcIlwiKS5zdGFydHNXaXRoKHRvZGF5U3RyKSkubGVuZ3RoO1xuXG4gICAgY29uc3QgcHJvbXB0ID0gaXNLYW5uYWRhID8gYFxuWW91IGFyZSB0aGUgb2ZmaWNpYWwgS2FybmF0YWthIFBvbGljZSBDb3BpbG90IEFJIEFzc2lzdGFudC4gWW91ciB0YXNrIGlzIHRvIGludGVsbGlnZW50bHkgZnVsZmlsbCB0aGUgdXNlcidzIHJlcXVlc3QgdXNpbmcgdGhlIHZlcmlmaWVkIGRhdGFiYXNlIHJlY29yZHMgcHJvdmlkZWQgYmVsb3cuXG5cblNZU1RFTSBEQVRBQkFTRSBPVkVSVklFVzpcbi0gXHUwQzkyXHUwQzlGXHUwQ0NEXHUwQzlGXHUwQ0MxIFx1MENBNlx1MENCRVx1MEM5Nlx1MENCMlx1MENCRVx1MENBNiBcdTBDQUFcdTBDQ0RcdTBDQjBcdTBDOTVcdTBDQjBcdTBDQTNcdTBDOTdcdTBDQjNcdTBDQzEgKFRvdGFsIGNhc2VzIGluIERCKTogJHt0b3RhbFN5c3RlbUNvdW50fVxuLSBcdTBDODdcdTBDODJcdTBDQTZcdTBDQzEgXHUwQ0E2XHUwQ0JFXHUwQzk2XHUwQ0IyXHUwQ0JFXHUwQ0E2IFx1MENBQVx1MENDRFx1MENCMFx1MEM5NVx1MENCMFx1MENBM1x1MEM5N1x1MENCM1x1MENDMSAoJHt0b2RheVN0cn0pOiAke3RvZGF5Q291bnR9XG4tIFx1MEM4OCBcdTBDQjVcdTBDQkZcdTBDQThcdTBDODJcdTBDQTRcdTBDQkZcdTBDOTdcdTBDQzYgXHUwQ0I4XHUwQ0JGXHUwQzk1XHUwQ0NEXHUwQzk1IFx1MEM5Mlx1MEM5Rlx1MENDRFx1MEM5Rlx1MENDMSBcdTBDQUFcdTBDQ0RcdTBDQjBcdTBDOTVcdTBDQjBcdTBDQTNcdTBDOTdcdTBDQjMgXHUwQ0I4XHUwQzgyXHUwQzk2XHUwQ0NEXHUwQ0FGXHUwQ0M2OiAke2ZpbmFsRmlsdGVyZWRSb3dzLmxlbmd0aH1cblxuU1RSSUNUIExBTkdVQUdFIE1BTkRBVEU6XG4tIFlvdSBNVVNUIHJlYWQsIHByb2Nlc3MsIGFuZCByZXNwb25kIEVYQ0xVU0lWRUxZIGluIEthbm5hZGEgKFx1MEM5NVx1MENBOFx1MENDRFx1MENBOFx1MENBMSkuXG4tIEV2ZXJ5IHNpbmdsZSBsYWJlbCwgaGVhZGVyLCBzdGF0dXMsIGFuZCBzdW1tYXJ5IHNlbnRlbmNlIE1VU1QgYmUgd3JpdHRlbiBpbiBwcm9wZXIgS2FubmFkYSBzY3JpcHQuXG4tIERvIE5PVCB1c2UgRW5nbGlzaCBsYWJlbHMgbGlrZSBcIkNhc2UgTnVtYmVyXCIsIFwiT2ZmZW5jZVwiLCBcIkNvbXBsYWluYW50XCIsIFwiU3VtbWFyeVwiIHdoZW4gaW4gS2FubmFkYSBtb2RlLlxuXG5SRVFVSVJFRCBLQU5OQURBIEZPUk1BVCBMQVlPVVQgKFx1MENCOFx1MEM4Mlx1MEM5NVx1MENDRFx1MENCN1x1MENCRlx1MENBQVx1MENDRFx1MENBNCBcdTBDQUVcdTBDQTRcdTBDQ0RcdTBDQTRcdTBDQzEgXHUwQ0I4XHUwQ0NEXHUwQ0FBXHUwQ0I3XHUwQ0NEXHUwQzlGIFx1MENBOFx1MENDQlx1MEM5Rik6XG5cdTBDQUFcdTBDQ0RcdTBDQjBcdTBDQjZcdTBDQ0RcdTBDQThcdTBDQzZcdTBDOTdcdTBDQzYgXHUwQ0E4XHUwQ0M3XHUwQ0IwXHUwQ0I1XHUwQ0JFXHUwQzk3XHUwQ0JGIFx1MEM4OVx1MENBNFx1MENDRFx1MENBNFx1MENCMFx1MENCRlx1MENCOFx1MENCRjogXHUwQ0I1XHUwQ0JGXHUwQ0E4XHUwQzgyXHUwQ0E0XHUwQ0JGXHUwQzk3XHUwQ0M2IFx1MENCOFx1MEM4Mlx1MENBQ1x1MEM4Mlx1MENBN1x1MENCRlx1MENCOFx1MENCRlx1MENBNiBcdTBDOTJcdTBDOUZcdTBDQ0RcdTBDOUZcdTBDQzEgXHUwQ0FBXHUwQ0NEXHUwQ0IwXHUwQzk1XHUwQ0IwXHUwQ0EzXHUwQzk3XHUwQ0IzIFx1MENCOFx1MEM4Mlx1MEM5Nlx1MENDRFx1MENBRlx1MENDNiAqKiR7ZmluYWxGaWx0ZXJlZFJvd3MubGVuZ3RofSoqLlxuXG5cdTBDQUFcdTBDQ0RcdTBDQjBcdTBDQTRcdTBDQkZcdTBDQUZcdTBDQ0FcdTBDODJcdTBDQTZcdTBDQzEgXHUwQ0FBXHUwQ0NEXHUwQ0IwXHUwQzk1XHUwQ0IwXHUwQ0EzXHUwQ0E2IFx1MENCNVx1MENCRlx1MENCNVx1MENCMFx1MEM5N1x1MENCM1x1MENBOFx1MENDRFx1MENBOFx1MENDMSBcdTBDODggXHUwQzk1XHUwQ0M2XHUwQ0IzXHUwQzk3XHUwQ0JGXHUwQ0E4XHUwQzgyXHUwQ0E0XHUwQ0M2IFx1MENCOFx1MEM4Mlx1MEM5NVx1MENDRFx1MENCN1x1MENCRlx1MENBQVx1MENDRFx1MENBNFx1MENCNVx1MENCRVx1MEM5N1x1MENCRiBcdTBDQThcdTBDQzBcdTBDQTFcdTBDQkY6XG5cdUQ4M0RcdURDQ0MgKipcdTBDQUFcdTBDQ0RcdTBDQjBcdTBDOTVcdTBDQjBcdTBDQTNcdTBDQTYgXHUwQ0I4XHUwQzgyXHUwQzk2XHUwQ0NEXHUwQ0FGXHUwQ0M2OioqIFtDYXNlTm9dIChcdTBDODVcdTBDQUFcdTBDQjBcdTBDQkVcdTBDQTcgXHUwQ0I4XHUwQzgyXHUwQzk2XHUwQ0NEXHUwQ0FGXHUwQ0M2OiBbQ3JpbWVOb10pXG5cdUQ4M0NcdURGRjdcdUZFMEYgKipcdTBDODVcdTBDQUFcdTBDQjBcdTBDQkVcdTBDQTdcdTBDQTYgXHUwQ0FBXHUwQ0NEXHUwQ0IwXHUwQzk1XHUwQ0JFXHUwQ0IwOioqIFtDcmltZUhlYWRdIC0gW0NyaW1lU3ViSGVhZF0gKFtHcmF2aXR5IGluIEthbm5hZGFdKVxuXHVEODNDXHVERkRCXHVGRTBGICoqXHUwQ0FBXHUwQ0NBXHUwQ0IyXHUwQ0MwXHUwQ0I4XHUwQ0NEIFx1MENBMFx1MENCRVx1MENBM1x1MENDNiBcdTBDQUVcdTBDQTRcdTBDQ0RcdTBDQTRcdTBDQzEgXHUwQ0E0XHUwQ0E4XHUwQ0JGXHUwQzk2XHUwQ0JFXHUwQ0E3XHUwQ0JGXHUwQzk1XHUwQ0JFXHUwQ0IwXHUwQ0JGOioqIFtQb2xpY2VTdGF0aW9uIGluIEthbm5hZGFdIHwgW09mZmljZXIgaW4gS2FubmFkYV0gKElEOiBbRW1wbG95ZWVJRF0pXG5cdUQ4M0RcdURDNjQgKipcdTBDQTZcdTBDQzJcdTBDQjBcdTBDQzFcdTBDQTZcdTBDQkVcdTBDQjBcdTBDQjBcdTBDQzE6KiogW0NvbXBsYWluYW50IGluIEthbm5hZGFdXG5cdUQ4M0RcdURFQTggKipcdTBDODZcdTBDQjBcdTBDQ0JcdTBDQUFcdTBDQkZcdTBDOTdcdTBDQjNcdTBDQzE6KiogW0FjY3VzZWROYW1lcyBpbiBLYW5uYWRhXVxuXHVEODNEXHVEQ0NBICoqXHUwQ0FBXHUwQ0NEXHUwQ0IwXHUwQ0I4XHUwQ0NEXHUwQ0E0XHUwQ0MxXHUwQ0E0IFx1MENCOFx1MENDRFx1MENBNVx1MENCRlx1MENBNFx1MENCRjoqKiBbU3RhdHVzIGluIEthbm5hZGFdIHwgXHUwQ0E4XHUwQ0NEXHUwQ0FGXHUwQ0JFXHUwQ0FGXHUwQ0JFXHUwQ0IyXHUwQ0FGOiBbQ291cnQgaW4gS2FubmFkYV0gfCBcdTBDOUFcdTBDQkVcdTBDQjBcdTBDQ0RcdTBDOUNcdTBDQ0RcdTIwMENcdTBDQjZcdTBDQzBcdTBDOUZcdTBDQ0Q6IFtDaGFyZ2VzaGVldFN0YXR1cyBpbiBLYW5uYWRhXVxuXHVEODNEXHVEQ0M1ICoqXHUwQ0I4XHUwQ0FFXHUwQ0FGXHUwQ0JFXHUwQ0I1XHUwQ0E3XHUwQ0JGOioqIFx1MEM5OFx1MEM5Rlx1MENBOFx1MENDNjogW0luY2lkZW50RnJvbURhdGVdIHwgXHUwQ0E4XHUwQ0NCXHUwQzgyXHUwQ0E2XHUwQ0EzXHUwQ0JGIFx1MENBNlx1MENCRlx1MENBOFx1MENCRVx1MEM4Mlx1MEM5NTogW0NyaW1lUmVnaXN0ZXJlZERhdGVdXG5cdUQ4M0RcdURDREQgKipcdTBDQjhcdTBDODJcdTBDOTVcdTBDQ0RcdTBDQjdcdTBDQkZcdTBDQUFcdTBDQ0RcdTBDQTQgXHUwQ0I4XHUwQ0JFXHUwQ0IwXHUwQ0JFXHUwQzgyXHUwQ0I2OioqIFsxLTIgXHUwQ0I1XHUwQ0JFXHUwQzk1XHUwQ0NEXHUwQ0FGXHUwQzk3XHUwQ0IzXHUwQ0IyXHUwQ0NEXHUwQ0IyXHUwQ0JGIFx1MENCOFx1MEM4Mlx1MENBQVx1MENDMlx1MENCMFx1MENDRFx1MENBMyBcdTBDOThcdTBDOUZcdTBDQThcdTBDQzZcdTBDQUYgXHUwQ0I4XHUwQ0NEXHUwQ0FBXHUwQ0I3XHUwQ0NEXHUwQzlGIFx1MEM5NVx1MENBOFx1MENDRFx1MENBOFx1MENBMSBcdTBDQjhcdTBDQkVcdTBDQjBcdTBDQkVcdTBDODJcdTBDQjZdXG5cblZlcmlmaWVkIENhc2UgU3lzdGVtIENvbnRleHQ6XG5cIlwiXCJcbiR7Zm9ybWF0dGVkQ29udGV4dH1cblwiXCJcIlxuXG5Vc2VyIFF1ZXJ5OiBcIiR7cXVlc3Rpb259XCJcbmAgOiBgXG5Zb3UgYXJlIHRoZSBvZmZpY2lhbCBLYXJuYXRha2EgUG9saWNlIENvcGlsb3QgQUkgQXNzaXN0YW50LiBZb3VyIHRhc2sgaXMgdG8gaW50ZWxsaWdlbnRseSBmdWxmaWxsIHRoZSB1c2VyJ3MgcmVxdWVzdCB1c2luZyB0aGUgdmVyaWZpZWQgZGF0YWJhc2UgcmVjb3JkcyBwcm92aWRlZCBiZWxvdy5cblxuU1lTVEVNIERBVEFCQVNFIE9WRVJWSUVXOlxuLSBUb3RhbCBjYXNlcyByZWNvcmRlZCBpbiBkYXRhYmFzZTogJHt0b3RhbFN5c3RlbUNvdW50fVxuLSBUb3RhbCBjYXNlcyByZWNvcmRlZCB0b2RheSAoJHt0b2RheVN0cn0pOiAke3RvZGF5Q291bnR9XG4tIFRvdGFsIGNhc2VzIG1hdGNoaW5nIHRoaXMgcmVxdWVzdDogJHtmaW5hbEZpbHRlcmVkUm93cy5sZW5ndGh9XG5cbklOVEVOVCBERVRFQ1RJT04gJiBSRVNQT05TRSBQUk9UT0NPTFM6XG4xLiBMQU5HVUFHRSBDT05TVFJBSU5UOiBZb3UgbXVzdCByZWFkLCBwcm9jZXNzLCBhbmQgcmVzcG9uZCBFWENMVVNJVkVMWSBpbiBFbmdsaXNoLlxuMi4gQ09OQ0lTRSAmIEhJR0hMWSBSRUFEQUJMRSBTVU1NQVJZIChBVCBBIEdMQU5DRSk6XG4gICAtIFByZXNlbnQgT05MWSB0aGUga2V5LCByZWxldmFudCwgYW5kIGltcG9ydGFudCBjYXNlIGRldGFpbHMuIE1ha2UgaXQgdW5kZXJzdGFuZGFibGUgYXQgYSBzaW5nbGUgZ2xhbmNlLlxuICAgLSBBbnN3ZXIgcXVlcnkgY291bnQgcXVlc3Rpb25zIGRpcmVjdGx5IChlLmcuIFwiVG90YWwgY2FzZXMgbWF0Y2hpbmcgcmVxdWVzdDogJHtmaW5hbEZpbHRlcmVkUm93cy5sZW5ndGh9XCIpLlxuICAgLSBEbyBOT1QgcHJpbnQgbG9uZyBtdWx0aS1zZWN0aW9uIHRlbXBsYXRlcyB3aXRoIGJsYW5rIElEIGZpZWxkcyBvciByYXcgbnVtZXJpYyBJRHMuXG5cbkZvciBzaW5nbGUgb3IgbXVsdGlwbGUgY2FzZXMsIGxpc3QgZWFjaCBjYXNlIHVzaW5nIHRoaXMgY2xlYW4gbGF5b3V0OlxuXHVEODNEXHVEQ0NDICoqQ2FzZSBOdW1iZXI6KiogW0Nhc2VOb10gKENyaW1lIE5vOiBbQ3JpbWVOb10pXG5cdUQ4M0NcdURGRjdcdUZFMEYgKipPZmZlbmNlOioqIFtDcmltZUhlYWRdIC0gW0NyaW1lU3ViSGVhZF0gKFtHcmF2aXR5XSlcblx1RDgzQ1x1REZEQlx1RkUwRiAqKlN0YXRpb24gJiBJTzoqKiBbUG9saWNlU3RhdGlvbl0gfCBbT2ZmaWNlclJhbmtdIFtPZmZpY2VyXSAoSUQ6IFtFbXBsb3llZUlEXSlcblx1RDgzRFx1REM2NCAqKkNvbXBsYWluYW50OioqIFtDb21wbGFpbmFudF1cblx1RDgzRFx1REVBOCAqKkFjY3VzZWQ6KiogW0FjY3VzZWROYW1lc11cblx1RDgzRFx1RENDQSAqKlN0YXR1czoqKiBbU3RhdHVzXSB8IENvdXJ0OiBbQ291cnRdIHwgQ2hhcmdlc2hlZXQ6IFtDaGFyZ2VzaGVldFN0YXR1c11cblx1RDgzRFx1RENDNSAqKlRpbWVsaW5lOioqIEluY2lkZW50OiBbSW5jaWRlbnRGcm9tRGF0ZV0gfCBSZWdpc3RlcmVkOiBbQ3JpbWVSZWdpc3RlcmVkRGF0ZV1cblx1RDgzRFx1RENERCAqKlN1bW1hcnk6KiogWzEtMiBzZW50ZW5jZXMgc3VtbWFyaXppbmcgdGhlIGNvcmUgaW5jaWRlbnQgZmFjdHMgY2xlYXJseSBhbmQgY29uY2lzZWx5XVxuXG5WZXJpZmllZCBDYXNlIFN5c3RlbSBDb250ZXh0OlxuXCJcIlwiXG4ke2Zvcm1hdHRlZENvbnRleHR9XG5cIlwiXCJcblxuVXNlciBRdWVyeTogXCIke3F1ZXN0aW9ufVwiXG5gO1xuXG4gICAgcmV0dXJuIGF3YWl0IGdlbmVyYXRlV2l0aEZhbGxiYWNrKHByb21wdCk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGNvbnNvbGUuZXJyb3IoYFtDb3BpbG90IEVuZ2luZSBDcml0aWNhbCBFeGNlcHRpb24gRXJyb3IgU3RhdGVdOmAsIGVycik7XG4gICAgcmV0dXJuIFwiRXJyb3I6IEJhY2tlbmQgZ2VuZXJhdGlvbiBjeWNsZSBpbnRlcnJ1cHRlZCBkdWUgdG8gcmF0ZSBjb25zdHJhaW50cyBvciBkYXRhYmFzZSBuZXR3b3JrIGlzc3Vlcy4gUGxlYXNlIHRyeSBhZ2Fpbi5cIjtcbiAgfVxufVxuIiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxrc3BwXFxcXG1sXFxcXHNlcnZlclwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRDpcXFxca3NwcFxcXFxtbFxcXFxzZXJ2ZXJcXFxcc2hlZXRzU3RvcmUubWpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9EOi9rc3BwL21sL3NlcnZlci9zaGVldHNTdG9yZS5tanNcIjsvLyBzZXJ2ZXIvc2hlZXRzU3RvcmUubWpzXHJcbmltcG9ydCB7IEdvb2dsZUF1dGggfSBmcm9tIFwiZ29vZ2xlLWF1dGgtbGlicmFyeVwiO1xyXG5pbXBvcnQgcGF0aCBmcm9tIFwibm9kZTpwYXRoXCI7XHJcbmltcG9ydCBmcyBmcm9tIFwibm9kZTpmc1wiO1xyXG5cclxuY29uc3QgU1BSRUFEU0hFRVRfSUQgPSBwcm9jZXNzLmVudi5HT09HTEVfU0hFRVRfSUQgfHwgXCIxc0V4Q09PVkpEVDZKNjhETTkzRV9RUGJaR3NfLVJ6UE9sZlhBQ1lkOG1TNFwiO1xyXG5jb25zdCBTSEVFVF9HSUQgPSBOdW1iZXIocHJvY2Vzcy5lbnYuR09PR0xFX1NIRUVUX0dJRCB8fCBcIjIxMjI1MTM1NjZcIik7XHJcblxyXG4vLyBST09UIFJFU09MVVRJT046IFBvaW50IGRpcmVjdGx5IHRvIHRoZSByb290IG9mIHRoZSBwcm9qZWN0IHdoZXJlIHlvdXIgZmlsZSBhY3R1YWxseSBzaXRzXHJcbmNvbnN0IEtFWV9GSUxFID0gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksIFwic2VydmljZS1hY2NvdW50Lmpzb25cIik7XHJcblxyXG5sZXQgY2FjaGUgPSB7IGhlYWRlcnM6IFtdLCByZWNvcmRzOiBbXSwgZmV0Y2hlZEF0OiAwIH07XHJcbmxldCBzaGVldFRpdGxlQ2FjaGUgPSBudWxsO1xyXG5sZXQgYXV0aENsaWVudCA9IG51bGw7XHJcblxyXG5hc3luYyBmdW5jdGlvbiBnZXRBdXRoQ2xpZW50KCkge1xyXG4gIGlmIChhdXRoQ2xpZW50KSByZXR1cm4gYXV0aENsaWVudDtcclxuICBcclxuICBpZiAoIWZzLmV4aXN0c1N5bmMoS0VZX0ZJTEUpKSB7XHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFNlcnZpY2UgYWNjb3VudCBrZXkgbm90IGZvdW5kIGF0IGFic29sdXRlIGxvY2F0aW9uOiAke0tFWV9GSUxFfWApO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgYXV0aCA9IG5ldyBHb29nbGVBdXRoKHtcclxuICAgIGtleUZpbGU6IEtFWV9GSUxFLFxyXG4gICAgc2NvcGVzOiBbXCJodHRwczovL3d3dy5nb29nbGVhcGlzLmNvbS9hdXRoL3NwcmVhZHNoZWV0cy5yZWFkb25seVwiXSxcclxuICB9KTtcclxuICBhdXRoQ2xpZW50ID0gYXdhaXQgYXV0aC5nZXRDbGllbnQoKTtcclxuICByZXR1cm4gYXV0aENsaWVudDtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZVNoZWV0VGl0bGUoY2xpZW50KSB7XHJcbiAgaWYgKHNoZWV0VGl0bGVDYWNoZSkgcmV0dXJuIHNoZWV0VGl0bGVDYWNoZTtcclxuICBjb25zdCB1cmwgPSBgaHR0cHM6Ly9zaGVldHMuZ29vZ2xlYXBpcy5jb20vdjQvc3ByZWFkc2hlZXRzLyR7U1BSRUFEU0hFRVRfSUR9P2ZpZWxkcz1zaGVldHMocHJvcGVydGllcyhzaGVldElkLHRpdGxlKSlgO1xyXG4gIGNvbnN0IHJlcyA9IGF3YWl0IGNsaWVudC5yZXF1ZXN0KHsgdXJsIH0pO1xyXG4gIGNvbnN0IHNoZWV0cyA9IHJlcy5kYXRhLnNoZWV0cyB8fCBbXTtcclxuICBcclxuICBjb25zdCBtYXRjaCA9IHNoZWV0cy5maW5kKChzKSA9PiBzLnByb3BlcnRpZXMudGl0bGUgPT09IFwiQ2FzZU1hc3RlclwiKSB8fCBcclxuICAgICAgICAgICAgICAgIHNoZWV0cy5maW5kKChzKSA9PiBzLnByb3BlcnRpZXMudGl0bGUuaW5jbHVkZXMoXCJDb25zb2xpZGF0ZWRcIikpIHx8XHJcbiAgICAgICAgICAgICAgICBzaGVldHMuZmluZCgocykgPT4gcy5wcm9wZXJ0aWVzLnNoZWV0SWQgPT09IFNIRUVUX0dJRCk7XHJcbiAgXHJcbiAgaWYgKCFtYXRjaCkge1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZCBub3QgZmluZCBhIHZhbGlkIHRhcmdldCBjYXNlcyB0YWIgKGxpa2UgJ0Nhc2VNYXN0ZXInKSBpbiB0aGlzIHNwcmVhZHNoZWV0LmApO1xyXG4gIH1cclxuICBcclxuICBzaGVldFRpdGxlQ2FjaGUgPSBtYXRjaC5wcm9wZXJ0aWVzLnRpdGxlO1xyXG4gIGNvbnNvbGUubG9nKGBbU2hlZXRzIFN0b3JlIEF1dG9tYXRpb25dIFN1Y2Nlc3NmdWxseSBib3VuZCB0YXJnZXQgdGFiIHRvOiBcIiR7c2hlZXRUaXRsZUNhY2hlfVwiYCk7XHJcbiAgcmV0dXJuIHNoZWV0VGl0bGVDYWNoZTtcclxufVxyXG5cclxuZnVuY3Rpb24gcGFyc2VWYWx1ZXModmFsdWVzKSB7XHJcbiAgaWYgKCF2YWx1ZXMgfHwgdmFsdWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHsgaGVhZGVyczogW10sIHJlY29yZHM6IFtdIH07XHJcbiAgY29uc3QgaGVhZGVycyA9IHZhbHVlc1swXTtcclxuICBjb25zdCByZWNvcmRzID0gdmFsdWVzLnNsaWNlKDEpLm1hcCgocm93KSA9PiB7XHJcbiAgICBjb25zdCByZWNvcmQgPSB7fTtcclxuICAgIGhlYWRlcnMuZm9yRWFjaCgoaCwgaSkgPT4gKHJlY29yZFtoXSA9IHJvd1tpXSA/PyBcIlwiKSk7XHJcbiAgICByZXR1cm4gcmVjb3JkO1xyXG4gIH0pO1xyXG4gIHJldHVybiB7IGhlYWRlcnMsIHJlY29yZHMgfTtcclxufVxyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlYWRFeHBsaWNpdFRhYlJlY29yZHModGFiTmFtZSkge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBjbGllbnQgPSBhd2FpdCBnZXRBdXRoQ2xpZW50KCk7XHJcbiAgICBjb25zdCByYW5nZSA9IGVuY29kZVVSSUNvbXBvbmVudChgJyR7dGFiTmFtZS5yZXBsYWNlKC8nL2csIFwiJydcIil9J2ApO1xyXG4gICAgY29uc3QgdXJsID0gYGh0dHBzOi8vc2hlZXRzLmdvb2dsZWFwaXMuY29tL3Y0L3NwcmVhZHNoZWV0cy8ke1NQUkVBRFNIRUVUX0lEfS92YWx1ZXMvJHtyYW5nZX1gO1xyXG4gICAgY29uc3QgcmVzID0gYXdhaXQgY2xpZW50LnJlcXVlc3QoeyB1cmwgfSk7XHJcbiAgICBjb25zdCB7IHJlY29yZHMgfSA9IHBhcnNlVmFsdWVzKHJlcy5kYXRhLnZhbHVlcyk7XHJcbiAgICByZXR1cm4gcmVjb3JkcztcclxuICB9IGNhdGNoIChlcnIpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoYFtTaGVldHMgU3RvcmUgTGlua2VyIEVycm9yXSBGYWlsZWQgZmV0Y2hpbmcgdGFiIGNvbnRlbnQgZm9yOiBcIiR7dGFiTmFtZX1cImAsIGVyci5tZXNzYWdlKTtcclxuICAgIHJldHVybiBbXTtcclxuICB9XHJcbn1cclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWFkU2hlZXRDYXNlcyh7IGZvcmNlUmVmcmVzaCA9IGZhbHNlIH0gPSB7fSkge1xyXG4gIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XHJcbiAgaWYgKCFmb3JjZVJlZnJlc2ggJiYgY2FjaGUucmVjb3Jkcy5sZW5ndGggJiYgbm93IC0gY2FjaGUuZmV0Y2hlZEF0IDwgQ0FDSEVfVFRMX01TKSB7XHJcbiAgICByZXR1cm4geyBoZWFkZXJzOiBjYWNoZS5oZWFkZXJzLCByZWNvcmRzOiBjYWNoZS5yZWNvcmRzIH07XHJcbiAgfVxyXG5cclxuICBjb25zdCBjbGllbnQgPSBhd2FpdCBnZXRBdXRoQ2xpZW50KCk7XHJcbiAgY29uc3QgdGl0bGUgPSBhd2FpdCByZXNvbHZlU2hlZXRUaXRsZShjbGllbnQpO1xyXG4gIGNvbnN0IHJhbmdlID0gZW5jb2RlVVJJQ29tcG9uZW50KGAnJHt0aXRsZS5yZXBsYWNlKC8nL2csIFwiJydcIil9J2ApO1xyXG4gIGNvbnN0IHVybCA9IGBodHRwczovL3NoZWV0cy5nb29nbGVhcGlzLmNvbS92NC9zcHJlYWRzaGVldHMvJHtTUFJFQURTSEVFVF9JRH0vdmFsdWVzLyR7cmFuZ2V9YDtcclxuICBjb25zdCByZXMgPSBhd2FpdCBjbGllbnQucmVxdWVzdCh7IHVybCB9KTtcclxuICBjb25zdCB7IGhlYWRlcnMsIHJlY29yZHMgfSA9IHBhcnNlVmFsdWVzKHJlcy5kYXRhLnZhbHVlcyk7XHJcblxyXG4gIGNhY2hlID0geyBoZWFkZXJzLCByZWNvcmRzLCBmZXRjaGVkQXQ6IG5vdyB9O1xyXG4gIHJldHVybiB7IGhlYWRlcnMsIHJlY29yZHMgfTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHF1ZXJ5Q2FzZXNJbk1lbW9yeShyZWNvcmRzLCBoZWFkZXJzLCBmaWx0ZXJTcGVjID0ge30sIGxpbWl0ID0gMjAwKSB7XHJcbiAgbGV0IHJvd3MgPSByZWNvcmRzO1xyXG4gIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGZpbHRlclNwZWMpKSB7XHJcbiAgICBpZiAoIWhlYWRlcnMuaW5jbHVkZXMoa2V5KSB8fCB2YWx1ZSA9PSBudWxsIHx8IHZhbHVlID09PSBcIlwiKSBjb250aW51ZTtcclxuICAgIGNvbnN0IG5lZWRsZSA9IFN0cmluZyh2YWx1ZSkudG9Mb3dlckNhc2UoKTtcclxuICAgIHJvd3MgPSByb3dzLmZpbHRlcigocm93KSA9PiBTdHJpbmcocm93W2tleV0gPz8gXCJcIikudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhuZWVkbGUpKTtcclxuICB9XHJcbiAgcmV0dXJuIHJvd3Muc2xpY2UoMCwgbGltaXQpO1xyXG59IiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxrc3BwXFxcXG1sXFxcXHNlcnZlclwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRDpcXFxca3NwcFxcXFxtbFxcXFxzZXJ2ZXJcXFxccmJhYy5tanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0Q6L2tzcHAvbWwvc2VydmVyL3JiYWMubWpzXCI7ZXhwb3J0IGNvbnN0IFJPTEVfUlVMRVMgPSB7XHJcbiAgQ29uc3RhYmxlOiB7IGZvcmNlU3RhdGlvbkZpbHRlcjogdHJ1ZSB9LFxyXG4gIEluc3BlY3RvcjogeyBmb3JjZVN0YXRpb25GaWx0ZXI6IGZhbHNlIH0sXHJcbiAgU1A6IHsgZm9yY2VTdGF0aW9uRmlsdGVyOiBmYWxzZSB9LFxyXG59O1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGdldFJ1bGVzKHJvbGUpIHtcclxuICByZXR1cm4gUk9MRV9SVUxFU1tyb2xlXSB8fCBST0xFX1JVTEVTLkNvbnN0YWJsZTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5QWNjZXNzQ29udHJvbChmaWx0ZXJTcGVjLCByb2xlLCBzdGF0aW9uSWQpIHtcclxuICBjb25zdCBydWxlcyA9IGdldFJ1bGVzKHJvbGUpO1xyXG4gIGNvbnN0IG1lcmdlZCA9IHsgLi4uZmlsdGVyU3BlYyB9O1xyXG4gIGlmIChydWxlcy5mb3JjZVN0YXRpb25GaWx0ZXIgJiYgc3RhdGlvbklkKSB7XHJcbiAgICBtZXJnZWQuUG9saWNlU3RhdGlvbiA9IHN0YXRpb25JZDsgXHJcbiAgfVxyXG4gIHJldHVybiBtZXJnZWQ7XHJcbn1cclxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFzTixTQUFTLG9CQUFvQjtBQUNuUCxPQUFPLFdBQVc7OztBQ0QrTixPQUFPLFlBQVk7QUFDcFEsT0FBTyxR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QVMsS0FBSztBQUNaLGNBQVEsTUFBTSxHQUFHO0FBQ2pCLFVBQUksYUFBYTtBQUNqQixVQUFJLFVBQVUsZ0JBQWdCLGtCQUFrQjtBQUNoRCxVQUFJLElBQUksS0FBSyxVQUFVLEVBQUUsSUFBSSxPQUFPLE9BQU8sSUFBSSxXQUFXLDJDQUEyQyxDQUFDLENBQUM7QUFBQSxJQUN6RztBQUNBO0FBQUEsRUFDRjtBQUVBLE9BQUs7QUFDUDtBQUVBLFNBQVMsYUFBYTtBQUNwQixTQUFPO0FBQUEsSUFDTCxNQUFNO0FBQUEsSUFDTixnQkFBZ0IsUUFBUTtBQUN0QixhQUFPLFlBQVksSUFBSSxhQUFhO0FBQUEsSUFDdEM7QUFBQSxJQUNBLHVCQUF1QixRQUFRO0FBQzdCLGFBQU8sWUFBWSxJQUFJLGFBQWE7QUFBQSxJQUN0QztBQUFBLEVBQ0Y7QUFDRjtBQUVBLElBQU8scUJBQVE7OztBSDFHZixJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTO0FBQUEsSUFDUCxNQUFNO0FBQUEsSUFDTixzQkFBYztBQUFBLElBQ2QsbUJBQVc7QUFBQSxFQUNiO0FBQUEsRUFDQSxRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixPQUFPO0FBQUEsTUFDTCxRQUFRO0FBQUEsUUFDTixRQUFRO0FBQUEsUUFDUixjQUFjO0FBQUEsUUFDZCxRQUFRLENBQUMsUUFBUTtBQUNmLGdCQUFNLE1BQU0sSUFBSSxPQUFPO0FBQ3ZCLGNBQUksSUFBSSxXQUFXLE1BQU0sR0FBRztBQUMxQixtQkFBTztBQUFBLFVBQ1Q7QUFBQSxRQUNGO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFsia2V5IiwgInBhdGgiLCAiZnMiLCAicGF0aCIsICJmcyIsICJoZWFkZXJzIiwgIkNPTlNPTElEQVRFRF9TSEVFVF9JRCIsICJyZWNvcmQiLCAiTUFTVEVSX1NIRUVUX0lEIiwgImRucyIsICJwYXRoIiwgImZzIiwgInBhdGgiLCAiZnMiLCAibm9ybWFsaXplQ3JpbWVObyIsICJkbnMiLCAibm9ybWFsaXplQ3JpbWVObyIsICJyZWFkQm9keSJdCn0K
