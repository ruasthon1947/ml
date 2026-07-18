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
      lastError = err;
      continue;
    }
  }
  throw lastError;
}

export async function handleChatQuery({ question, role, stationId, language }) {
  console.log(`[Copilot Engine] Processing query: "${question}"`);
  
  // 1. Fetch all required tables simultaneously via sheetsStore
  const [caseMasterRows, accusedRows, complainantRows] = await Promise.all([
    readExplicitTabRecords("CaseMaster"),
    readExplicitTabRecords("Accused"),
    readExplicitTabRecords("ComplainantDetails")
  ]);

  let matchedCaseIds = new Set();
  const searchTerms = question.toLowerCase().split(/\s+/).filter(t => t.length > 0 && !["give", "details", "complete", "of"].includes(t));

  // 2. Cross-reference parsing: Check if the user is targeting an ID or Name across the tables
  const targetIdStr = searchTerms.find(t => /^\d+$/.test(t)); // Detects numbers like "1"

  if (targetIdStr) {
    const targetNum = targetIdStr.trim();
    // Check if it matches a ComplainantID or a CaseMasterID directly
    complainantRows.forEach(c => {
      if (String(c.ComplainantID).trim() === targetNum || String(c.CaseMasterID).trim() === targetNum) {
        matchedCaseIds.add(String(c.CaseMasterID).trim());
      }
    });
    caseMasterRows.forEach(row => {
      if (String(row.CaseMasterID).trim() === targetNum) {
        matchedCaseIds.add(targetNum);
      }
    });
  } else {
    // Fuzzy string search fallback for text phrases
    complainantRows.forEach(c => {
      const name = String(c.ComplainantName || "").toLowerCase();
      if (searchTerms.some(term => name.includes(term)) && c.CaseMasterID) {
        matchedCaseIds.add(String(c.CaseMasterID).trim());
      }
    });
  }

  // 3. Filter CaseMaster rows using the found Case IDs
  let contextualRows = caseMasterRows.filter(row => {
    const currentCaseId = String(row.CaseMasterID || "").trim();
    if (matchedCaseIds.has(currentCaseId)) return true;
    const rowString = Object.values(row).join(" ").toLowerCase();
    return searchTerms.some(term => rowString.includes(term));
  });

  // 4. Inject relational details (Both Accused Profiles AND Complainant Details) onto the case blocks
  contextualRows = contextualRows.map(cCase => {
    const caseId = String(cCase.CaseMasterID || "").trim();
    
    // Build Accused Profile String
    const relatedAccusedList = accusedRows
      .filter(a => String(a.CaseMasterID || "").trim() === caseId)
      .map(a => `${a.AccusedName} (Age: ${a.AgeYear || "N/A"}, Gender: ${a.GenderID || "N/A"})`)
      .join(", ");

    // Build Complainant Details Profile String (FROM PIC TWO)
    const relatedComplainants = complainantRows
      .filter(c => String(c.CaseMasterID || "").trim() === caseId)
      .map(c => `${c.ComplainantName} [ID: ${c.ComplainantID}] (Age: ${c.AgeYear || "N/A"}, OccupationID: ${c.OccupationID || "N/A"}, ReligionID: ${c.ReligionID || "N/A"}, CasteID: ${c.CasteID || "N/A"}, GenderID: ${c.GenderID || "N/A"})`)
      .join(" | ");
    
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
You are the official Karnataka Police Copilot AI Assistant. Present the retrieved case information exactly matching the strict line-by-line text template requested below.

CRITICAL FORMATTING & ALIGNMENT STRUCTURE:
1. Respond exclusively in ${languageTarget}.
2. Do NOT use markdown bullet points (*) or horizontal dividers (---).
3. Bold ONLY the numeric headers exactly as shown below (e.g. **1. Target Complainant Details**). Do NOT bold any other field text or property names.
4. ABSOLUTE CONSTRAINT: EVERY SINGLE property field item must be printed on its own unique, individual line. There must be zero side-by-side data pooling or pipe grouping.
5. Clean up scientific notation formats (e.g., display "1.0001e+17" as the standard long integer string 100010000000000000).
6. Output layout template syntax structure:

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

  try {
    return await generateWithFallback(prompt);
  } catch (err) {
    return "Error: Backend generation cycle interrupted. Please try again.";
  }
}



