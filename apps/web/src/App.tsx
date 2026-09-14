import { Routes, Route, Navigate, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import LandingPage from './pages/LandingPage';
import PricingPage from './pages/PricingPage';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage';
import SignIn from './pages/auth/SignIn';
import SignUp from './pages/auth/SignUp';
import ForgotPassword from './pages/auth/ForgotPassword';
import VerifyEmail from './pages/auth/VerifyEmail';
import HomePage from './pages/HomePage';
import DashboardPage from './pages/DashboardPage';
import ContactsPage from './pages/crm/ContactsPage';
import CampaignsPage from './pages/campaigns/CampaignsPage';
import AgentControlPanel from './pages/control-panel/AgentControlPanel';
import DealsPage from './pages/DealsPage';
import AccountsPage from './pages/AccountsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import SettingsPage from './pages/SettingsPage';
import DeepResearchPage from './pages/DeepResearchPage';
import WorkspaceTemplatesPage from './pages/WorkspaceTemplatesPage';
import RegistryPage from './pages/RegistryPage';
import SupportQueuePage from './pages/SupportQueuePage';
import KnowledgeBasePage from './pages/KnowledgeBasePage';
import SupportInsightPage from './pages/SupportInsightPage';
import ContactDetailPage from './pages/crm/ContactDetailPage';
import AccountDetailPage from './pages/crm/AccountDetailPage';
import ActivityPage from './pages/crm/ActivityPage';
import ApprovalsPage from './pages/control-panel/ApprovalsPage';
import UsagePage from './pages/control-panel/UsagePage';
import SequencesPage from './pages/SequencesPage';
import SupportComingPage from './pages/SupportComingPage';
import EnterpriseSettingsPage from './pages/EnterpriseSettingsPage';
import { RequireRole } from './components/auth/RequireRole';
import WrongWorkspace from './components/auth/WrongWorkspace';
import WorkspaceNotReady from './components/auth/WorkspaceNotReady';
import { useAuth, roleOf } from './lib/auth/useAuth';
import { safeNextPath } from './lib/auth/redirect';
import { currentTenantSlug } from './lib/tenant';

function FullScreenLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-[#020617]" role="status" aria-label="Loading">
      <Loader2 size={28} className="animate-spin text-indigo-500" />
    </div>
  );
}

/**
 * Gate for every app screen. Nothing renders until the session has been read,
 * so a signed-in user is never briefly treated as signed out (or the reverse).
 */
function RequireAuth() {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullScreenLoader />;
  if (!user) {
    // Bring them back to where they were going once they have signed in.
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/sign-in?next=${encodeURIComponent(next)}`} replace />;
  }
  const host = currentTenantSlug();
  if (host && host !== user.tenantId) return <WrongWorkspace />;
  // No workspace group: provisioning failed or was refused, and the API
  // rejects every request from this account.
  if (!roleOf(user)) return <WorkspaceNotReady />;
  return <Outlet />;
}

/**
 * Sign-in and sign-up are for signed-out visitors. A signed-in user is sent on
 * to ?next (validated) or Home. SignIn relies on this: it publishes the new
 * session and this redirect is what moves the user on.
 *
 * The marketing landing page is not in this gate — signed-in people can still
 * read it; its CTAs send them back to the workspace.
 */
function PublicOnly() {
  const { status } = useAuth();
  const [params] = useSearchParams();

  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'signedIn') return <Navigate to={safeNextPath(params.get('next'))} replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />

      <Route element={<PublicOnly />}>
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/sign-up" element={<SignUp />} />
      </Route>

      {/* Public regardless of session */}
      <Route path="/pricing"         element={<PricingPage />} />
      <Route path="/privacy"         element={<PrivacyPage />} />
      <Route path="/terms"           element={<TermsPage />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/verify"          element={<VerifyEmail />} />

      <Route element={<RequireAuth />}>
        <Route path="/home"            element={<HomePage />} />
        <Route path="/dashboard"       element={<DashboardPage />} />
        <Route path="/contacts"        element={<ContactsPage />} />
        <Route path="/contacts/:id"    element={<ContactDetailPage />} />
        <Route path="/deals"           element={<DealsPage />} />
        <Route path="/accounts"        element={<AccountsPage />} />
        <Route path="/accounts/:id"    element={<AccountDetailPage />} />
        <Route path="/activity"        element={<ActivityPage />} />
        <Route path="/campaigns"       element={<CampaignsPage />} />
        <Route path="/sequences"       element={<SequencesPage />} />
        <Route path="/control-panel"   element={<AgentControlPanel />} />
        <Route path="/approvals"       element={<ApprovalsPage />} />
        <Route path="/usage"           element={<UsagePage />} />
        <Route path="/analytics"       element={<AnalyticsPage />} />
        <Route path="/settings"        element={<SettingsPage />} />
        <Route path="/research"        element={<DeepResearchPage />} />
        <Route path="/workspace"       element={<WorkspaceTemplatesPage />} />
        <Route element={<RequireRole allow={['admin', 'manager']} />}>
          <Route path="/registry"      element={<RegistryPage />} />
          <Route path="/enterprise"    element={<EnterpriseSettingsPage />} />
        </Route>
        <Route path="/support/coming"  element={<SupportComingPage />} />
        <Route path="/support/queue"   element={<SupportQueuePage />} />
        <Route path="/support/kb"      element={<KnowledgeBasePage />} />
        <Route path="/support/insight" element={<SupportInsightPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
