import React,{useEffect,useMemo,useState} from "react";
import {NavLink,Outlet,useNavigate} from "react-router-dom";
import {useAuth} from "../../context/AuthContext";
import {useLanguage} from "../../context/LanguageContext";

const AppShell:React.FC=()=>{
  const {user,logout,theme,toggleTheme,sessionExpiresAt,extendSession}=useAuth();
  const {language,setLanguage,tr}=useLanguage();
  const navigate=useNavigate();
  const [left,setLeft]=useState(1800);
  const [warn,setWarn]=useState(false);

  useEffect(()=>{
    const id=setInterval(()=>{
      if(!sessionExpiresAt)return;
      const n=Math.max(0,Math.floor((sessionExpiresAt-Date.now())/1000));
      setLeft(n);
      setWarn(n>0&&n<=300);
      if(n===0){logout();navigate("/login",{replace:true})}
    },1000);
    return()=>clearInterval(id)
  },[sessionExpiresAt,logout,navigate]);

  const nav=useMemo(()=>[
    {h:tr("Workspace","ಕಾರ್ಯಸ್ಥಳ"),a:[["/",tr("AI Assistant","ಎಐ ಸಹಾಯಕ"),"✦"],["/dashboard",tr("Dashboard","ಡ್ಯಾಶ್‌ಬೋರ್ಡ್"),"▦"]]},
    {h:tr("Cases","ಪ್ರಕರಣಗಳು"),a:[["/fir",tr("FIR List","ಎಫ್‌ಐಆರ್ ಪಟ್ಟಿ"),"▤"],["/fir/new",tr("New FIR","ಹೊಸ ಎಫ್‌ಐಆರ್"),"＋"],["/search",tr("Advanced Search","ಸುಧಾರಿತ ಹುಡುಕಾಟ"),"⌕"]]},
    {h:tr("Reference","ಉಲ್ಲೇಖ"),a:[["/employees",tr("Employees","ಸಿಬ್ಬಂದಿ"),"♙"],["/master-data",tr("Master Data","ಮಾಸ್ಟರ್ ಡೇಟಾ"),"◫"],["/units",tr("Units & Stations","ಘಟಕಗಳು ಮತ್ತು ಠಾಣೆಗಳು"),"⚑"],["/courts",tr("Courts","ನ್ಯಾಯಾಲಯಗಳು"),"⌂"]]},
    {h:tr("Insights","ವಿಶ್ಲೇಷಣೆ"),a:[["/reports",tr("Reports & Analytics","ವರದಿಗಳು ಮತ್ತು ವಿಶ್ಲೇಷಣೆ"),"▥"],["/settings",tr("Settings","ಸೆಟ್ಟಿಂಗ್‌ಗಳು"),"⚙"]]}
  ], [language,tr]);

  return (
    <div className="h-screen min-h-0 bg-ink text-white flex overflow-hidden">
      {/* Sidebar Layout */}
      <aside className="w-[252px] shrink-0 bg-shell border-r border-line flex flex-col shadow-[4px_0_18px_rgba(15,23,42,0.035)]">
        <div className="h-[64px] px-4 border-b border-line flex items-center">
          <div className="h-10 w-10 rounded-xl bg-brand/10 border border-brand/25 grid place-items-center text-brand font-bold shadow-sm">KP</div>
          <div className="ml-2.5">
            <div className="text-[13px] font-semibold">Karnataka Police</div>
            <div className="text-[9px] text-muted uppercase">FIR Management Suite</div>
          </div>
        </div>
        
        <nav className="flex-1 overflow-y-auto px-2.5 py-3">
          {nav.map(g=>(
            <div className="mb-4" key={g.h}>
              <div className="px-2.5 mb-1.5 text-[9px] font-semibold text-muted uppercase tracking-[0.12em]">{g.h}</div>
              <div className="space-y-[2px]">
                {g.a.map(([to,label,icon])=>(
                  <NavLink key={to} to={to} end={to==="/"} className={({isActive})=>`relative h-9 rounded-lg px-2.5 flex items-center gap-2.5 text-[12px] transition-all duration-150 ${isActive?"bg-brand/12 text-white font-semibold shadow-sm before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r-full before:bg-brand":"text-muted hover:text-white hover:bg-panel"}`}>
                    <span className="w-5 h-5 rounded-md grid place-items-center text-[12px] shrink-0">{icon}</span>
                    <span className="truncate">{label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="sidebar-account border-t border-line px-3 py-3">
          <div className="text-[9px] text-muted uppercase mb-2">{tr("Signed in as","ಲಾಗಿನ್ ಆಗಿರುವವರು")}</div>
          <div className="flex gap-2.5 items-center px-1 min-w-0">
            <div className="h-9 w-9 rounded-full bg-brand grid place-items-center text-[11px] font-semibold text-white shrink-0">O1</div>
            <div className="min-w-0">
              <div className="sidebar-account-name text-[13px] font-semibold truncate">{user?.name}</div>
              <div className="text-[10px] text-muted truncate">Inspector · {user?.employeeId}</div>
            </div>
          </div>
          <button onClick={toggleTheme} className="sidebar-theme-button mt-3 w-full min-h-10 rounded-lg border border-line px-3 flex items-center gap-2.5 text-[12px] transition">
            ◐ {theme==="light"?tr("Switch to dark mode","ಡಾರ್ಕ್ ಮೋಡ್‌ಗೆ ಬದಲಿಸಿ"):tr("Switch to light mode","ಲೈಟ್ ಮೋಡ್‌ಗೆ ಬದಲಿಸಿ")}
          </button>
        </div>
      </aside>

      {/* Main Panel Frame Content */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <header className="h-[58px] shrink-0 bg-shell border-b border-line px-5 flex items-center gap-3">
          <input className="w-full max-w-[520px] h-10 rounded-lg bg-panel border border-line px-3 text-[13px] outline-none" placeholder={tr("Search FIRs, crime numbers, names, sections...","ಎಫ್‌ಐಆರ್, ಅಪರಾಧ ಸಂಖ್ಯೆ, ಹೆಸರು, ಸೆಕ್ಷನ್ ಹುಡುಕಿ...")}/>
          
          <div className="ml-auto text-[11px] text-muted whitespace-nowrap">
            {new Date().toLocaleDateString(language==="kn"?"kn-IN":"en-IN",{weekday:"short",day:"2-digit",month:"short",year:"numeric"})}
          </div>

          <select value={language} onChange={e=>setLanguage(e.target.value as any)} className="h-10 rounded-lg bg-panel border border-line px-3 text-[12px]">
            <option value="en">English</option>
            <option value="kn">ಕನ್ನಡ</option>
          </select>

          <button onClick={toggleTheme} className="h-10 px-3 rounded-lg bg-panel border border-line text-[12px]">
            ◐ {theme==="light"?tr("Dark","ಡಾರ್ಕ್"):tr("Light","ಲೈಟ್")}
          </button>

          {/* Adjusted Layout Padding and Min Width Container Boundary to contain Kannada String Content safely */}
          <button onClick={()=>{logout();navigate("/login",{replace:true})}} className="h-10 px-4 sm:px-3 min-w-[85px] flex items-center justify-center gap-1 rounded-lg bg-panel border border-line text-[12px] text-muted hover:text-white whitespace-nowrap transition">
            <span>⇥</span> <span>{tr("Logout","ಲಾಗ್ ಔಟ್")}</span>
          </button>
        </header>

        <main className="flex-1 min-h-0 overflow-auto bg-ink">
          <Outlet/>
        </main>
      </div>

      {/* Session Expiring Modal Context */}
      {warn&&<div className="fixed inset-0 modal-backdrop z-50 grid place-items-center p-4"><div className="w-full max-w-md bg-shell border border-line rounded-2xl p-6 shadow-soft"><div className="text-lg font-semibold">{tr("Session expiring soon","ಸೆಷನ್ ಶೀಘ್ರದಲ್ಲೇ ಮುಕ್ತಾಯಗೊಳ್ಳುತ್ತದೆ")}</div><p className="text-sm text-muted mt-2">{tr("For security, your session will end automatically.","ಭದ್ರತೆಗಾಗಿ ನಿಮ್ಮ ಸೆಷನ್ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಮುಕ್ತಾಯಗೊಳ್ಳುತ್ತದೆ.")}</p><div className="text-3xl font-semibold num mt-5">{String(Math.floor(left/60)).padStart(2,"0")}:{String(left%60).padStart(2,"0")}</div><div className="flex justify-end gap-2 mt-6"><button onClick={()=>{logout();navigate("/login",{replace:true})}} className="px-4 py-2 text-sm border border-line rounded-lg">{tr("Logout","ಲಾಗ್ ಔಟ್")}</button><button onClick={()=>{extendSession();setWarn(false)}} className="px-4 py-2 text-sm bg-brand rounded-lg">{tr("Continue session","ಸೆಷನ್ ಮುಮುಂದುವರಿಸಿ")}</button></div></div></div>}
    </div>
  );
};

export default AppShell;