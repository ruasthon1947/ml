import { GoogleGenerativeAI } from "@google/generative-ai";
import { FILTERABLE_FIELDS, queryCases } from "./caseStore.mjs";
import { applyAccessControl } from "./rbac.mjs";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

async function generateFilterSpec(question) {
  const prompt = `
You convert a question into a JSON filter object using ONLY these keys: ${FILTERABLE_FIELDS.join(", ")}.
Return ONLY valid JSON, e.g. {"PoliceStation": "Whitefield", "Status": "Under Investigation"}.
Only include keys the question actually asks about. If nothing matches, return {}.
No explanation, no markdown fencing.

Question: "${question}"
`;
  const result = await model.generateContent(prompt);
  const text = result.response.text().trim().replace(/```json|```/g, "");
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function generateAnswer(question, rows, language) {
  const langInstruction = language === "kn" ? "Answer in Kannada." : "Answer in English.";
  const prompt = `
You are a helpful assistant for Karnataka Police officers.
${langInstruction}
Question: "${question}"
Matching case records (JSON): ${JSON.stringify(rows).slice(0, 6000)}

Answer concisely based only on this data. If empty, say no matching records were found.
`;
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

export async function handleChatQuery({ question, role, stationId, language }) {
  const filterSpec = await generateFilterSpec(question);
  const scopedFilter = applyAccessControl(filterSpec, role, stationId);
  const rows = queryCases(scopedFilter);
  return await generateAnswer(question, rows, language);
}