import React from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import { RequireAuth } from "./components/layout/RequireAuth";
import { Chat } from "./components/chat/Chat";
import Login from "./pages/Login";
import ChangePassword from "./pages/ChangePassword";
import NewFIR from "./pages/NewFIR";
import {
  Dashboard,
  FIRList,
  FIRDetail,
  AdvancedSearch,
  Employees,
  MasterData,
  Units,
  Courts,
  Reports,
  Settings,
} from "./pages/pages";

/**
 * Top-level routes.
 * - /login + /change-password are the only public screens.
 * - Everything else is gated by RequireAuth; first-time users see a modal
 *   that pushes them to /change-password.
 */
const App: React.FC = () => {
  const location = useLocation();
  // Hide auth screens on the chrome-bearing layout — they get their own full-page design.
  const isAuthScreen =
    location.pathname === "/login" ||
    location.pathname.startsWith("/change-password");

  return (
    <Routes>
      {/* Auth screens (standalone layout) */}
      <Route path="/login" element={<Login />} />
      <Route path="/change-password" element={<ChangePassword />} />

      {/* Protected app */}
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Chat />} />
        <Route path="/dashboard" element={<Dashboard />} />

        <Route path="/fir" element={<FIRList />} />
        <Route path="/fir/new" element={<NewFIR />} />
        <Route path="/fir/:id" element={<FIRDetail />} />
        <Route path="/fir/:id/edit" element={<FIRDetail />} />

        <Route path="/search" element={<AdvancedSearch />} />

        <Route path="/employees" element={<Employees />} />
        <Route path="/master-data" element={<MasterData />} />
        <Route path="/units" element={<Units />} />
        <Route path="/courts" element={<Courts />} />

        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
      </Route>

      <Route
        path="*"
        element={<Navigate to={isAuthScreen ? "/login" : "/"} replace />}
      />
    </Routes>
  );
};

export default App;
