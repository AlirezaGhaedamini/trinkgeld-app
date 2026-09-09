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
        {/*
          Tabbed, even though these sit OUTSIDE RequireWorkplace. They are the
          two screens a person reaches without an active workplace — but they
          are also where somebody who already has one comes to switch, and the
          release test found that path losing the bar: Rules, account card,
          Workplace row. AppLayout withholds the bar when there is no active
          membership, so onboarding still gets a clean screen and a switch does
          not strand a manager.
        */}
        <Route element={<AppLayout withTabs />}>
          <Route path="/join" element={<JoinWorkplacePage />} />
          <Route path="/workplaces" element={<SelectWorkplacePage />} />
        </Route>
      </Route>

      <Route element={<RequireSession />}>
        <Route element={<RequireWorkplace />}>
          {/* ── employee, and the inbox both roles share ──────────────────── */}
          {/*
            One tabbed group, not a tab-root group plus two untabbed ones. An
            employee reading their share, reporting a night's tips or changing
            the language is on a normal screen of the app, not in a mode, and
            should be one tap from any other section rather than several
            back-taps deep.

            The inbox lives here too, and it is NOT duplicated per role: it is
            one page on one route, and BottomNav asks useActiveRole() which set
            of tabs to draw, so a manager who opens it keeps the manager bar
            and an employee keeps the employee bar.
          */}
          <Route element={<AppLayout withTabs />}>
            <Route path="/home" element={<HomePage />} />
            {/* Also the rejected-shift deep link, /hours?shift=<id>: same
                route, so the bar is there for the correction too. */}
            <Route path="/hours" element={<MyHoursPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/profile" element={<ProfilePage />} />

            <Route path="/profile/language" element={<LanguagePage />} />
            <Route path="/payout/:distributionId" element={<PayoutPage />} />
            <Route path="/report" element={<ReportTipsPage />} />

            <Route path="/notifications" element={<NotificationsPage />} />
          </Route>

          {/* ── manager ───────────────────────────────────────────────────── */}
          {/*
            The manager area keeps its tab bar. Not only on the four roots: on
            everything pushed from them too — a distribution and its payout,
            correction and question states, the sent confirmation, a team
            member, every rules subpage, the period close, the hours review,
            the reports. Release testing found the old split trapping people:
            finishing a distribution left them several screens deep with no way
            to another section except unwinding the stack one back-tap at a
            time.

            It costs no layout. `.tabBar` is the last flex item of the screen
            column, not a fixed overlay, so it takes its own room at the bottom
            of the viewport, carries the iOS inset itself, and covers nothing —
            `.body` is the only thing that scrolls. Screens learn it is there
            through TabsPresentContext and set their bottom spacing from that.
          */}
          <Route element={<RequireManager />}>
            <Route element={<AppLayout withTabs />}>
              <Route path="/manager" element={<DashboardPage />} />
              <Route path="/manager/distributions" element={<DistributionsPage />} />
              <Route path="/manager/team" element={<TeamPage />} />
              <Route path="/manager/rules" element={<RulesPage />} />

              <Route path="/manager/sent" element={<SentPage />} />
              {/* The real confirmation names the night it is about, so a
                  refresh reads the same record instead of a memory. */}
              <Route path="/manager/sent/:distributionId" element={<SentPage />} />
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

            {/*
              THE EXCEPTION, and the only one: the four steps of the
              distribution wizard.

              Each step writes something real the moment it is passed — step 1
              opens a tip_pools row and attaches the night's reports to it,
              step 2 activates a rule version, step 4 calculates a draft
              distribution — and a period close refuses to run while a draft is
              open. All of it is recoverable (void_pool, discard the draft,
              recalculate), so leaving is not destructive; but a tab bar here
              would put four one-tap ways out under a flow that is halfway
              through writing those rows, and the raised + in the middle of it
              restarts the very wizard the manager is standing in. The wizard
              carries its own step navigation and its own back arrow, which is
              the whole of its navigation on purpose.
            */}
            <Route element={<AppLayout />}>
              <Route path="/manager/new" element={<Navigate to="/manager/new/pool" replace />} />
              <Route path="/manager/new/pool" element={<WizardPoolPage />} />
              <Route path="/manager/new/areas" element={<WizardAreasPage />} />
              <Route path="/manager/new/hours" element={<HoursReviewPage mode="wizard" />} />
              <Route path="/manager/new/result" element={<WizardResultPage />} />
            </Route>
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
