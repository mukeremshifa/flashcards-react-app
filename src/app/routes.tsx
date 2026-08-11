import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { PagePlaceholder } from '@/components/PagePlaceholder';

/**
 * Every route from SPEC §8.2 exists here as a placeholder so the shell is
 * navigable and the route table is reviewable now. P1 replaces these elements
 * with real feature components under src/features/<domain>/ — one route at a
 * time, so the app never stops running.
 *
 * Auth guarding is intentionally absent: there is no auth yet (P1), and a
 * <ProtectedRoute> that always passes is a trap waiting to be forgotten.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate replace to="/dashboard" />} />

        <Route
          path="dashboard"
          element={
            <PagePlaceholder title="Dashboard" phase="P1">
              <p>Due today, current streak, quick-practice entry, recent decks.</p>
            </PagePlaceholder>
          }
        />

        <Route
          path="decks"
          element={
            <PagePlaceholder title="Decks" phase="P1">
              <p>Deck list with card counts, due counts, search.</p>
            </PagePlaceholder>
          }
        />
        <Route
          path="decks/:deckId"
          element={
            <PagePlaceholder title="Deck detail" phase="P1">
              <p>Card table, inline edit, manual add for all three card kinds.</p>
            </PagePlaceholder>
          }
        />

        <Route
          path="create/text"
          element={
            <PagePlaceholder title="Create from text" phase="P2">
              <p>Paste text, choose card count and kinds, stream generated cards.</p>
            </PagePlaceholder>
          }
        />
        <Route
          path="create/review/:deckId"
          element={
            <PagePlaceholder title="Review gate" phase="P2">
              <p>Approve, edit, or reject each draft card before it enters the deck.</p>
            </PagePlaceholder>
          }
        />

        <Route
          path="practice"
          element={
            <PagePlaceholder title="Practice — all decks" phase="P1">
              <p>Due queue across every deck, FSRS grading, undo.</p>
            </PagePlaceholder>
          }
        />
        <Route
          path="practice/:deckId"
          element={
            <PagePlaceholder title="Practice — single deck" phase="P1">
              <p>Same queue, scoped to one deck.</p>
            </PagePlaceholder>
          }
        />

        <Route
          path="progress"
          element={
            <PagePlaceholder title="Progress" phase="P3">
              <p>Review heatmap, streak, retention, due forecast, card-state mix.</p>
            </PagePlaceholder>
          }
        />

        <Route
          path="settings"
          element={
            <PagePlaceholder title="Settings" phase="P1">
              <p>Daily new-card limit, timezone, quota usage.</p>
            </PagePlaceholder>
          }
        />
        <Route path="account" element={<PagePlaceholder title="Account" phase="P1" />} />
      </Route>

      <Route path="login" element={<PagePlaceholder title="Sign in" phase="P1" />} />
      <Route
        path="signup"
        element={<PagePlaceholder title="Create account" phase="P1" />}
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
