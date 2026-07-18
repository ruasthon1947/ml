// src/pages/Chat.tsx
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../context/LanguageContext";
import { askCopilot } from "../../lib/chatApi";
import { VoiceButton } from "./VoiceButton";

type Msg = { id: string; role: "user" | "assistant"; content: string; ts: number };

const timeOfDay = () => {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
};

export const Chat: React.FC = () => {
  const { user, chatHistory, setChatHistory, isChatBusy, setIsChatBusy } = useAuth();
  const { language, tr } = useLanguage();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  const [, force] = useState(0);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatHistory, isChatBusy]);
  useEffect(() => { const id = setInterval(() => force((n) => n + 1), 60_000); return () => clearInterval(id); }, []);

  const send = async (text?: string) => {
    const trimmed = (text ?? input).trim();
    if (!trimmed || isChatBusy) return;

    setChatHistory((m: any) => [...m, { id: crypto.randomUUID(), role: "user", content: trimmed, ts: Date.now() }]);
    setInput("");
    setIsChatBusy(true);

    try {
      const reply = await askCopilot({
        question: trimmed,
        role: (user as any)?.role ?? "Constable",
        stationId: (user as any)?.policeStation,
        language: language === "kn" ? "kn" : "en",
      });
      setChatHistory((m: any) => [...m, { id: crypto.randomUUID(), role: "assistant", content: reply, ts: Date.now() }]);
    } catch (err) {
      console.error(err);
      const errorMsg = tr(
        "Sorry, I couldn't process that request. Please try again.",
        "ಕ್ಷಮಿಸಿ, ಆ ವಿನಂತಿಯನ್ನು ಪ್ರಕ್ರಿಯೆಗೊಳಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ."
      );
      setChatHistory((m: any) => [...m, { id: crypto.randomUUID(), role: "assistant", content: errorMsg, ts: Date.now() }]);
    } finally {
      setIsChatBusy(false);
    }
  };

  const tod = timeOfDay();
  const firstName = (user?.name ?? "Officer").split(/\s+/)[0];
  const greeting = language === "kn"
    ? (tod === "morning" ? "ಶುಭೋದಯ, ಅಧಿಕಾರಿಯವರೇ." : tod === "afternoon" ? "ಶುಭ ಮಧ್ಯಾಹ್ನ, ಅಧಿಕಾರಿಯವರೇ." : "ಶುಭ ಸಂಜೆ, ಅಧಿಕಾರಿಯವರೇ.")
    : (tod === "morning" ? `Good morning, ${firstName}.` : tod === "afternoon" ? `Good afternoon, ${firstName}.` : `Good evening, ${firstName}.`);

  return (
    <div className="min-h-full bg-ink text-white flex flex-col">
      <div className="px-6 py-3 border-b border-line bg-ink flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="h-2 w-2 rounded-full bg-sage" />
          <span className="text-white font-medium">{tr("Karnataka Police Copilot", "ಕರ್ನಾಟಕ ಪೊಲೀಸ್ ಕೋಪೈಲಟ್")}</span>
        </div>
        <div className="flex-1" />
        <button onClick={() => { setChatHistory([]); setIsChatBusy(false); }} className="text-xs text-white bg-brand/15 border border-brand/30 px-3 py-1.5 rounded-md hover:bg-brand/25">
          {tr("New session", "ಹೊಸ ಸೆಷನ್")}
        </button>
      </div>

      {chatHistory.length === 0 ? (
        <EmptyCanvas greeting={greeting} help={tr("How can I help you today?", "ಇಂದು ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಬಹುದು?")} />
      ) : (
        <MessageList messages={chatHistory as any} busy={isChatBusy} />
      )}
      <div ref={endRef} />

      <div className="px-6 pb-8 pt-4">
        <div className="max-w-3xl mx-auto">
          <Composer
            value={input}
            onChange={setInput}
            onSend={() => send()}
            onVoiceResult={(text) => send(text)}
            onNavigateToFir={() => navigate("/fir/new")}
            busy={isChatBusy}
            tr={tr}
            language={language === "kn" ? "kn" : "en"}
          />

          <p className="text-[11px] text-muted text-center mt-2">
            {tr(
              "Copilot generates drafts and queries — verify against source records before any official action.",
              "ಕೋಪೈಲಟ್ ಕರಡುಗಳು ಮತ್ತು ಪ್ರಶ್ನೆಗಳನ್ನು ರಚಿಸುತ್ತದೆ — ಯಾವುದೇ ಅಧಿಕೃತ ಕ್ರಮಕ್ಕೂ ಮೊದಲು ಮೂಲ ದಾಖಲೆಗಳೊಂದಿಗೆ ಪರಿಶೀಲಿಸಿ."
            )}
          </p>
        </div>
      </div>
    </div>
  );
};

