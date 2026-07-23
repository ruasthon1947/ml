import "dotenv/config";
import dns from "node:dns";
import { handleChatQuery } from "./geminiService.mjs";

// Force Node.js to resolve IPv4 addresses first to fix ETIMEDOUT / fetch failed errors
dns.setDefaultResultOrder("ipv4first");

/**
 * Normalizes crime numbers for flexible matching.
 * E.g., "0011/2026", "CR-0011/2026", and "11/2026" all normalize to "11/2026".
 */
export function normalizeCrimeNo(str) {
  if (!str) return "";
  const cleaned = String(str)
    .trim()
    .toUpperCase()
    .replace(/^CR-?/i, ""); // Strip leading "CR-" or "CR"

  const parts = cleaned.split("/");
  if (parts.length === 2) {
    const seq = parts[0].replace(/^0+/, ""); // Strip leading zeros from sequence
    return `${seq}/${parts[1]}`;
  }
  return cleaned;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
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

  // 1. Chat Endpoint Route Handler
  if (req.method === "POST" && url.pathname === "/api/chat") {
    try {
      const { question, role, stationId, language } = await readBody(req);

      // Extract and normalize any crime numbers (e.g. 0011/2026 or CR-0011/2026) in the user's question
      const crimeNoRegex = /(?:CR-?)?\b\d{1,4}\/\d{4}\b/gi;
      const normalizedQuestion = String(question || "").replace(crimeNoRegex, (match) => {
        return normalizeCrimeNo(match);
      });

      const answer = await handleChatQuery({ 
        question, 
        normalizedQuestion, 
        normalizedCrimeNo: normalizeCrimeNo(question),
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

  // 2. Login Endpoint Route Handler
  if (req.method === "POST" && url.pathname === "/api/login") {
    try {
      const { employeeId, firebaseAuth } = await readBody(req);
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
    },
  };
}

export default chatPlugin;