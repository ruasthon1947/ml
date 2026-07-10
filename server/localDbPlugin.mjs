import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CSV_FILE = path.join(process.cwd(), "local_db", "Consolidated_Cases.csv");
const DB_DIR = path.dirname(CSV_FILE);
const PENDING_CSV_FILE = path.join(DB_DIR, "Consolidated_Cases.pending.csv");
const IMPORT_SCRIPT = path.join(DB_DIR, "import_data.py");

const OPTION_FIELDS = [
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
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function escapeCsvCell(value) {
  const text = value == null ? "" : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function stringifyCsv(headers, records) {
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const record of records) {
    lines.push(headers.map((header) => escapeCsvCell(record[header] || "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function replaceFileWithRetry(source, target, options = {}) {
  let lastError = null;
  const retryableCodes = new Set(["EPERM", "EACCES", "EBUSY"]);
  const attempts = options.attempts ?? 10;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.renameSync(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (!retryableCodes.has(error?.code)) {
        throw error;
      }
      sleepSync(Math.min(60 + attempt * 30, 300));
    }
  }

  try {
    fs.copyFileSync(source, target);
    fs.unlinkSync(source);
    return;
  } catch (error) {
    lastError = error;
  }

  try {
    fs.writeFileSync(target, fs.readFileSync(source, "utf8"), "utf8");
    fs.unlinkSync(source);
    return;
  } catch (error) {
    lastError = error;
  }

  const details = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Could not update Consolidated_Cases.csv because Windows is still locking it. ` +
      `Close the CSV if it is open in Excel or another viewer, then try again. ` +
      `A safe temp copy was kept at ${source}. Original error: ${details}`,
  );
}

function fileMtime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function promotePendingDatabase() {
  if (!fs.existsSync(PENDING_CSV_FILE)) return false;
  if (fileMtime(CSV_FILE) > fileMtime(PENDING_CSV_FILE)) return false;

  try {
    replaceFileWithRetry(PENDING_CSV_FILE, CSV_FILE, { attempts: 3 });
    return true;
  } catch {
    return false;
  }
}

function activeDatabaseFile() {
  promotePendingDatabase();
  if (fs.existsSync(PENDING_CSV_FILE) && fileMtime(PENDING_CSV_FILE) >= fileMtime(CSV_FILE)) {
    return PENDING_CSV_FILE;
  }
  return CSV_FILE;
}

function readDatabase() {
  const databaseFile = activeDatabaseFile();
  if (!fs.existsSync(databaseFile)) {
    throw new Error(`Missing CSV file at ${CSV_FILE}`);
  }

  const text = fs.readFileSync(databaseFile, "utf8");
  const table = parseCsv(text);
  const headers = table[0] || [];
  const records = table.slice(1).filter((row) => row.some(Boolean)).map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = row[index] || "";
    });
    return record;
  });

  return { headers, records };
}

function writeDatabase(headers, records) {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const tmp = path.join(DB_DIR, `Consolidated_Cases.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, stringifyCsv(headers, records), "utf8");
  try {
    replaceFileWithRetry(tmp, CSV_FILE, { attempts: 8 });
    if (fs.existsSync(PENDING_CSV_FILE)) {
      try {
        fs.unlinkSync(PENDING_CSV_FILE);
      } catch {
        // The pending copy is only a cache. If Windows keeps it for a moment,
        // the next write/read will replace or promote it.
      }
    }
    return { pending: false, file: CSV_FILE };
  } catch (error) {
    try {
      replaceFileWithRetry(tmp, PENDING_CSV_FILE, { attempts: 8 });
      return { pending: true, file: PENDING_CSV_FILE, error };
    } catch (pendingError) {
      throw new Error(
        `Could not update local_db. Main CSV error: ${
          error instanceof Error ? error.message : String(error)
        }. Pending CSV error: ${
          pendingError instanceof Error ? pendingError.message : String(pendingError)
        }`,
      );
    }
  }
}

function normalizeValue(value) {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).join("; ");
  }
  return String(value).trim();
}

function splitList(value) {
  return String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function nextNumericValue(records, field, fallback) {
  const max = records.reduce((current, record) => {
    const n = Number.parseInt(record[field], 10);
    return Number.isFinite(n) ? Math.max(current, n) : current;
  }, 0);
  return String(max > 0 ? max + 1 : fallback);
}

function generateCrimeNo(records) {
  const max = records.reduce((current, record) => {
    const n = Number.parseInt(String(record.CrimeNo || "").replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? Math.max(current, n) : current;
  }, 0);
  if (max > 0) return String(max + 1);
  return `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
}

function caseMatches(record, key) {
  const wanted = decodeURIComponent(String(key || "")).trim();
  if (!wanted) return false;
  return [record.CaseMasterID, record.CaseNo, record.CrimeNo].some(
    (value) => String(value || "").trim() === wanted,
  );
}

function findCaseIndex(records, keyOrFields) {
  if (typeof keyOrFields === "string") {
    return records.findIndex((record) => caseMatches(record, keyOrFields));
  }

  const fields = keyOrFields || {};
  const keys = [fields.CaseMasterID, fields.CaseNo, fields.CrimeNo].filter(Boolean);
  return records.findIndex((record) => keys.some((key) => caseMatches(record, key)));
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

function buildOptions(records) {
  const options = {};
  for (const field of OPTION_FIELDS) {
    const values = new Set();
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

function runImportData(csvFile = activeDatabaseFile()) {
  if (!fs.existsSync(IMPORT_SCRIPT)) {
    return {
      ok: false,
      skipped: true,
      message: "local_db/import_data.py was not found.",
    };
  }

  const envPython = process.env.LOCAL_DB_PYTHON || process.env.PYTHON;
  const bundledPython =
    process.platform === "win32"
      ? path.resolve(path.dirname(process.execPath), "..", "..", "python", "python.exe")
      : path.resolve(path.dirname(process.execPath), "..", "..", "python", "bin", "python");
  const rawCandidates = [
    envPython && { cmd: envPython, args: [IMPORT_SCRIPT] },
    fs.existsSync(bundledPython) && { cmd: bundledPython, args: [IMPORT_SCRIPT] },
    ...(process.platform === "win32"
      ? [
          { cmd: "python", args: [IMPORT_SCRIPT] },
          { cmd: "py", args: ["-3", IMPORT_SCRIPT] },
          { cmd: "python3", args: [IMPORT_SCRIPT] },
        ]
      : [
          { cmd: "python3", args: [IMPORT_SCRIPT] },
          { cmd: "python", args: [IMPORT_SCRIPT] },
        ]),
  ].filter(Boolean);
  const seen = new Set();
  const candidates = rawCandidates.filter((candidate) => {
    const key = [candidate.cmd, ...candidate.args].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  for (const candidate of candidates) {
    const result = spawnSync(candidate.cmd, candidate.args, {
      cwd: DB_DIR,
      encoding: "utf8",
      timeout: 120000,
      env: {
        ...process.env,
        CONSOLIDATED_CASES_CSV: csvFile,
        PYTHONIOENCODING: "utf-8",
      },
    });

    if (result.error && result.error.code === "ENOENT") {
      continue;
    }

    if (result.error) {
      return {
        ok: false,
        skipped: false,
        command: [candidate.cmd, ...candidate.args].join(" "),
        message: result.error.message,
      };
    }

    return {
      ok: result.status === 0,
      skipped: false,
      command: [candidate.cmd, ...candidate.args].join(" "),
      exitCode: result.status,
      stdout: (result.stdout || "").trim(),
      stderr: (result.stderr || "").trim(),
    };
  }

  return {
    ok: false,
    skipped: true,
    message: "No Python executable was found to run local_db/import_data.py.",
  };
}

function upsertCase(key, payload) {
  const { headers, records } = readDatabase();
  const fields = payload.case || payload.fields || payload;
  const knownFields = {};

  for (const header of headers) {
    if (Object.prototype.hasOwnProperty.call(fields, header)) {
      knownFields[header] = normalizeValue(fields[header]);
    }
  }

  let index = findCaseIndex(records, key || knownFields);
  const created = index === -1;
  const record = {};
  headers.forEach((header) => {
    record[header] = created ? "" : records[index][header] || "";
  });

  Object.assign(record, knownFields);

  if (!record.CaseMasterID) {
    record.CaseMasterID = nextNumericValue(records, "CaseMasterID", 1);
  }
  if (!record.CaseNo) {
    const year = new Date().getFullYear();
    record.CaseNo = nextNumericValue(records, "CaseNo", Number(`${year}00001`));
  }
  if (!record.CrimeNo) {
    record.CrimeNo = generateCrimeNo(records);
  }

  recalcDerivedFields(record);

  if (created) {
    records.push(record);
    index = records.length - 1;
  } else {
    records[index] = record;
  }

  const writeResult = writeDatabase(headers, records);
  const sync = payload.skipSync
    ? {
        ok: true,
        skipped: true,
        message: writeResult.pending
          ? "Saved to a pending local copy because Consolidated_Cases.csv is locked. Google Sheets will still use the latest data on Submit FIR."
          : "Sync skipped by request.",
      }
    : runImportData(writeResult.file);

  return { headers, record: records[index], records, created, sync, writeResult };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10_000_000) {
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
  if (!url.pathname.startsWith("/api/")) {
    next();
    return;
  }

  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        csv: CSV_FILE,
        activeCsv: activeDatabaseFile(),
        pendingCsv: PENDING_CSV_FILE,
        pendingCsvExists: fs.existsSync(PENDING_CSV_FILE),
        importScript: IMPORT_SCRIPT,
        importScriptExists: fs.existsSync(IMPORT_SCRIPT),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/cases") {
      const { headers, records } = readDatabase();
      sendJson(res, 200, { ok: true, headers, cases: records, options: buildOptions(records) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/cases/sync") {
      sendJson(res, 200, { ok: true, sync: runImportData() });
      return;
    }

    const caseMatch = url.pathname.match(/^\/api\/cases\/([^/]+)$/);
    if (req.method === "GET" && caseMatch) {
      const { headers, records } = readDatabase();
      const record = records.find((item) => caseMatches(item, caseMatch[1]));
      if (!record) {
        sendError(res, 404, "Case was not found.");
        return;
      }
      sendJson(res, 200, { ok: true, headers, case: record, options: buildOptions(records) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/cases") {
      const payload = await readBody(req);
      const result = upsertCase("", payload);
      sendJson(res, 200, {
        ok: true,
        created: result.created,
        headers: result.headers,
        case: result.record,
        options: buildOptions(result.records),
        sync: result.sync,
      });
      return;
    }

    if ((req.method === "PATCH" || req.method === "PUT") && caseMatch) {
      const payload = await readBody(req);
      const result = upsertCase(caseMatch[1], payload);
      sendJson(res, 200, {
        ok: true,
        created: result.created,
        headers: result.headers,
        case: result.record,
        options: buildOptions(result.records),
        sync: result.sync,
      });
      return;
    }

    sendError(res, 404, "Unknown local_db API endpoint.");
  } catch (error) {
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
    },
  };
}

export default localDbPlugin;
