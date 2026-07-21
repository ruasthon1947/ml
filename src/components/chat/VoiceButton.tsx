import React, { useEffect, useRef } from "react";
import { useSpeechRecognition } from "../../hooks/useSpeechRecognition";

type Props = {
  language: "en" | "kn";
  onResult: (text: string) => void;
};

export const VoiceButton: React.FC<Props> = ({ language, onResult }) => {
  // Map "kn" to "kn-IN" and "en" to "en-IN"
  const langCode = language === "kn" ? "kn-IN" : "en-IN";
  
  // Pass dynamic langCode down to the hook
  const { listening, start, stop, transcript } = useSpeechRecognition(langCode);

  // Keep a stable ref to onResult to prevent useEffect dependency loops
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    if (transcript && transcript.trim() !== "") {
      // 🚀 Dispatch result once
      onResultRef.current(transcript);
    }
  }, [transcript]); // ONLY depend on transcript!

  return (
    <button
      type="button"
      onClick={listening ? stop : start}
      title={
        listening
          ? language === "kn" ? "ರೆಕಾರ್ಡಿಂಗ್ ನಿಲ್ಲಿಸಿ" : "Stop recording"
          : language === "kn" ? "ನಿಮ್ಮ ಪ್ರಶ್ನೆಯನ್ನು ಮಾತನಾಡಿ (ಕನ್ನಡ)" : "Speak your question (English)"
      }
      className={`h-8 w-8 grid place-items-center rounded-md transition ${
        listening
          ? "bg-red-500 text-white animate-pulse"
          : "text-muted hover:text-white hover:bg-panel"
      }`}
    >
      🎤
    </button>
  );
};

