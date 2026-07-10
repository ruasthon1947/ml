import speech from "@google-cloud/speech";

const client = new speech.SpeechClient(); 

export async function transcribeAudio(audioBase64) {
  const request = {
    audio: { content: audioBase64 },
    config: {
      encoding: "WEBM_OPUS",      
      sampleRateHertz: 48000,
      languageCode: "en-IN",      
      alternativeLanguageCodes: ["kn-IN"],
      model: "latest_long",
      useEnhanced: true,
    },
  };

  const [response] = await client.recognize(request);

  const transcript = response.results
    .map((r) => r.alternatives[0].transcript)
    .join(" ");

  const detectedLanguage = response.results[0]?.languageCode || "en-IN";
  return { transcript, detectedLanguage };
}


