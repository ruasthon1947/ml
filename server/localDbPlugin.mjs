import { casesFromGoogle, upsertCaseInGoogle, employeeById, updateEmployee, writeTable, readTable } from "./googleSheets.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import { parse } from "csv-parse/sync";

const execFileAsync = promisify(execFile);

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

const OPTION_FIELDS = [
  "CrimeHead", "CrimeSubHead", "PoliceStation", "PoliceStationType", "District",
  "Court", "Officer", "OfficerRank", "OfficerDesignation", "Status",
  "CaseCategory", "Gravity", "Acts", "Sections", "ChargesheetStatus"
];

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

function generateCrimeNo(records) {
  const currentYear = new Date().getFullYear();
  let maxSeq = 0;
  for (const record of records) {
    const parts = String(record.CrimeNo || "").split("/");
    if (parts.length === 2 && parts[1] === String(currentYear)) {
      const seq = parseInt(parts[0], 10);
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
  return [record.CaseMasterID, record.CaseNo, record.CrimeNo].some(
    (value) => String(value || "").trim() === wanted,
  );
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
    if (req.method === "POST" && url.pathname === "/api/login") {
      const { employeeId, password, firebaseAuth } = await readBody(req);
      if (!employeeId || (!password && !firebaseAuth)) {
        sendError(res, 400, "Employee ID and password are required.");
        return;
      }
      const { row } = await employeeById(employeeId);
      if (!row) {
        sendError(res, 401, "Invalid credentials.");
        return;
      }
      if (!firebaseAuth && row.FirstAuth !== password) {
        sendError(res, 401, "Invalid credentials.");
        return;
      }
      sendJson(res, 200, { ok: true, employeeId, name: row.Name || employeeId, isFirstLogin: row.HasLoggedIn !== "TRUE" });
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
      if (notificationPref !== undefined) updates.NotificationPref = String(notificationPref);
      
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
        const tempCsv = path.join(process.cwd(), "scratch", "temp_sync.csv");
        const exportScript = path.join(process.cwd(), "local_db", "export_data.py");
        const env = { ...process.env, GOOGLE_SERVICE_ACCOUNT_JSON: process.env.CATALYST_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON };
        
        await execFileAsync("python", [exportScript, "--output", tempCsv], { env });
        
        if (fs.existsSync(tempCsv)) {
          const csvData = fs.readFileSync(tempCsv, "utf8");
          const records = parse(csvData, { columns: true, skip_empty_lines: true });
          if (records.length > 0) {
            const headers = Object.keys(records[0]);
            const CONSOLIDATED_SHEET_ID = process.env.GOOGLE_CONSOLIDATED_SHEET_ID || "1uyzVgCAPZW9CkzkNHFKH0QOJm_nbn5Sr4ul9ngv0ZoM";
            const tab = process.env.GOOGLE_CONSOLIDATED_TAB || "Consolidated_Cases";
            
            await writeTable(CONSOLIDATED_SHEET_ID, tab, headers, records);
          }
          fs.unlinkSync(tempCsv); // Cleanup
        }
        
        const { headers, rows } = await casesFromGoogle();
        sendJson(res, 200, {
          ok: true,
          pull: { ok: true },
          writeResult: { pending: false },
          headers,
          cases: rows,
          options: buildOptions(rows),
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

    if ((req.method === "POST" && url.pathname === "/api/cases") || ((req.method === "PATCH" || req.method === "PUT") && caseMatch)) {
      const payload = await readBody(req);
      const { headers, rows: records } = await casesFromGoogle();
      const fields = payload.case || payload.fields || payload;
      
      const key = caseMatch ? caseMatch[1] : "";
      
      const knownFields = {};
      for (const [key, value] of Object.entries(fields)) {
        knownFields[key] = normalizeValue(value);
      }

      let index = records.findIndex((record) => caseMatches(record, key || knownFields.CrimeNo || knownFields.CaseNo));
      const created = index === -1;
      
      const record = {};
      headers.forEach((header) => {
        record[header] = created ? "" : records[index][header] || "";
      });
      Object.assign(record, knownFields);

      if (!record.CaseMasterID) record.CaseMasterID = nextNumericValue(records, "CaseMasterID", 1);
      if (!record.CaseNo) {
        const year = new Date().getFullYear();
        record.CaseNo = nextNumericValue(records, "CaseNo", Number(`${year}00001`));
      }
      if (!record.CrimeNo) record.CrimeNo = generateCrimeNo(records);
      recalcDerivedFields(record);
      
      await upsertCaseInGoogle(record);
      
      // Simulate Push Notification
      try {
        const MASTER_SHEET_ID = process.env.GOOGLE_CONSOLIDATED_SHEET_ID || "1uyzVgCAPZW9CkzkNHFKH0QOJm_nbn5Sr4ul9ngv0ZoM";
        const employeesTab = await readTable(MASTER_SHEET_ID, "Employee");
        const unitsTab = await readTable(MASTER_SHEET_ID, "Unit");
        
        const station = record.PoliceStation || record.Station;
        if (station) {
          let targetUnitId = String(station);
          const unitMatch = unitsTab.rows.find(u => u.UnitName && u.UnitName.trim().toLowerCase() === station.trim().toLowerCase());
          if (unitMatch) {
            targetUnitId = String(unitMatch.UnitID);
          }

          const matchingEmployees = employeesTab.rows.filter(e => 
            String(e.UnitID) === targetUnitId && e.PhoneNumber && e.PhoneNumber.trim() !== ""
          );
          if (matchingEmployees.length > 0) {
            console.log(`\n[PUSH NOTIFICATION TRIGGER]`);
            console.log(`Case Update: ${record.CrimeNo || record.CaseNo} at ${station}`);
            matchingEmployees.forEach(emp => {
              console.log(` -> Sending SMS/Push to Officer ${emp.Name} at ${emp.PhoneNumber}`);
            });
            console.log(`---------------------------\n`);
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
        options: buildOptions(records), // Might be slightly outdated compared to the just pushed row, but acceptable
        sync: { ok: true, skipped: false, message: "Directly saved to Google Sheets" },
      });
      return;
    }

    sendError(res, 404, "Unknown API endpoint.");
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