const EmptyCanvas: React.FC<{ greeting: string; help: string }> = ({ greeting, help }) => (
  <div className="flex-1 flex items-center justify-center dotted-bg">
    <div className="text-center px-6">
      <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-brand/15 border border-brand/30 mb-4">
        <span className="text-brand font-semibold text-lg">AI</span>
      </div>
      <h1 className="text-3xl md:text-4xl font-schibsted font-semibold text-white">{greeting}</h1>
      <p className="text-muted text-sm mt-2 max-w-md mx-auto">{help}</p>
    </div>
  </div>
);

const MessageList: React.FC<{ messages: Msg[]; busy: boolean }> = ({ messages, busy }) => (
  <div className="flex-1 overflow-y-auto px-6 py-8">
    <div className="max-w-3xl mx-auto space-y-6">
      {messages.map((m) => <Bubble key={m.id} msg={m} />)}
      {busy && <TypingBubble />}
    </div>
  </div>
);

const Bubble: React.FC<{ msg: Msg }> = ({ msg }) => {
  const isUser = msg.role === "user";
  return (
    <div className={`flex items-start gap-3 ${isUser ? "justify-end" : ""}`}>
      {!isUser && <div className="h-8 w-8 rounded-full bg-brand grid place-items-center text-white text-xs font-semibold shrink-0">AI</div>}
      <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${isUser ? "bg-brand text-white" : "bg-shell text-white border border-line"}`}>
        <Formatted text={msg.content} />
      </div>
      {isUser && <div className="h-8 w-8 rounded-full bg-panel border border-line grid place-items-center text-xs text-muted shrink-0">U</div>}
    </div>
  );
};

const TypingBubble = () => (
  <div className="flex items-start gap-3">
    <div className="h-8 w-8 rounded-full bg-brand grid place-items-center text-white text-xs font-semibold">AI</div>
    <div className="bg-shell border border-line rounded-2xl px-4 py-3 flex gap-1.5">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-1.5 w-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  </div>
);

const Formatted: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
      /^\*\*[^*]+\*\*$/.test(p) ? <strong key={i} className="text-white font-semibold">{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>
    )}
  </>
);

const Composer: React.FC<{
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onVoiceResult: (text: string) => void;
  onNavigateToFir: () => void;
  busy: boolean;
  tr: (en: string, kn: string) => string;
  language: "en" | "kn";
}> = ({ value, onChange, onSend, onVoiceResult, onNavigateToFir, busy, tr, language }) => {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(180, ta.scrollHeight) + "px";
  }, [value]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      console.log(`[File System] Selected file for upload: ${file.name}`);
      // File handle payload hook goes here
    }
  };

  return (
    <div className="bg-shell border border-line rounded-2xl px-4 py-3 focus-within:border-brand/50 focus-within:ring-2 focus-within:ring-brand/15 shadow-soft">
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }}
        placeholder={tr(
          "Ask the Copilot — try 'FIRs in Whitefield last week' or 'disposal rate'",
          "ಕೋಪೈಲಟ್ ಅನ್ನು ಕೇಳಿ — 'ಕಳೆದ ವಾರ ವೈಟ್‌ಫೀಲ್ಡ್‌ನ ಎಫ್‌ಐಆರ್‌ಗಳು' ಅಥವಾ 'ವಿಲೇವಾರಿ ದರ' ಎಂದು ಪ್ರಯತ್ನಿಸಿ"
        )}
        rows={1}
        className="w-full bg-transparent text-white placeholder-muted outline-none resize-none text-sm leading-relaxed"
      />
      <div className="flex items-center gap-1 mt-1">
        {/* Functional File Upload Panel Context */}
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileChange} 
          className="hidden" 
          accept="image/*,.pdf,.doc,.docx"
        />
        <button 
          onClick={() => fileInputRef.current?.click()} 
          className="h-8 w-8 grid place-items-center rounded-md text-muted hover:text-white hover:bg-panel" 
          title={tr("Attach a file or picture", "ಫೈಲ್ ಅಥವಾ ಚಿತ್ರವನ್ನು ಲಗತ್ತಿಸಿ")}
        >
          ＋
        </button>
        
        <VoiceButton language={language} onResult={(text) => onVoiceResult(text)} />
        
        {/* Dynamic New FIR Page Shortcut Redirector */}
        <button 
          onClick={onNavigateToFir} 
          className="h-8 w-8 grid place-items-center rounded-md text-muted hover:text-white hover:bg-panel font-medium text-xs" 
          title={tr("New FIR Wizard", "ಹೊಸ ಎಫ್‌ಐಆರ್")}
        >
          <strong>FIR</strong>
        </button>

        <div className="flex-1" />
        <button onClick={onSend} disabled={busy || !value.trim()} className="h-8 w-8 grid place-items-center rounded-full bg-brand text-white disabled:opacity-40 hover:bg-brand/90 transition">↗</button>
      </div>
    </div>
  );
};