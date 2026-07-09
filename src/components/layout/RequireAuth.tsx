import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { FirstLoginModal } from "./FirstLoginModal";

/**
 * Gates everything that requires login.
 * - If no user → /login
 * - If first-time login → overlay the modal that pushes to /change-password
 */
export const RequireAuth: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user } = useAuth();
  const location = useLocation();
  const onChangePwd = location.pathname.startsWith("/change-password");

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (user.isFirstLogin && !onChangePwd) {
    return (
      <>
        {children}
        <FirstLoginModal employeeId={user.employeeId} />
      </>
    );
  }

  return <>{children}</>;
};
