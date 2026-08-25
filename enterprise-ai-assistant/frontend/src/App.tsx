import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/store/auth";
import { MainLayout } from "@/components/layout/main-layout";
import { LoginPage } from "@/pages/login";
import { SetupPage } from "@/pages/setup";
import { ChatPage } from "@/pages/chat";
import { ResourcesPage } from "@/pages/resources";
import { KnowledgePage } from "@/pages/knowledge";
import { KnowledgeNewPage } from "@/pages/knowledge-new";
import { KnowledgeDetailPage } from "@/pages/knowledge-detail";
import { SearchPage } from "@/pages/search";
import { ProfilePage } from "@/pages/profile";
import { AdminDashboard } from "@/pages/admin/dashboard";
import { UsersPage } from "@/pages/admin/users";
import { RolesPage } from "@/pages/admin/roles";
import { LogsPage } from "@/pages/admin/logs";
import { ModelsPage } from "@/pages/admin/models";
import { HealthPage } from "@/pages/admin/health";
import { SettingsPage } from "@/pages/admin/settings";
import { WebSourcesPage } from "@/pages/admin/web-sources";
import { NotFoundPage } from "@/pages/not-found";
import { useEffect, useState } from "react";

function Protected({ children, admin = false }: { children: React.ReactNode; admin?: boolean }) {
  const user = useAuth((s) => s.user);
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (admin && !user.is_superadmin && !user.permissions.includes("admin.users")) {
    return <Navigate to="/chat" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  const user = useAuth((s) => s.user);
  const [setupDone, setSetupDone] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((d) => setSetupDone(d.completed))
      .catch(() => setSetupDone(true));
  }, [user]);

  if (setupDone === null) return null;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/chat" replace /> : <LoginPage />} />
      <Route
        path="/setup"
        element={setupDone ? <Navigate to={user ? "/chat" : "/login"} replace /> : <SetupPage />}
      />
      <Route
        element={
          <Protected>
            <MainLayout />
          </Protected>
        }
      >
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:id" element={<ChatPage />} />
        <Route path="/resources" element={<ResourcesPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/knowledge/new" element={<KnowledgeNewPage />} />
        <Route path="/knowledge/:id" element={<KnowledgeDetailPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route
          path="/admin"
          element={
            <Protected admin>
              <AdminDashboard />
            </Protected>
          }
        />
        <Route
          path="/admin/users"
          element={
            <Protected admin>
              <UsersPage />
            </Protected>
          }
        />
        <Route
          path="/admin/roles"
          element={
            <Protected admin>
              <RolesPage />
            </Protected>
          }
        />
        <Route
          path="/admin/web-sources"
          element={
            <Protected admin>
              <WebSourcesPage />
            </Protected>
          }
        />
        <Route
          path="/admin/logs"
          element={
            <Protected admin>
              <LogsPage />
            </Protected>
          }
        />
        <Route
          path="/admin/models"
          element={
            <Protected admin>
              <ModelsPage />
            </Protected>
          }
        />
        <Route
          path="/admin/health"
          element={
            <Protected admin>
              <HealthPage />
            </Protected>
          }
        />
        <Route
          path="/admin/settings"
          element={
            <Protected admin>
              <SettingsPage />
            </Protected>
          }
        />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
