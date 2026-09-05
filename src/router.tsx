import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  HomeRedirect,
  RequireManager,
  RequireNoSession,
  RequireSession,
  RequireWorkplace,
} from '@/components/layout/guards';

import { SignInPage } from '@/pages/auth/SignInPage';
import { SignUpPage } from '@/pages/auth/SignUpPage';
import { JoinWorkplacePage } from '@/pages/auth/JoinWorkplacePage';
import { SelectWorkplacePage } from '@/pages/auth/SelectWorkplacePage';

import { NotificationsPage } from '@/pages/shared/NotificationsPage';

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
import { AreasPage } from '@/pages/manager/AreasPage';
import { RolesPage } from '@/pages/manager/RolesPage';
import { WorkplaceSettingsPage } from '@/pages/manager/WorkplaceSettingsPage';
import { PeriodClosePage } from '@/pages/manager/PeriodClosePage';
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
      {/* Signing in while already signed in makes no sense: bounce to the app. */}
      <Route element={<RequireNoSession />}>
        <Route element={<AppLayout />}>
          <Route path="/signin" element={<SignInPage />} />
        </Route>
      </Route>

      {/*
        Sign-up is NOT wrapped: it ends with a live session and then continues
        to /join, so a blanket "already signed in? go to the app" guard here
        would skip the workplace step entirely. SignUpPage turns an unrelated
        visitor away itself.
      */}
      <Route element={<AppLayout />}>
        <Route path="/signup" element={<SignUpPage />} />
      </Route>

      <Route element={<RequireSession />}>
        {/*
          Onboarding. Behind the session (creating or joining a workplace needs
          auth.uid()) but deliberately OUTSIDE RequireWorkplace, since these are
          the two screens someone with no workplace is sent to.
        */}
        <Route element={<AppLayout />}>
          <Route path="/join" element={<JoinWorkplacePage />} />
          <Route path="/workplaces" element={<SelectWorkplacePage />} />
        </Route>
      </Route>

      <Route element={<RequireSession />}>
        <Route element={<RequireWorkplace />}>
          {/* ── employee, tab roots ───────────────────────────────────────── */}
          <Route element={<AppLayout withTabs />}>
            <Route path="/home" element={<HomePage />} />
            <Route path="/hours" element={<MyHoursPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/profile" element={<ProfilePage />} />
          </Route>

          {/* Both roles have an inbox, so this sits outside the manager guard. */}
          <Route element={<AppLayout />}>
            <Route path="/notifications" element={<NotificationsPage />} />
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
              <Route path="/manager/rules/areas" element={<AreasPage />} />
              <Route path="/manager/rules/roles" element={<RolesPage />} />
              <Route path="/manager/rules/workplace" element={<WorkplaceSettingsPage />} />
              <Route path="/manager/rules/period" element={<PeriodClosePage />} />
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
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
