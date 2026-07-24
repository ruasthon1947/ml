/**
 * smsPlugin.mjs
 * Vite server plugin that exposes three SMS routes backed by Twilio:
 *
 *   POST /api/sms/send-otp    { phone: "9876543210" }
 *   POST /api/sms/verify-otp  { phone: "9876543210", otp: "391847" }
 *   POST /api/sms/alert       { phones: ["9876543210"], message: "..." }
 *
 * OTPs are kept in a server-side in-memory Map with a 10-minute TTL.
 * Nothing is ever sent to the browser bundle (no VITE_ prefix used).
 */

import "dotenv/config";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

// In-memory OTP store: phone -> { otp, expiresAt }
const otpStore = new Map();
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ─── helpers ────────────────────────────────────────────────────────────────

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) { resolve({}); return; }
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function sendError(res, status, msg) {
  sendJson(res, status, { ok: false, error: String(msg) });
}

// ─── Twilio callers ──────────────────────────────────────────────────────────

/**
 * Formats a phone number to E.164, defaulting to +91 for 10-digit Indian numbers.
 */
function toE164(phone) {
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return `+${digits}`;
}

/**
 * Sends an SMS via Twilio.
 * @param {string} to      E.164 formatted phone number
 * @param {string} body    Message text
 */
async function twilioSend(to, body) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    throw new Error("Twilio credentials (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER) are not set in .env");
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");

  const params = new URLSearchParams({
    To: to,
    From: TWILIO_PHONE_NUMBER,
    Body: body,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `Twilio error ${res.status}`);
  }
  return data;
}

/**
 * Sends an OTP SMS via Twilio.
 * @param {string} phone  10-digit Indian mobile number (no country code)
 * @param {string} otp    6-digit OTP string
 */
async function sendOtpSms(phone, otp) {
  const to = toE164(phone);
  return twilioSend(to, `Your verification code is: ${otp}. Valid for 10 minutes. Do not share this with anyone.`);
}

/**
 * Sends a plain-text alert SMS to one or more numbers via Twilio.
 * @param {string[]} phones  Array of 10-digit mobile numbers
 * @param {string}   message The text to send
 */
async function sendAlertSms(phones, message) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.warn("[smsPlugin] Twilio credentials not set — skipping alert SMS");
    return;
  }
  if (!phones || phones.length === 0) return;

  for (const p of phones) {
    const to = toE164(p);
    try {
      await twilioSend(to, message);
      console.log(`[smsPlugin] Alert SMS sent to ${to}`);
    } catch (err) {
      console.error(`[smsPlugin] Alert SMS error for ${to}:`, err.message);
    }
  }
}

// ─── route handler ───────────────────────────────────────────────────────────

async function handleSms(req, res, next) {
  const url = new URL(req.url || "/", "http://local");

  if (!url.pathname.startsWith("/api/sms/")) {
    next();
    return;
  }

  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }

  try {
    // ── POST /api/sms/send-otp ──────────────────────────────────────────────
    if (req.method === "POST" && url.pathname === "/api/sms/send-otp") {
      const { phone } = await readBody(req);
      const digits = String(phone || "").replace(/\D/g, "").slice(-10);

      if (digits.length !== 10) {
        sendError(res, 400, "A valid 10-digit Indian mobile number is required.");
        return;
      }

      const otp = generateOtp();
      otpStore.set(digits, { otp, expiresAt: Date.now() + OTP_TTL_MS });

      const isProd = process.env.NODE_ENV === "production";

      try {
        await sendOtpSms(digits, otp);
        console.log(`[smsPlugin] ✅ OTP ${otp} sent via Twilio to +91${digits}`);
        sendJson(res, 200, { ok: true, message: "OTP sent successfully." });
      } catch (err) {
        // SMS delivery failed — log OTP in dev so you can still test
        console.warn(`\n${"─".repeat(60)}`);
        console.warn(`[smsPlugin] ⚠️  Twilio SMS failed: ${err.message}`);
        console.warn(`[smsPlugin] 📱 DEV FALLBACK — OTP for +91${digits}: ${otp}`);
        console.warn(`${"─".repeat(60)}\n`);

        if (isProd) {
          sendError(res, 502, `SMS delivery failed: ${err.message}`);
        } else {
          // In dev, return the OTP so UI can display it without manual console-checking
          sendJson(res, 200, {
            ok: true,
            message: `SMS unavailable (${err.message}). Dev OTP shown below.`,
            dev_otp: otp,
          });
        }
      }
      return;
    }

    // ── POST /api/sms/verify-otp ────────────────────────────────────────────
    if (req.method === "POST" && url.pathname === "/api/sms/verify-otp") {
      const { phone, otp } = await readBody(req);
      const digits = String(phone || "").replace(/\D/g, "").slice(-10);

      if (!digits || !otp) {
        sendError(res, 400, "phone and otp are required.");
        return;
      }

      const entry = otpStore.get(digits);
      if (!entry) {
        sendError(res, 400, "No OTP was sent to this number. Please request a new one.");
        return;
      }
      if (Date.now() > entry.expiresAt) {
        otpStore.delete(digits);
        sendError(res, 400, "OTP has expired. Please request a new one.");
        return;
      }
      if (String(otp).trim() !== entry.otp) {
        sendError(res, 400, "Invalid OTP. Please try again.");
        return;
      }

      otpStore.delete(digits); // single-use
      sendJson(res, 200, { ok: true, verified: true });
      return;
    }

    // ── POST /api/sms/alert ─────────────────────────────────────────────────
    if (req.method === "POST" && url.pathname === "/api/sms/alert") {
      const { phones, message } = await readBody(req);
      if (!message || !phones?.length) {
        sendError(res, 400, "phones[] and message are required.");
        return;
      }
      await sendAlertSms(phones, message);
      sendJson(res, 200, { ok: true });
      return;
    }

    sendError(res, 404, "Unknown SMS endpoint.");
  } catch (err) {
    sendError(res, 500, err.message || "Internal error");
  }
}

// ─── plugin export ───────────────────────────────────────────────────────────

function smsPlugin() {
  return {
    name: "sms-api",
    configureServer(server) {
      server.middlewares.use(handleSms);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleSms);
    },
  };
}

export default smsPlugin;
export { sendAlertSms };
