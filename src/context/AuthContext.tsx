// src/context/AuthContext.tsx
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type AuthUser = {
  employeeId: string;
  name: string;
  isFirstLogin: boolean;
};

type Theme = "dark" | "light";

// Define a structural shape for messages to keep the state strongly typed
export type ChatMessage = {
  id: string;
  sender: "user" | "ai";
  text: string;
  timestamp: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  login: (employeeId: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  changePassword: (newPassword: string) => Promise<void>;
  logout: () => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  sessionExpiresAt: number | null;
  extendSession: () => void;
  lastLogin: string | null;
  // Plan Two additions: Persistent chat memory access fields
  chatHistory: ChatMessage[];
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  isChatBusy: boolean;
  setIsChatBusy: React.Dispatch<React.SetStateAction<boolean>>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const LS_USER = "kpfir.user";
const LS_THEME = "kpfir.theme";

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const raw = localStorage.getItem(LS_USER);
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
      return null;
    }
  });

  const [lastLogin, setLastLogin] = useState<string | null>(() => localStorage.getItem("kpfir.lastLogin"));
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(() => localStorage.getItem(LS_USER) ? Date.now() + 30 * 60 * 1000 : null);

  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem(LS_THEME) as Theme | null;
      if (stored === "light" || stored === "dark") return stored;
    } catch {
      /* ignore */
    }
    return "light";
  });

  // Global React state for your AI Copilot chat records and busy indicator
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isChatBusy, setIsChatBusy] = useState<boolean>(false);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    localStorage.setItem(LS_THEME, theme);
  }, [theme]);

  const login: AuthContextValue["login"] = async (employeeId, password) => {
    setThemeState("light");
    localStorage.setItem(LS_THEME, "light");

    const id = employeeId.trim();
    if (!id) return { ok: false, error: "Employee ID is required." };
    if (!password) return { ok: false, error: "Password is required." };

    console.log(`[Auth Diagnostic] Attempting login initialization sequence for Employee ID: ${id}`);

    let firebaseAuthSuccess = false;
    try {
      const { auth } = await import("../firebase");
      const { signInWithEmailAndPassword } = await import("firebase/auth");
      const email = `${id}@ksph.gov.in`.toLowerCase();
      
      console.log(`[Auth Diagnostic] Contacting Firebase Auth Gateway with formatted email alias: ${email}`);
      await signInWithEmailAndPassword(auth, email, password);
      firebaseAuthSuccess = true;
      console.log("[Auth Diagnostic] Firebase standard identity verification completed successfully.");
    } catch (fbErr: any) {
      console.warn("[Auth Diagnostic] Firebase pipeline bypassed or rejected validation context:", fbErr.message);
    }

    try {
      console.log("[Auth Diagnostic] Despatching verification parameters downstream to local server endpoint: /api/login");
      
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: id, password, firebaseAuth: firebaseAuthSuccess })
      });
      
      const data = await response.json().catch(() => null);
      
      if (!response.ok || !data || !data.ok) {
        const errorMsg = data?.error || `Server responded with HTTP status code ${response.status}`;
        console.error("[Auth Diagnostic] Validation failed on backend endpoint verification:", errorMsg);
        return { ok: false, error: errorMsg };
      }
      
      console.log("[Auth Diagnostic] Server login session successfully generated. Finalizing user profiles structure.");
      const u: AuthUser = {
        employeeId: id,
        name: data.name || deriveName(id),
        isFirstLogin: !!data.isFirstLogin,
      };
      
      setUser(u);
      localStorage.setItem(LS_USER, JSON.stringify(u));
      const now = new Date().toISOString(); 
      setLastLogin(now); 
      localStorage.setItem("kpfir.lastLogin", now); 
      setSessionExpiresAt(Date.now() + 30 * 60 * 1000);
      return { ok: true };
    } catch (err: any) {
      console.error("[Auth Diagnostic] Critical unhandled internal runtime connection breakdown:", err);
      return { ok: false, error: `Connection breakdown during login sequence: ${err.message || "Network Timeout"}` };
    }
  };

  const changePassword = async (newPassword: string) => {
    if (!user) return;
    const updated: AuthUser = { ...user, isFirstLogin: false };
    setUser(updated);
    localStorage.setItem(LS_USER, JSON.stringify(updated));
  };

  const logout = () => {
    setUser(null);
    setChatHistory([]); // Wipes active conversation securely from internal state memory upon logouts
    setIsChatBusy(false); // Resets the active loader flag layout safely
    localStorage.removeItem(LS_USER);
    localStorage.removeItem("kpfir.phoneNumber");
    setSessionExpiresAt(null);
  };

  const extendSession = () => setSessionExpiresAt(Date.now() + 30 * 60 * 1000);

  const setTheme = (t: Theme) => setThemeState(t);
  const toggleTheme = () => setThemeState((t) => (t === "dark" ? "light" : "dark"));

  const value = useMemo<AuthContextValue>(
    () => ({ 
      user, 
      login, 
      changePassword, 
      logout, 
      theme, 
      setTheme, 
      toggleTheme, 
      sessionExpiresAt, 
      extendSession, 
      lastLogin,
      chatHistory,
      setChatHistory,
      isChatBusy,
      setIsChatBusy
    }),
    [user, theme, sessionExpiresAt, lastLogin, chatHistory, isChatBusy]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
};

function deriveName(id: string): string {
  const tail = id.split("-").pop() ?? id;
  if (/^\d+$/.test(tail)) return `Officer ${tail}`;
  return id;
}