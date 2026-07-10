import React, { useEffect } from "react";
import { useSpeechRecognition } from "../../hooks/useSpeechRecognition";

type Props = {
  language: "en" | "kn";
  onResult: (text: string) => void;
};

export const VoiceButton: React.FC<Props> = ({ language, onResult }) => {
  const langCode = language === "kn" ? "kn-IN" : "en-IN";
  const { listening, start, stop, transcript } = useSpeechRecognition(langCode);

  useEffect(() => {
    if (transcript) onResult(transcript);
  }, [transcript, onResult]);

  return (
    <button
      type="button"
      onClick={listening ? stop : start}
      title={listening ? "Stop recording" : "Speak your question (Kannada or English)"}
      className="h-8 w-8 grid place-items-center rounded-md text-muted hover:text-white hover:bg-panel"
      style={{ background: listening ? "#ef4444" : undefined, color: listening ? "white" : undefined }}
    >
      🎤
    </button>
  );
};