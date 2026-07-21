import { useRef, useState, useCallback, useEffect } from "react";

// Helper: Converts English numbers (0-9) to Kannada numerals (೦-೯)
function convertNumbersToKannada(str: string): string {
  const kanDigits = ["೦", "೧", "೨", "೩", "೪", "೫", "೬", "೭", "೮", "೯"];
  return str.replace(/\d/g, (d) => kanDigits[parseInt(d, 10)]);
}

// Helper: Maps common Romanized speech terms directly into Kannada script
function transliterateKanglishToKannada(text: string): string {
  let output = text;

  const phraseMap: [RegExp, string][] = [
    // Phrases & Words
    [/\bnanage\b/gi, "ನನಗೆ"],
    [/\bcase\s*master\b/gi, "ಕೇಸ್ ಮಾಸ್ಟರ್"],
    [/\bcase\b/gi, "ಕೇಸ್"],
    [/\bmaster\b/gi, "ಮಾಸ್ಟರ್"],
    [/\bid\b/gi, "ಐಡಿ"],
    [/\bcomplete\b/gi, "ಸಂಪೂರ್ಣ"],
    [/\bdetails\b/gi, "ವಿವರಗಳು"],
    [/\bvivara\b/gi, "ವಿವರ"],
    [/\bvivaragalu\b/gi, "ವಿವರಗಳು"],
    [/\bkodi\b/gi, "ಕೊಡಿ"],
    [/\bnaadi\b/gi, "ನೀಡಿ"],
    [/\bge\b/gi, "ಗೆ"],
    [/\bondu\b/gi, "ಒಂದು"],
    [/\byaradu\b/gi, "ಎರಡು"],
    [/\bmooru\b/gi, "ಮೂರು"],
    [/\bnaalaku\b/gi, "ನಾಲ್ಕು"],
    [/\baaidu\b/gi, "ಐದು"],
    [/\baaru\b/gi, "ಆರು"],
    [/\beelu\b/gi, "ಏಳು"],
    [/\bentu\b/gi, "ಎಂಟು"],
    [/\bombattu\b/gi, "ಒಂಬತ್ತು"],
    [/\bhattu\b/gi, "ಹತ್ತು"],
    [/\bfir\b/gi, "ಎಫ್‌ಐಆರ್"],
    [/\bpolice\s*station\b/gi, "ಪೊಲೀಸ್ ಠಾಣೆ"],
    [/\bofficer\b/gi, "ಅಧಿಕಾರಿ"]
  ];

  phraseMap.forEach(([regex, kanReplacement]) => {
    output = output.replace(regex, kanReplacement);
  });

  // Convert numbers to Kannada digits
  return convertNumbersToKannada(output);
}

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
      // Ignore stop errors
    }
    setListening(false);
  }, []);

  // Update recognition language dynamically
  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = lang;
    }
  }, [lang]);

  const start = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Speech recognition isn't supported in this browser. Try Chrome or Edge.");
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      let rawText = event.results[0][0].transcript;

      // 🚀 FORCE FULL KANNADA CONVERSION WHEN LANGUAGE IS SET TO KANNADA
      if (lang === "kn-IN") {
        rawText = transliterateKanglishToKannada(rawText);
      }

      setTranscript(rawText);
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

    try {
      recognition.start();
      setListening(true);
      clearAutoStop();
      timeoutRef.current = window.setTimeout(() => stop(), 10000);
    } catch (err) {
      console.error("Failed to start speech recognition:", err);
      setListening(false);
    }
  }, [lang, stop]);

  useEffect(() => () => stop(), [stop]);

  return { transcript, listening, start, stop };
}
