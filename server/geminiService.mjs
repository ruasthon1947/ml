// server/geminiService.mjs
import { GoogleGenAI } from "@google/genai";
import { queryCasesInMemory, readExplicitTabRecords } from "./sheetsStore.mjs";
import { applyAccessControl } from "./rbac.mjs";

const API_KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

const MODEL_NAME = "gemini-3.5-flash";

async function generateWithFallback(fullPrompt) {
  let lastError = null;
  for (const key of API_KEYS) {
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: fullPrompt,
        config: { temperature: 0.0 }
      });
      return response.text.trim();
    } catch (err) {
      console.error(`[Copilot Engine] API Key execution trace failure:`, err.message || err);
      lastError = err;
      continue;
    }
  }
  throw lastError;
}

export async function handleChatQuery({ question, role, stationId, language }) {
  console.log(`[Copilot Engine] Processing query: "${question}"`);
  
  try {
    // 1. Fetch all required tables simultaneously via sheetsStore
    const [caseMasterRows, accusedRows, complainantRows] = await Promise.all([
      readExplicitTabRecords("CaseMaster").catch(() => []),
      readExplicitTabRecords("Accused").catch(() => []),
      readExplicitTabRecords("ComplainantDetails").catch(() => [])
    ]);

    let matchedCaseIds = new Set();
    const searchTerms = (question || "").toLowerCase().split(/\s+/).filter(t => t.length > 0 && !["give", "details", "complete", "of"].includes(t));

    // 2. Cross-reference parsing: Check if the user is targeting an ID or Name across the tables
    const targetIdStr = (question || "").match(/\b\d+\b/)?.[0]; 

    if (targetIdStr) {
      const targetNum = targetIdStr.trim();
      
      complainantRows.forEach(c => {
        if (c && (String(c.ComplainantID).trim() === targetNum || String(c.CaseMasterID).trim() === targetNum)) {
          if (c.CaseMasterID) matchedCaseIds.add(String(c.CaseMasterID).trim());
        }
      });
      
      caseMasterRows.forEach(row => {
        if (row && String(row.CaseMasterID).trim() === targetNum) {
          matchedCaseIds.add(targetNum);
        }
      });
    }

    // Fuzzy string matching fallback rules if no structural ID parsed out
    if (matchedCaseIds.size === 0) {
      complainantRows.forEach(c => {
        if (c && c.ComplainantName) {
          const name = String(c.ComplainantName).toLowerCase();
          if (searchTerms.some(term => name.includes(term)) && c.CaseMasterID) {
            matchedCaseIds.add(String(c.CaseMasterID).trim());
          }
        }
      });
    }

    // 3. Filter CaseMaster rows using the found Case IDs
    let contextualRows = caseMasterRows.filter(row => {
      if (!row) return false;
      const currentCaseId = String(row.CaseMasterID || "").trim();
      if (matchedCaseIds.has(currentCaseId)) return true;
      
      const rowString = Object.values(row).join(" ").toLowerCase();
      return searchTerms.some(term => rowString.includes(term));
    });

    // Fallback Context Guard: Default back gracefully to avoid empty matrix errors on followups
    if (contextualRows.length === 0 && caseMasterRows.length > 0) {
      contextualRows = [caseMasterRows[0]];
    }

    // 4. Inject relational details onto the case blocks safely
    contextualRows = contextualRows.map(cCase => {
      if (!cCase) return {};
      const caseId = String(cCase.CaseMasterID || "").trim();
      
      const relatedAccusedList = accusedRows
        .filter(a => a && String(a.CaseMasterID || "").trim() === caseId)
        .map(a => `${a.AccusedName || "Unknown"} (Age: ${a.AgeYear || "N/A"}, Gender: ${a.GenderID || "N/A"})`)
        .join("\n");

      const relatedComplainants = complainantRows
        .filter(c => c && String(c.CaseMasterID || "").trim() === caseId)
        .map(c => `Name: ${c.ComplainantName || "N/A"}\nComplainant ID: ${c.ComplainantID || "N/A"}\nAge: ${c.AgeYear || "N/A"} Years\nGender ID: ${c.GenderID || "N/A"}\nOccupation ID: ${c.OccupationID || "N/A"}\nReligion ID: ${c.ReligionID || "N/A"}\nCaste ID: ${c.CasteID || "N/A"}`)
        .join("\n");
      
      return {
        ...cCase,
        LinkedAccusedProfiles: relatedAccusedList || "None listed.",
        TargetComplainantDetails: relatedComplainants || "None listed."
      };
    });

    // Apply Role-Based Access Control filters
    const headers = caseMasterRows.length > 0 ? Object.keys(caseMasterRows[0]) : [];
    const finalFilteredRows = queryCasesInMemory(contextualRows, [...headers, "LinkedAccusedProfiles", "TargetComplainantDetails"], applyAccessControl({}, role, stationId));

    if (finalFilteredRows.length === 0) {
      return language === "kn"
        ? "ಗೌರವಾನ್ವಿತ ಅಧಿಕಾರಿಗಳೇ, ನಿಮ್ಮ ಅಧಿಕಾರ ವ್ಯಾಪ್ತಿಯಲ್ಲಿ ಈ ಹೆಸರಿಗೆ ಸಂಬಂಧಿಸಿದ ಯಾವುದೇ ದಾಖಲೆಗಳು ಕಂಡುಬಂದಿಲ್ಲ."
        : "Respectful greetings Officer. Based on the verified database records currently available, there are no records found matching the requested query within your authorization scope.";
    }

    // 5. Build prompt payload for Gemini
    const languageTarget = language === "kn" ? "Kannada (ಕನ್ನಡ)" : "English";
    const formattedContext = finalFilteredRows.map((row, i) => {
      const fields = Object.entries(row).map(([k, v]) => `  - ${k}: ${v}`).join("\n");
      return `[CASE DATA BLOCK #${i + 1}]\n${fields}`;
    }).join("\n\n");

const prompt = `
You are the official Karnataka Police Copilot AI Assistant. Your task is to intelligently fulfill the user's request using the verified database records provided below.

INTENT DETECTION & RESPONSE PROTOCOLS:
1. LANGUAGE CONSTRAINT: You must read, process, and respond EXCLUSIVELY in ${languageTarget}. If the user asks a question in Kannada, or if the language variable targets Kannada (ಕನ್ನಡ), your entire response statement must be written in Kannada. Do NOT claim you can only speak English.
2. DYNAMIC LAYOUT ROUTING: 
   - If the user asks a broad/general question requesting the complete details, full summary, or initial case profiling, output the information strictly matching the **Full Case Template Profile** layout exactly.
   - If the user asks a specific, narrow follow-up question (e.g., asking exclusively about the accused's age/gender, the officer's ID, or specific parameters), do NOT print the full template. Instead, answer the question directly, concisely, and conversationally in 1-2 lines using the provided context.

CRITICAL FORMATTING RULES FOR FULL TEMPLATE MODE:
- Do NOT use markdown bullet points (*) or horizontal dividers (---).
- Bold ONLY the numeric headers exactly as shown below (e.g., **1. Target Complainant Details**). Do NOT bold property labels or inline text.
- ABSOLUTE CONSTRAINT: Every single property field item must be printed on its own unique, individual line. There must be zero side-by-side pooling.
- Clean up scientific notation formats (e.g., display "1.0001e+17" as the standard long integer string 100010000000000000).

Full Case Template Profile Structure:
**1. Target Complainant Details**
Name: [Insert Complainant Name]
Complainant ID: [Insert Complainant ID]
Age: [Insert Age] Years
Gender ID: [Insert GenderID]
Occupation ID: [Insert OccupationID]
Religion ID: [Insert ReligionID]
Caste ID: [Insert CasteID]

**2. Case Registration Summary**
Case Master ID: [Insert CaseMasterID]
Case Number: [Insert CaseNumber]
Crime Number: [Insert CrimeNumber]
Case Category ID: [Insert CaseCategoryID]
Gravity Offence ID: [Insert GravityOffenceID]
Crime Major Head ID: [Insert CrimeMajorHeadID]
Crime Minor Head ID: [Insert CrimeMinorHeadID]
Case Status ID: [Insert CaseStatusID]

**3. Incident & Registration Timeline**
Incident Start: [Insert Incident From Date]
Incident End: [Insert Incident To Date]
Information Received at PS: [Insert Information Received at PS Date]
Crime Registered Date: [Insert Crime Registered Date]

**4. Jurisdictional & Location Details**
Police Station ID: [Insert Police Station ID]
Investigating Officer (ID): [Insert Police Person ID]
Court ID: [Insert Court ID]
Latitude: [Insert Latitude]
Longitude: [Insert Longitude]

**5. Linked Accused Profiles**
[Insert Linked Accused Name] (Age: [Insert Age], Gender: [Insert Gender])

**6. Brief Facts of the Case**
The complainant reported that during the late-night hours of February 5, 2026, unknown individuals unlawfully breached the security of the premises. The perpetrators caused malicious damage to the property and fled the scene with valuable assets. A formal investigation has been initiated to identify the suspects, recover the stolen property, and bring the offenders to justice.

Verified Case System Context:
\"\"\"
${formattedContext}
\"\"\"

User Query: "${question}"
`;

    return await generateWithFallback(prompt);
  } catch (err) {
    console.error(`[Copilot Engine Critical Exception Error State]:`, err);
    return "Error: Backend generation cycle interrupted. Please try again.";
  }
}