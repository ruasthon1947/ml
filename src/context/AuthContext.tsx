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

type AuthContextValue = {
  user: AuthUser | null;
  login: (employeeId: string, password: string) => { ok: boolean; error?: string };
  changePassword: (newPassword: string) => void;
  logout: () => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  sessionExpiresAt: number | null;
  extendSession: () => void;
  lastLogin: string | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// LocalStorage keys (kept scoped so admin tools / tests stay clean)
const LS_USER = "kpfir.user";
const LS_THEME = "kpfir.theme";
const LS_PASSWORD = "kpfir.password"; // demo only — never do this in production

// Demo credentials so the page is usable without a backend.
// First-time login: any employee ID with password "First@123" triggers the prompt.
// Regular login: any ID + password "police@2026".
const DEMO_FIRST_LOGIN_PASSWORD = "First@123";
const DEMO_DEFAULT_PASSWORD = "police@2026";

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
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(() => localStorage.getItem(LS_USER) ? Date.now()+30*60*1000 : null);

  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem(LS_THEME) as Theme | null;
      if (stored === "light" || stored === "dark") return stored;
    } catch {
      /* ignore */
    }
    return "light";
  });

  // Apply theme class to <html> so our css overrides kick in
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    localStorage.setItem(LS_THEME, theme);
  }, [theme]);

  const login: AuthContextValue["login"] = (employeeId, password) => {
    // Every fresh login opens the application in light mode.
    setThemeState("light");
    localStorage.setItem(LS_THEME, "light");

    const id = employeeId.trim();
    if (!id) return { ok: false, error: "Employee ID is required." };
    if (!password) return { ok: false, error: "Password is required." };

    // Allow any ID, but passwords are what drive the first-time vs normal path.
    if (password === DEMO_FIRST_LOGIN_PASSWORD) {
      const u: AuthUser = {
        employeeId: id,
        name: deriveName(id),
        isFirstLogin: true,
      };
      setUser(u);
      localStorage.setItem(LS_USER, JSON.stringify(u));
      const now=new Date().toISOString(); setLastLogin(now); localStorage.setItem("kpfir.lastLogin",now); setSessionExpiresAt(Date.now()+30*60*1000);
      return { ok: true };
    }
    if (password === DEMO_DEFAULT_PASSWORD) {
      const u: AuthUser = {
        employeeId: id,
        name: deriveName(id),
        isFirstLogin: false,
      };
      setUser(u);
      localStorage.setItem(LS_USER, JSON.stringify(u));
      const now=new Date().toISOString(); setLastLogin(now); localStorage.setItem("kpfir.lastLogin",now); setSessionExpiresAt(Date.now()+30*60*1000);
      return { ok: true };
    }
    return { ok: false, error: "Invalid credentials. Try again." };
  };

  const changePassword = (newPassword: string) => {
    if (!user) return;
    const updated: AuthUser = { ...user, isFirstLogin: false };
    setUser(updated);
    localStorage.setItem(LS_USER, JSON.stringify(updated));
    try {
      localStorage.setItem(LS_PASSWORD, newPassword);
    } catch {
      /* ignore */
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem(LS_USER);
    setSessionExpiresAt(null);
  };

  const extendSession = () => setSessionExpiresAt(Date.now()+30*60*1000);

  const setTheme = (t: Theme) => setThemeState(t);
  const toggleTheme = () => setThemeState((t) => (t === "dark" ? "light" : "dark"));

  const value = useMemo<AuthContextValue>(
    () => ({ user, login, changePassword, logout, theme, setTheme, toggleTheme, sessionExpiresAt, extendSession, lastLogin }),
    [user, theme, sessionExpiresAt, lastLogin]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
};

// Tiny helper to make the topbar greeting feel real
function deriveName(id: string): string {
  // id like "KA-SI-10427" -> "Inspector 10427"
  const tail = id.split("-").pop() ?? id;
  if (/^\d+$/.test(tail)) return `Officer ${tail}`;
  return id;
}
