import React, { createContext, useContext, useMemo, useState } from "react";
export type Language = "en" | "kn";
type Ctx={language:Language;setLanguage:(l:Language)=>void; tr:(en:string,kn:string)=>string};
const LanguageContext=createContext<Ctx|null>(null);
export const LanguageProvider:React.FC<{children:React.ReactNode}>=({children})=>{
 const [language,setLanguageState]=useState<Language>(()=>(localStorage.getItem("kpfir.language")==="kn"?"kn":"en"));
 const setLanguage=(l:Language)=>{setLanguageState(l);localStorage.setItem("kpfir.language",l)};
 const value=useMemo(()=>({language,setLanguage,tr:(en:string,kn:string)=>language==="kn"?kn:en}),[language]);
 return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};
export const useLanguage=()=>{const c=useContext(LanguageContext);if(!c)throw new Error("useLanguage must be used inside LanguageProvider");return c};
