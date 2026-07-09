import React from "react";
import { useNavigate } from "react-router-dom";

/**
 * Modal that fires after a successful first-time login.
 * It is rendered by RequireAuth when user.isFirstLogin === true,
 * BUT only once — the modal's primary action routes to /change-password
 * which clears the first-login flag upon successful submit.
 */
export const FirstLoginModal: React.FC<{ employeeId: string }> = ({ employeeId }) => {
  const navigate = useNavigate();
  return (
    <div className="fixed inset-0 z-50 grid place-items-center modal-backdrop px-4">
      <div className="w-full max-w-md bg-shell border border-line rounded-2xl shadow-soft p-6">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 grid place-items-center rounded-lg bg-amber/15 text-amber border border-amber/30">
            <WarnIcon />
          </div>
          <div className="flex-1">
            <h2 className="text-white font-schibsted text-lg font-semibold">
              First-time login detected
            </h2>
            <p className="text-muted text-sm mt-1">
              Welcome, <span className="text-white">{employeeId}</span>. For your
              account security, please change your password immediately before
              continuing.
            </p>
          </div>
        </div>

        <ul className="mt-5 space-y-1.5 text-xs text-muted">
          <li className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            Your new password must be at least 8 characters.
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            Use a mix of letters, numbers, and (optionally) a symbol.
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            Don't reuse a password you've used before on this system.
          </li>
        </ul>

        <div className="mt-6 flex gap-2">
          <button
            onClick={() => navigate("/change-password", { replace: true })}
            className="flex-1 bg-brand hover:bg-brand/90 text-white rounded-lg py-2.5 font-medium shadow-glow"
          >
            Change password now
          </button>
        </div>
      </div>
    </div>
  );
};

const WarnIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <path d="M12 3 2 21h20L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M12 10v5M12 18v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
