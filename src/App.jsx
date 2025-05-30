import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import Dashboard from './pages/Dashboard';
import Flashcards from './pages/Flashcards';
import Questions from './pages/Questions';
import Progress from './pages/Progress';
import Settings from './pages/Settings';
import Account from './pages/Account';
import Login from './pages/Login';
import PageNotFound from './pages/PageNotFound';
import AppLayout from './ui/AppLayout';
import { Toaster } from 'react-hot-toast';
import CreateFromText from './pages/CreateFromText';
import PracticeCards from './pages/PracticeCards';

function App() {
  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Navigate replace to="dashboard" />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="flashcards" element={<Flashcards />} />
            <Route path="progress" element={<Progress />} />
            <Route path="questions" element={<Questions />} />
            <Route path="settings" element={<Settings />} />
            <Route path="account" element={<Account />} />
            <Route path="fromtext" element={<CreateFromText />} />
            <Route path="practice" element={<PracticeCards />} />
          </Route>

          <Route path="login" element={<Login />} />
          <Route path="*" element={<PageNotFound />} />
        </Routes>
      </BrowserRouter>

      <Toaster
        position="top-center"
        gutter={12}
        containerStyle={{ margin: '8px' }}
        toastOptions={{
          success: {
            duration: 3000,
          },
          error: {
            duration: 5000,
          },
          style: {
            fontSize: '16px',
            maxWidth: '500px',
            padding: '16px 24px',
            backgroundColor: 'var(--color-grey-0)',
            color: 'var(--color-grey-700)',
          },
        }}
      />
    </>
  );
}

export default App;
