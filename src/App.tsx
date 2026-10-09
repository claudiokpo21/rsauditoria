import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './modules/auth/AuthProvider';
import { LoginPage } from './modules/auth/LoginPage';
import { ChangePasswordPage } from './modules/auth/ChangePasswordPage';
import { ProfilePage } from './modules/auth/ProfilePage';
import { CreateOrgPage } from './modules/organizations/CreateOrgPage';
import { MastersPage } from './modules/organizations/MastersPage';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/ui';
import { DashboardPage } from './modules/dashboard/DashboardPage';
import { AuditsPage } from './modules/audits/AuditsPage';
import { AuditExecutePage } from './modules/audits/AuditExecutePage';
import { FindingsPage } from './modules/findings/FindingsPage';
import { FindingDetailPage } from './modules/findings/FindingDetailPage';
import { ActionsPage } from './modules/actions/ActionsPage';
import { TemplatesPage } from './modules/templates/TemplatesPage';
import { TemplateDetailPage } from './modules/templates/TemplateDetailPage';
import { MembersPage } from './modules/admin/MembersPage';
import { HistoryPage } from './modules/admin/HistoryPage';
import { SyncPage } from './modules/admin/SyncPage';
import { NotificationsPage } from './modules/notifications/NotificationsPage';
import { envError } from './lib/env';
import { UpdatePrompt } from './components/UpdatePrompt';
import { AccessLock } from './components/AccessLock';

// Módulos pesados (ExcelJS, jsPDF) sólo se cargan al usarlos
const ImportPage = lazy(() => import('./modules/templates/import/ImportPage').then(m => ({ default: m.ImportPage })));
const AuditDocsPage = lazy(() => import('./modules/reports/AuditDocsPage').then(m => ({ default: m.AuditDocsPage })));
const ReportsPage = lazy(() => import('./modules/reports/ReportsPage').then(m => ({ default: m.ReportsPage })));

function Gate() {
  const { loading, session, memberships, current, access, refresh } = useAuth();
  if (loading) return <div className="auth-wrap"><div className="card">Cargando…</div></div>;
  if (!session) return <LoginPage />;
  if (session.user?.user_metadata?.must_change_password === true) return <ChangePasswordPage email={session.user.email ?? ''} />;
  if (access !== 'ok') return <AccessLock state={access} onRetry={refresh} />;
  if (!memberships.length || !current) return <CreateOrgPage />;
  return (
    <Suspense fallback={<div className="content muted">Cargando módulo…</div>}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="auditorias" element={<AuditsPage />} />
          <Route path="auditorias/:id" element={<AuditExecutePage />} />
          <Route path="auditorias/:id/plan" element={<AuditDocsPage tab="plan" />} />
          <Route path="auditorias/:id/informe" element={<AuditDocsPage tab="informe" />} />
          <Route path="hallazgos" element={<FindingsPage />} />
          <Route path="hallazgos/:id" element={<FindingDetailPage />} />
          <Route path="acciones" element={<ActionsPage />} />
          <Route path="informes" element={<ReportsPage />} />
          <Route path="avisos" element={<NotificationsPage />} />
          <Route path="plantillas" element={<TemplatesPage />} />
          <Route path="plantillas/importar" element={<ImportPage />} />
          <Route path="plantillas/:id" element={<TemplateDetailPage />} />
          <Route path="maestros" element={<MastersPage />} />
          <Route path="admin/miembros" element={<MembersPage />} />
          <Route path="admin/historial" element={<HistoryPage />} />
          <Route path="admin/sync" element={<SyncPage />} />
          <Route path="perfil" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  if (envError) return <div className="auth-wrap"><div className="card stack"><h1>Configuración incompleta</h1><p>{envError}</p></div></div>;
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider><Gate /></AuthProvider>
        <UpdatePrompt />
      </ToastProvider>
    </BrowserRouter>
  );
}
