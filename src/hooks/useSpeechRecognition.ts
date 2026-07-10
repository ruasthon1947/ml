import { useRef, useState, useCallback, useEffect } from "react";

export function useSpeechRecognition(lang: "kn-IN" | "en-IN") {
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const timeoutRef = useRef<number | null>(null);

  const clearAutoStop = () => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const stop = useCallback(() => {
    clearAutoStop();
    try {
      recognitionRef.current?.stop();
    } catch {
    }
    setListening(false);
  }, []);
  const start = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition isn't supported in this browser. Try Chrome or Edge.");
      return;
    }

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.continuous = false;      
    recognition.interimResults = false;  
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      setTranscript(text);
      stop(); 
    };
    recognition.onspeechend = () => {
      recognition.stop(); 
    };
    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      stop();
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
    clearAutoStop();
    timeoutRef.current = window.setTimeout(() => stop(), 10000);
  }, [lang, stop]);

  useEffect(() => () => stop(), [stop]); 
  return { transcript, listening, start, stop };
}