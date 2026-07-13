import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { auth } from "../firebase";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updatePassword } from "firebase/auth";

const ChangePassword: React.FC = () => {
  const { user, changePassword, logout, theme, toggleTheme } = useAuth();
  const navigate = useNavigate();
  const { language, setLanguage, tr } = useLanguage();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (current.length < 4)
      return setError(tr("Current password must be at least 4 characters.", "ಪ್ರಸ್ತುತ ಪಾಸ್‌ವರ್ಡ್ ಕನಿಷ್ಠ 4 ಅಕ್ಷರಗಳಿರಬೇಕು."));
    if (next.length < 6) return setError(tr("New password must be at least 6 characters.", "ಹೊಸ ಪಾಸ್‌ವರ್ಡ್ ಕನಿಷ್ಠ 6 ಅಕ್ಷರಗಳಿರಬೇಕು."));
    if (next === current) return setError(tr("New password must differ from the current one.", "ಹೊಸ ಪಾಸ್‌ವರ್ಡ್ ಪ್ರಸ್ತುತ ಪಾಸ್‌ವರ್ಡ್‌ನಿಂದ ಭಿನ್ನವಾಗಿರಬೇಕು."));
    if (next !== confirm) return setError(tr("New password and confirmation do not match.", "ಹೊಸ ಪಾಸ್‌ವರ್ಡ್ ಮತ್ತು ದೃಢೀಕರಣ ಹೊಂದಿಕೆಯಾಗುವುದಿಲ್ಲ."));

    setSubmitting(true);
    try {
      const email = `${user?.employeeId}@ksph.gov.in`.toLowerCase();
      
      let firebaseUser = null;
      let validCurrentPassword = false;

      try {
        const userCredential = await signInWithEmailAndPassword(auth, email, current);
        firebaseUser = userCredential.user;
        validCurrentPassword = true;
      } catch (fbErr: any) {
        // Firebase auth failed
      }

      if (!validCurrentPassword && user?.isFirstLogin) {
        const loginRes = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId: user?.employeeId, password: current })
        });
        const loginData = await loginRes.json();
        if (loginRes.ok && loginData.ok) {
          validCurrentPassword = true;
        }
      }

      if (!validCurrentPassword) {
        throw new Error(tr("Incorrect current password.", "ತಪ್ಪಾದ ಪ್ರಸ್ತುತ ಪಾಸ್‌ವರ್ಡ್."));
      }

      if (firebaseUser) {
        await updatePassword(firebaseUser, next);
      } else {
        try {
          await createUserWithEmailAndPassword(auth, email, next);
        } catch (err: any) {
          if (err.code === "auth/email-already-in-use") {
            throw new Error(tr("Account is partially set up. Please use your NEW password as the 'Current password'.", "ಖಾತೆ ಭಾಗಶಃ ಹೊಂದಿಸಲಾಗಿದೆ. ದಯವಿಟ್ಟು ನಿಮ್ಮ ಹೊಸ ಪಾಸ್‌ವರ್ಡ್ ಅನ್ನು 'ಪ್ರಸ್ತುತ ಪಾಸ್‌ವರ್ಡ್' ಆಗಿ ಬಳಸಿ."));
          }
          throw err;
        }
      }

      await fetch("/api/employee/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: user?.employeeId, hasLoggedIn: true }),
      });

      await changePassword(next);
      navigate("/", { replace: true });
    } catch (err: any) {
      setError(err.message || tr("Failed to update password.", "ಪಾಸ್‌ವರ್ಡ್ ನವೀಕರಿಸಲು ವಿಫಲವಾಗಿದೆ."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute inset-0 dotted-bg pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-brand/15 border border-brand/30 grid place-items-center text-brand">
              <ShieldIcon />
            </div>
            <div>
              <div className="text-white text-lg font-semibold font-schibsted leading-none">
                {tr("Set a new password", "ಹೊಸ ಪಾಸ್‌ವರ್ಡ್ ಹೊಂದಿಸಿ")}
              </div>
              <div className="text-muted text-xs mt-1 font-noto">
                {tr("Signed in as", "ಲಾಗಿನ್ ಆಗಿರುವವರು")} {user?.name} ({user?.employeeId})
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as "en" | "kn")}
              aria-label={tr("Language", "ಭಾಷೆ")}
              className="h-10 rounded-lg border border-line bg-shell px-3 text-sm text-white outline-none focus:border-brand/50"
            >
              <option value="en">English</option>
              <option value="kn">ಕನ್ನಡ</option>
            </select>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={tr("Toggle theme", "ಥೀಮ್ ಬದಲಿಸಿ")}
              className="h-10 px-3 flex items-center gap-2 rounded-lg border border-line bg-shell text-white text-sm hover:bg-panel transition"
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
              <span className="hidden sm:inline">
                {theme === "dark" ? tr("Light", "ಲೈಟ್") : tr("Dark", "ಡಾರ್ಕ್")}
              </span>
            </button>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="bg-shell border border-line rounded-2xl shadow-soft p-7 space-y-4"
          noValidate
        >
          <p className="text-muted text-sm">
            {tr("For your security, choose a strong password you haven't used before. Once saved, you'll be taken straight to the FIR console.", "ನಿಮ್ಮ ಭದ್ರತೆಗಾಗಿ ಬಲವಾದ ಹೊಸ ಪಾಸ್‌ವರ್ಡ್ ಆಯ್ಕೆಮಾಡಿ. ಉಳಿಸಿದ ನಂತರ ಎಫ್‌ಐಆರ್ ಕನ್ಸೋಲ್ ತೆರೆಯುತ್ತದೆ.")}
          </p>

          <Field
            label={tr("Current password", "ಪ್ರಸ್ತುತ ಪಾಸ್‌ವರ್ಡ್")}
            value={current}
            onChange={setCurrent}
            type={showAll ? "text" : "password"}
            autoComplete="current-password"
            placeholder={user?.isFirstLogin ? tr("e.g. First 4 letters of name + DOB year", "ಉದಾ: ಹೆಸರಿನ ಮೊದಲ 4 ಅಕ್ಷರಗಳು + ಹುಟ್ಟಿದ ವರ್ಷ") : tr("Your temporary password", "ನಿಮ್ಮ ತಾತ್ಕಾಲಿಕ ಪಾಸ್‌ವರ್ಡ್")}
          />
          <Field
            label={tr("New password", "ಹೊಸ ಪಾಸ್‌ವರ್ಡ್")}
            value={next}
            onChange={setNext}
            type={showAll ? "text" : "password"}
            autoComplete="new-password"
            placeholder={tr("At least 6 characters", "ಕನಿಷ್ಠ 6 ಅಕ್ಷರಗಳು")}
          />
          <Field
            label={tr("Confirm new password", "ಹೊಸ ಪಾಸ್‌ವರ್ಡ್ ದೃಢೀಕರಿಸಿ")}
            value={confirm}
            onChange={setConfirm}
            type={showAll ? "text" : "password"}
            autoComplete="new-password"
            placeholder={tr("Re-enter the new password", "ಹೊಸ ಪಾಸ್‌ವರ್ಡ್ ಮತ್ತೆ ನಮೂದಿಸಿ")}
          />

          <label className="flex items-center gap-2 text-xs text-muted select-none">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="accent-brand"
            />
            {tr("Show passwords", "ಪಾಸ್‌ವರ್ಡ್‌ಗಳನ್ನು ತೋರಿಸಿ")}
          </label>

          <PasswordHints pwd={next} />

          {error && (
            <div className="text-rose text-sm bg-rose/10 border border-rose/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-3 mt-2">
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-brand hover:bg-brand/90 disabled:opacity-60 transition text-white font-medium rounded-lg py-2.5 shadow-glow"
            >
              {submitting ? tr("Updating…", "ನವೀಕರಿಸಲಾಗುತ್ತಿದೆ…") : tr("Update password and continue", "ಪಾಸ್‌ವರ್ಡ್ ನವೀಕರಿಸಿ ಮುಂದುವರಿಸಿ")}
            </button>

            <button
              type="button"
              onClick={() => {
                logout();
                navigate("/login", { replace: true });
              }}
              disabled={submitting}
              className="w-full bg-transparent hover:bg-line/50 border border-line text-muted transition font-medium rounded-lg py-2.5"
            >
              {tr("Back to Login", "ಲಾಗಿನ್‌ಗೆ ಹಿಂತಿರುಗಿ")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ChangePassword;

/* ---------- Reusable field ---------- */
const Field: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  type: string;
  autoComplete?: string;
  placeholder?: string;
}> = ({ label, value, onChange, type, autoComplete, placeholder }) => (
  <div>
    <label className="block text-xs uppercase tracking-wider text-muted mb-1.5">
      {label}
    </label>
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      type={type}
      autoComplete={autoComplete}
      placeholder={placeholder}
      className="focus-ring w-full bg-panel border border-line text-white placeholder-muted rounded-lg px-3 py-2.5 text-sm outline-none"
    />
  </div>
);

/* ---------- Strength meter ---------- */
const PasswordHints: React.FC<{ pwd: string }> = ({ pwd }) => {
  const { tr } = useLanguage();
  const checks = [
    { ok: pwd.length >= 6, label: tr("At least 6 characters", "ಕನಿಷ್ಠ 6 ಅಕ್ಷರಗಳು") },
  ];
  const score = checks.filter((c) => c.ok).length;

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded ${
              i < score
                ? "bg-sage"
                : "bg-line"
            }`}
          />
        ))}
      </div>
      <ul className="text-xs text-muted space-y-0.5">
        {checks.map((c, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span className={c.ok ? "text-sage" : "text-muted"}>
              {c.ok ? "✓" : "•"}
            </span>
            {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
};

/* ---------- Icons ---------- */
const ShieldIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6l-8-3Z" stroke="currentColor" strokeWidth="1.5" />
    <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const SunIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

const MoonIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path
      d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
);
