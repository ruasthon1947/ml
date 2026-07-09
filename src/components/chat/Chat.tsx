import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../context/LanguageContext";

type Msg = { id: string; role: "user" | "assistant"; content: string; ts: number };
const CREDITS_TOTAL = 450;

async function fakeAssistantReply(input: string, kn: boolean): Promise<string> {
  await new Promise((r) => setTimeout(r, 700));
  const lower = input.toLowerCase();
  if (/disposal|ವಿಲೇವಾರಿ/.test(lower)) return kn ? "ವೈಟ್‌ಫೀಲ್ಡ್ ಪೊಲೀಸ್ ಠಾಣೆ — ಕಳೆದ 90 ದಿನಗಳಲ್ಲಿ ವಿಲೇವಾರಿ ದರ **78%**. 12 ಪ್ರಕರಣಗಳು ನಿಗದಿತ ಅವಧಿ ಮೀರಿವೆ." : "Whitefield PS — disposal rate **78%** over the last 90 days. 12 cases are pending beyond SLA.";
  if (/heinous|ಗಂಭೀರ/.test(lower)) return kn ? "ಈ ತಿಂಗಳು ಬೆಂಗಳೂರಿನಲ್ಲಿ **6 ಗಂಭೀರ ಎಫ್‌ಐಆರ್‌ಗಳು** ದಾಖಲಾಗಿವೆ. ವಿವರ: 2 ಕೊಲೆ, 3 ಅಪಹರಣ, 1 ದರೋಡೆ." : "**6 heinous FIRs** were registered in Bengaluru this month: 2 murder, 3 kidnapping and 1 dacoity.";
  return kn ? `“${input}” ಕುರಿತು ಎಫ್‌ಐಆರ್‌ಗಳು, ಆರೋಪಿಗಳು ಮತ್ತು ಕಾನೂನು ಸೆಕ್ಷನ್‌ಗಳಲ್ಲಿ ಹುಡುಕುತ್ತೇನೆ. ಫಲಿತಾಂಶಗಳನ್ನು ಇತ್ತೀಚಿನ ಕ್ರಮದಲ್ಲಿ ತೋರಿಸಬೇಕೇ?` : `I'll search for “${input}” across FIRs, suspects and sections. Would you like results ranked by recency?`;
}

const timeOfDay = () => { const h = new Date().getHours(); return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"; };

export const Chat: React.FC = () => {
  const { user } = useAuth();
  const { language, tr } = useLanguage();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [creditsUsed, setCreditsUsed] = useState(62);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const [, force] = useState(0);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => { const id = setInterval(() => force((n) => n + 1), 60_000); return () => clearInterval(id); }, []);

  const send = async (text?: string) => {
    const trimmed = (text ?? input).trim(); if (!trimmed || busy) return;
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", content: trimmed, ts: Date.now() }]);
    setInput(""); setBusy(true); setCreditsUsed((c) => Math.min(CREDITS_TOTAL, c + 4));
    const reply = await fakeAssistantReply(trimmed, language === "kn");
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", content: reply, ts: Date.now() }]);
    setBusy(false);
  };

  const tod = timeOfDay();
  const firstName = (user?.name ?? "Officer").split(/\s+/)[0];
  const greeting = language === "kn"
    ? (tod === "morning" ? "ಶುಭೋದಯ, ಅಧಿಕಾರಿಯವರೇ." : tod === "afternoon" ? "ಶುಭ ಮಧ್ಯಾಹ್ನ, ಅಧಿಕಾರಿಯವರೇ." : "ಶುಭ ಸಂಜೆ, ಅಧಿಕಾರಿಯವರೇ.")
    : (tod === "morning" ? `Good morning, ${firstName}.` : tod === "afternoon" ? `Good afternoon, ${firstName}.` : `Good evening, ${firstName}.`);

  return <div className="min-h-full bg-ink text-white flex flex-col">
    <div className="px-6 py-3 border-b border-line bg-ink flex items-center gap-3">
      <div className="flex items-center gap-2 text-sm"><span className="h-2 w-2 rounded-full bg-sage"/><span className="text-white font-medium">{tr("Karnataka Police Copilot","ಕರ್ನಾಟಕ ಪೊಲೀಸ್ ಕೋಪೈಲಟ್")}</span><span className="text-muted">· GPT-4o · v3.2</span></div>
      <div className="flex-1"/>
      <button className="text-xs text-muted hover:text-white px-2 py-1.5 rounded-md">{tr("Switch model","ಮಾದರಿ ಬದಲಿಸಿ")}</button>
      <button onClick={()=>setMessages([])} className="text-xs text-white bg-brand/15 border border-brand/30 px-3 py-1.5 rounded-md hover:bg-brand/25">{tr("New session","ಹೊಸ ಸೆಷನ್")}</button>
    </div>
    {messages.length === 0 ? <EmptyCanvas greeting={greeting} help={tr("How can I help you today?","ಇಂದು ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಬಹುದು?")}/> : <MessageList messages={messages} busy={busy}/>}<div ref={endRef}/>
    <div className="px-6 pb-8 pt-4"><div className="max-w-3xl mx-auto"><Composer value={input} onChange={setInput} onSend={()=>send()} busy={busy} creditsUsed={creditsUsed} creditsTotal={CREDITS_TOTAL} tr={tr}/><p className="text-[11px] text-muted text-center mt-2">{tr("Copilot generates drafts and queries — verify against source records before any official action.","ಕೋಪೈಲಟ್ ಕರಡುಗಳು ಮತ್ತು ಪ್ರಶ್ನೆಗಳನ್ನು ರಚಿಸುತ್ತದೆ — ಯಾವುದೇ ಅಧಿಕೃತ ಕ್ರಮಕ್ಕೂ ಮೊದಲು ಮೂಲ ದಾಖಲೆಗಳೊಂದಿಗೆ ಪರಿಶೀಲಿಸಿ.")}</p></div></div>
  </div>;
};

