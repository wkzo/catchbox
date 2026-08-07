import { createBrowserRouter, Navigate, Outlet, redirect } from 'react-router';
import { api } from './lib/api.js';
import { AuthPage } from './pages/Auth.js';
import { MailShell } from './pages/Mail.js';
import { AliasesPage } from './pages/Aliases.js';
import { RulesPage } from './pages/Rules.js';
import { SettingsPage } from './pages/Settings.js';
import { DiagnosticsPage } from './pages/Diagnostics.js';
import { AppFrame } from './components/AppFrame.js';

async function authLoader() {
  const state = await api.authState().catch(() => null);
  if (!state) throw redirect('/auth');
  if (state.setupRequired || !state.authenticated) throw redirect('/auth');
  return state;
}

export const router = createBrowserRouter([
  { path: '/auth', element: <AuthPage /> },
  {
    element: <ProtectedShell />,
    loader: authLoader,
    children: [
      { path: '/', element: <Navigate to="/mail" replace /> },
      { path: '/mail', element: <MailShell /> },
      { path: '/aliases', element: <AliasesPage /> },
      { path: '/rules', element: <RulesPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/diagnostics', element: <DiagnosticsPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/mail" replace /> },
]);

function ProtectedShell() {
  return (
    <AppFrame>
      <Outlet />
    </AppFrame>
  );
}
