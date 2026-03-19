import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from './components/Layout/AppShell';
import { FlagListPage } from './features/flags/FlagListPage';
import { FlagDetailPage } from './features/flags/FlagDetailPage';
import { CreateFlagPage } from './features/flags/CreateFlagPage';
import { ApiKeyListPage } from './features/api-keys/ApiKeyListPage';
import { SignIn, useAuth } from '@clerk/clerk-react';
import { Box } from '@mui/material';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/flags" replace /> },
      { path: 'flags', element: <FlagListPage /> },
      { path: 'flags/new', element: <RequireAuth><CreateFlagPage /></RequireAuth> },
      { path: 'flags/:key', element: <RequireAuth><FlagDetailPage /></RequireAuth> },
      { path: 'api-keys', element: <RequireAuth><ApiKeyListPage /></RequireAuth> },
    ],
  },
  {
    path: '/sign-in',
    element: (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <SignIn />
      </Box>
    ),
  },
]);
