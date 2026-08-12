import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { NotFoundPage } from './NotFoundPage';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthCallbackPage } from '@/features/auth/AuthCallbackPage';
import { LoginPage, SignupPage } from '@/features/auth/AuthPages';
import { ProtectedRoute, PublicOnlyRoute } from '@/features/auth/ProtectedRoute';
import { DashboardPage } from '@/features/decks/DashboardPage';
import { DecksPage } from '@/features/decks/DecksPage';

/**
 * The route table from SPEC §8.2.
 *
 * Everything inside the AppLayout needs a session, so the guard wraps the layout
 * route rather than each child — one place to get right, and no route can be
 * added later that quietly skips it.
 *
 * **What is eager and why.** The bundle that matters is the one a signed-out
 * visitor downloads to see a login form. So the auth pages stay eager, and so do
 * the dashboard and the deck list — they are the first screen after signing in,
 * and a spinner there costs more than the bytes save. Everything else is behind
 * `React.lazy`: the generation pipeline and its schemas, the card editor and its
 * dialogs, `ts-fsrs`, and Recharts. P4 task 4; measured in docs/plans/P4-ship.md.
 *
 * A lazy route only pays off if nothing eager imports the same heavy module —
 * `DashboardPage` importing `streaks` from `src/lib/progress.ts` is why that
 * module stays in the main chunk. Check the build table after touching imports.
 */

const DeckDetailPage = lazy(() =>
  import('@/features/decks/DeckDetailPage').then(module => ({
    default: module.DeckDetailPage,
  })),
);
const CreateFromTextPage = lazy(() =>
  import('@/features/generate/CreateFromTextPage').then(module => ({
    default: module.CreateFromTextPage,
  })),
);
const ReviewGatePage = lazy(() =>
  import('@/features/generate/ReviewGatePage').then(module => ({
    default: module.ReviewGatePage,
  })),
);
const PracticePage = lazy(() =>
  import('@/features/practice/PracticePage').then(module => ({
    default: module.PracticePage,
  })),
);
const ProgressPage = lazy(() =>
  import('@/features/progress/ProgressPage').then(module => ({
    default: module.ProgressPage,
  })),
);
const SettingsPage = lazy(() =>
  import('@/features/settings/SettingsPage').then(module => ({
    default: module.SettingsPage,
  })),
);

/**
 * One fallback for every split route. Page-shaped rather than a centred
 * spinner: the layout does not jump when the real page arrives.
 */
function Lazy({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

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
        <Route
          path="decks/:deckId"
          element={
            <Lazy>
              <DeckDetailPage />
            </Lazy>
          }
        />

        <Route
          path="create/text"
          element={
            <Lazy>
              <CreateFromTextPage />
            </Lazy>
          }
        />
        <Route
          path="create/review/:deckId"
          element={
            <Lazy>
              <ReviewGatePage />
            </Lazy>
          }
        />

        <Route
          path="practice"
          element={
            <Lazy>
              <PracticePage />
            </Lazy>
          }
        />
        <Route
          path="practice/:deckId"
          element={
            <Lazy>
              <PracticePage />
            </Lazy>
          }
        />

        <Route
          path="progress"
          element={
            <Lazy>
              <ProgressPage />
            </Lazy>
          }
        />

        <Route
          path="settings"
          element={
            <Lazy>
              <SettingsPage />
            </Lazy>
          }
        />
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
      {/* Where Supabase sends a confirmation or recovery link. Deliberately not
          behind PublicOnlyRoute — see AuthCallbackPage. */}
      <Route path="auth/callback" element={<AuthCallbackPage />} />

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
