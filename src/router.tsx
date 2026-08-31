import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { HomeRedirect, RequireManager, RequireSession } from '@/components/layout/guards';

import { SignInPage } from '@/pages/auth/SignInPage';
import { SignUpPage } from '@/pages/auth/SignUpPage';
import { JoinWorkplacePage } from '@/pages/auth/JoinWorkplacePage';

import { HomePage } from '@/pages/employee/HomePage';
import { MyHoursPage } from '@/pages/employee/MyHoursPage';
import { HistoryPage } from '@/pages/employee/HistoryPage';
import { ProfilePage } from '@/pages/employee/ProfilePage';
import { LanguagePage } from '@/pages/employee/LanguagePage';
import { PayoutPage } from '@/pages/employee/PayoutPage';
import { ReportTipsPage } from '@/pages/employee/ReportTipsPage';

import { DashboardPage } from '@/pages/manager/DashboardPage';
import { WizardPoolPage } from '@/pages/manager/WizardPoolPage';
import { WizardAreasPage } from '@/pages/manager/WizardAreasPage';
import { HoursReviewPage } from '@/pages/manager/HoursReviewPage';
import { WizardResultPage } from '@/pages/manager/WizardResultPage';
import { SentPage } from '@/pages/manager/SentPage';
import { TeamPage } from '@/pages/manager/TeamPage';
import { MemberPage } from '@/pages/manager/MemberPage';
import { InvitePage } from '@/pages/manager/InvitePage';
import { DistributionsPage } from '@/pages/manager/DistributionsPage';
import { DistributionDetailPage } from '@/pages/manager/DistributionDetailPage';
import { RulesPage } from '@/pages/manager/RulesPage';
import { StaffReportsPage } from '@/pages/manager/StaffReportsPage';
import { OverlapPage } from '@/pages/manager/OverlapPage';

/**
 * Every screen in the prototype is a real route.
 *
 * Two layout variants: one with the bottom tab bar (the four tab roots per
 * role) and one without (screens you push onto the stack and come back from).
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />

      {/* ── unauthenticated ─────────────────────────────────────────────── */}
      <Route element={<AppLayout />}>
        <Route path="/signin" element={<SignInPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/join" element={<JoinWorkplacePage />} />
      </Route>

      <Route element={<RequireSession />}>
        {/* ── employee, tab roots ───────────────────────────────────────── */}
        <Route element={<AppLayout withTabs />}>
          <Route path="/home" element={<HomePage />} />
          <Route path="/hours" element={<MyHoursPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>

        {/* ── employee, pushed screens ──────────────────────────────────── */}
        <Route element={<AppLayout />}>
          <Route path="/profile/language" element={<LanguagePage />} />
          <Route path="/payout/:distributionId" element={<PayoutPage />} />
          <Route path="/report" element={<ReportTipsPage />} />
        </Route>

        {/* ── manager ───────────────────────────────────────────────────── */}
        <Route element={<RequireManager />}>
          <Route element={<AppLayout withTabs />}>
            <Route path="/manager" element={<DashboardPage />} />
            <Route path="/manager/distributions" element={<DistributionsPage />} />
            <Route path="/manager/team" element={<TeamPage />} />
            <Route path="/manager/rules" element={<RulesPage />} />
          </Route>

          <Route element={<AppLayout />}>
            <Route path="/manager/new" element={<Navigate to="/manager/new/pool" replace />} />
            <Route path="/manager/new/pool" element={<WizardPoolPage />} />
            <Route path="/manager/new/areas" element={<WizardAreasPage />} />
            <Route path="/manager/new/hours" element={<HoursReviewPage mode="wizard" />} />
            <Route path="/manager/new/result" element={<WizardResultPage />} />
            <Route path="/manager/sent" element={<SentPage />} />
            <Route path="/manager/hours" element={<HoursReviewPage mode="review" />} />
            <Route path="/manager/overlap" element={<OverlapPage />} />
            <Route path="/manager/reports" element={<StaffReportsPage />} />
            <Route path="/manager/invite" element={<InvitePage />} />
            <Route path="/manager/team/:employeeId" element={<MemberPage />} />
            <Route
              path="/manager/distributions/:distributionId"
              element={<DistributionDetailPage />}
            />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
