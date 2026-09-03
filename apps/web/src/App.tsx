import { Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import PricingPage from './pages/PricingPage';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage';
import SignIn from './pages/auth/SignIn';
import SignUp from './pages/auth/SignUp';
import ForgotPassword from './pages/auth/ForgotPassword';
import VerifyEmail from './pages/auth/VerifyEmail';
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
import EnterpriseSettingsPage from './pages/EnterpriseSettingsPage';
import { useAuth } from './lib/auth/useAuth';

export default function App() {
  const { user } = useAuth();

  return (
    <Routes>
      {/* Public marketing */}
      <Route path="/"               element={user ? <Navigate to="/dashboard" replace /> : <LandingPage />} />
      <Route path="/pricing"        element={<PricingPage />} />
      <Route path="/privacy"        element={<PrivacyPage />} />
      <Route path="/terms"          element={<TermsPage />} />

      {/* Auth */}
      <Route path="/sign-in"         element={user ? <Navigate to="/dashboard" replace /> : <SignIn />} />
      <Route path="/sign-up"         element={user ? <Navigate to="/dashboard" replace /> : <SignUp />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/verify"          element={<VerifyEmail />} />

      {/* App — temporarily open for development; add auth guard before deploy */}
      <Route path="/dashboard"      element={<DashboardPage />} />
      <Route path="/contacts"       element={<ContactsPage />} />
      <Route path="/deals"          element={<DealsPage />} />
      <Route path="/accounts"       element={<AccountsPage />} />
      <Route path="/campaigns"      element={<CampaignsPage />} />
      <Route path="/control-panel"  element={<AgentControlPanel />} />
      <Route path="/analytics"      element={<AnalyticsPage />} />
      <Route path="/settings"       element={<SettingsPage />} />
      <Route path="/research"       element={<DeepResearchPage />} />
      <Route path="/workspace"      element={<WorkspaceTemplatesPage />} />
      <Route path="/registry"       element={<RegistryPage />} />
      <Route path="/enterprise"     element={<EnterpriseSettingsPage />} />
      <Route path="/support/queue"   element={<SupportQueuePage />} />
      <Route path="/support/kb"      element={<KnowledgeBasePage />} />
      <Route path="/support/insight" element={<SupportInsightPage />} />

      <Route path="*" element={<Navigate to={user ? '/dashboard' : '/'} replace />} />
    </Routes>
  );
}
