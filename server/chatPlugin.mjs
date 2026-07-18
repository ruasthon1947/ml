import "dotenv/config";
import { handleChatQuery } from "./geminiService.mjs";

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

async function handleChatApi(req, res, next) {
  const url = new URL(req.url || "/", "http://local-chat");

  // 1. Existing Chat Endpoint Route Handler
  if (req.method === "POST" && url.pathname === "/api/chat") {
    try {
      const { question, role, stationId, language } = await readBody(req);
      const answer = await handleChatQuery({ question, role, stationId, language });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, answer }));
    } catch (err) {
      console.error(err);
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // 2. Added Login Endpoint Route Handler to prevent authentication hangs
  if (req.method === "POST" && url.pathname === "/api/login") {
    try {
      const { employeeId, firebaseAuth } = await readBody(req);
      console.log(`[Server API] Intercepted authentication loop for Employee ID: ${employeeId}`);
      
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ 
        ok: true, 
        name: `Officer ${employeeId.split("-").pop() || employeeId}`, 
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