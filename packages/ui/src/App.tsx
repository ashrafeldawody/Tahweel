import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LOGIN_ROUTE, RequireAuth } from './auth/RequireAuth';
import { AppLayout } from './layout/AppLayout';
import { DevicesPage } from './pages/DevicesPage';
import { IntentsPage } from './pages/IntentsPage';
import { LoginPage } from './pages/LoginPage';
import { MessagesPage } from './pages/MessagesPage';
import { OverviewPage } from './pages/OverviewPage';
import { SettingsPage } from './pages/SettingsPage';
import { WebhooksPage } from './pages/WebhooksPage';
import { theme } from './theme';

export const HOME_ROUTE = '/app/overview';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={HOME_ROUTE} replace />} />
      <Route path={LOGIN_ROUTE} element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/app/overview" element={<OverviewPage />} />
          <Route path="/app/devices" element={<DevicesPage />} />
          <Route path="/app/messages" element={<MessagesPage />} />
          <Route path="/app/intents" element={<IntentsPage />} />
          <Route path="/app/webhooks" element={<WebhooksPage />} />
          <Route path="/app/settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to={HOME_ROUTE} replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <MantineProvider theme={theme} forceColorScheme="light">
      <Notifications position="top-right" limit={4} />
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </MantineProvider>
  );
}
