import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { PagePlaceholder } from '@/components/PagePlaceholder';
import { Skeleton } from '@/components/ui/skeleton';
import { LoginPage, SignupPage } from '@/features/auth/AuthPages';
import { ProtectedRoute, PublicOnlyRoute } from '@/features/auth/ProtectedRoute';
import { DashboardPage } from '@/features/decks/DashboardPage';
import { DeckDetailPage } from '@/features/decks/DeckDetailPage';
import { DecksPage } from '@/features/decks/DecksPage';
import { CreateFromTextPage } from '@/features/generate/CreateFromTextPage';
import { ReviewGatePage } from '@/features/generate/ReviewGatePage';
import { PracticePage } from '@/features/practice/PracticePage';
import { SettingsPage } from '@/features/settings/SettingsPage';

/**
 * The route table from SPEC §8.2.
 *
 * Everything inside the AppLayout needs a session, so the guard wraps the layout
 * route rather than each child — one place to get right, and no route can be
 * added later that quietly skips it.
 *
 * `/progress` is loaded lazily: it is the only page that pulls in Recharts, and
 * a charting library has no business in the bundle that renders the login form.
 * That boundary is also where P4's code-splitting work starts.
 */
const ProgressPage = lazy(() =>
  import('@/features/progress/ProgressPage').then(module => ({
    default: module.ProgressPage,
  })),
);

export function AppRoutes() {
  return (
    <Routes>
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate replace to="/dashboard" />} />

        <Route path="dashboard" element={<DashboardPage />} />

        <Route path="decks" element={<DecksPage />} />
        <Route path="decks/:deckId" element={<DeckDetailPage />} />

        <Route path="create/text" element={<CreateFromTextPage />} />
        <Route path="create/review/:deckId" element={<ReviewGatePage />} />

        <Route path="practice" element={<PracticePage />} />
        <Route path="practice/:deckId" element={<PracticePage />} />

        <Route
          path="progress"
          element={
            <Suspense
              fallback={
                <div className="space-y-6">
                  <Skeleton className="h-9 w-40" />
                  <Skeleton className="h-28 w-full rounded-xl" />
                  <Skeleton className="h-48 w-full rounded-xl" />
                </div>
              }
            >
              <ProgressPage />
            </Suspense>
          }
        />

        <Route path="settings" element={<SettingsPage />} />
        <Route path="account" element={<Navigate replace to="/settings" />} />
      </Route>

      <Route
        path="login"
        element={
          <PublicOnlyRoute>
            <LoginPage />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="signup"
        element={
          <PublicOnlyRoute>
            <SignupPage />
          </PublicOnlyRoute>
        }
      />

      <Route
        path="*"
        element={
          <PagePlaceholder title="Page not found" phase="P4">
            <p>This route does not exist.</p>
          </PagePlaceholder>
        }
      />
    </Routes>
  );
}
