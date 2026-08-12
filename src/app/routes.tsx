import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { PagePlaceholder } from '@/components/PagePlaceholder';
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
 * The routes still showing a placeholder belong to phases that have not run:
 * the progress dashboard is P3.
 */
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
            <PagePlaceholder title="Progress" phase="P3">
              <p>Review heatmap, streak, retention, due forecast, card-state mix.</p>
            </PagePlaceholder>
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
