export async function askCopilot(params: {
  question: string;
  role: string;
  stationId?: string;
  language: "en" | "kn";
}): Promise<string> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Chat request failed");
  const data = await res.json();
  return data.answer;
}
export async function transcribeSpeech(
  audioBase64: string
): Promise<{ transcript: string; detectedLanguage: string }> {
  const res = await fetch("/api/speech-to-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audioBase64 }),
  });
  if (!res.ok) throw new Error("Transcription failed");
  return res.json();
}