const EmptyCanvas:React.FC<{greeting:string;help:string}>=({greeting,help})=><div className="flex-1 flex items-center justify-center dotted-bg"><div className="text-center px-6"><div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-brand/15 border border-brand/30 mb-4"><span className="text-brand font-semibold text-lg">AI</span></div><h1 className="text-3xl md:text-4xl font-schibsted font-semibold text-white">{greeting}</h1><p className="text-muted text-sm mt-2 max-w-md mx-auto">{help}</p></div></div>;
const MessageList:React.FC<{messages:Msg[];busy:boolean}>=({messages,busy})=><div className="flex-1 overflow-y-auto px-6 py-8"><div className="max-w-3xl mx-auto space-y-6">{messages.map(m=><Bubble key={m.id} msg={m}/>)}{busy&&<TypingBubble/>}</div></div>;
const Bubble:React.FC<{msg:Msg}>=({msg})=>{const isUser=msg.role==="user";return <div className={`flex items-start gap-3 ${isUser?"justify-end":""}`}>{!isUser&&<div className="h-8 w-8 rounded-full bg-brand grid place-items-center text-white text-xs font-semibold shrink-0">AI</div>}<div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${isUser?"bg-brand text-white":"bg-shell text-white border border-line"}`}><Formatted text={msg.content}/></div>{isUser&&<div className="h-8 w-8 rounded-full bg-panel border border-line grid place-items-center text-xs text-muted shrink-0">U</div>}</div>};
const TypingBubble=()=> <div className="flex items-start gap-3"><div className="h-8 w-8 rounded-full bg-brand grid place-items-center text-white text-xs font-semibold">AI</div><div className="bg-shell border border-line rounded-2xl px-4 py-3 flex gap-1.5">{[0,1,2].map(i=><span key={i} className="h-1.5 w-1.5 rounded-full bg-muted animate-bounce" style={{animationDelay:`${i*120}ms`}}/>)}</div></div>;
const Formatted:React.FC<{text:string}>=({text})=><>{text.split(/(\*\*[^*]+\*\*)/g).map((p,i)=>/^\*\*[^*]+\*\*$/.test(p)?<strong key={i} className="text-white font-semibold">{p.slice(2,-2)}</strong>:<span key={i}>{p}</span>)}</>;

const Composer:React.FC<{value:string;onChange:(v:string)=>void;onSend:()=>void;busy:boolean;creditsUsed:number;creditsTotal:number;tr:(en:string,kn:string)=>string}>=({value,onChange,onSend,busy,creditsUsed,creditsTotal,tr})=>{
 const taRef=useRef<HTMLTextAreaElement|null>(null); useEffect(()=>{const ta=taRef.current;if(!ta)return;ta.style.height="auto";ta.style.height=Math.min(180,ta.scrollHeight)+"px"},[value]);
 return <div className="bg-shell border border-line rounded-2xl px-4 py-3 focus-within:border-brand/50 focus-within:ring-2 focus-within:ring-brand/15 shadow-soft"><textarea ref={taRef} value={value} onChange={e=>onChange(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();onSend()}}} placeholder={tr("Ask the Copilot — try 'FIRs in Whitefield last week' or 'disposal rate'","ಕೋಪೈಲಟ್ ಅನ್ನು ಕೇಳಿ — 'ಕಳೆದ ವಾರ ವೈಟ್‌ಫೀಲ್ಡ್‌ನ ಎಫ್‌ಐಆರ್‌ಗಳು' ಅಥವಾ 'ವಿಲೇವಾರಿ ದರ' ಎಂದು ಪ್ರಯತ್ನಿಸಿ")} rows={1} className="w-full bg-transparent text-white placeholder-muted outline-none resize-none text-sm leading-relaxed"/><div className="flex items-center gap-1 mt-1"><button className="h-8 w-8 grid place-items-center rounded-md text-muted hover:text-white hover:bg-panel" title={tr("Attach a file","ಫೈಲ್ ಲಗತ್ತಿಸಿ")}>＋</button><button className="h-8 w-8 grid place-items-center rounded-md text-muted hover:text-white hover:bg-panel" title={tr("Voice input","ಧ್ವನಿ ಇನ್‌ಪುಟ್")}>♩</button><button className="h-8 w-8 grid place-items-center rounded-md text-muted hover:text-white hover:bg-panel" title={tr("Web search","ವೆಬ್ ಹುಡುಕಾಟ")}>◎</button><div className="flex-1"/><span className="text-xs text-muted mr-2 select-none">{creditsUsed}/{creditsTotal} {tr("credits","ಕ್ರೆಡಿಟ್‌ಗಳು")}</span><button onClick={onSend} disabled={busy||!value.trim()} className="h-8 w-8 grid place-items-center rounded-full bg-brand text-white disabled:opacity-40 hover:bg-brand/90 transition">↗</button></div></div>
};
