import { createBrowserRouter, Navigate, Outlet, useNavigate } from 'react-router';
import { AppShell } from './components/Layout/AppShell';
import { FlagListPage } from './features/flags/FlagListPage';
import { FlagDetailPage } from './features/flags/FlagDetailPage';
import { CreateFlagPage } from './features/flags/CreateFlagPage';
import { ApiKeyListPage } from './features/api-keys/ApiKeyListPage';
import { ClerkProvider, SignIn, useAuth } from '@clerk/clerk-react';
import { Box } from '@mui/material';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;

function ClerkProviderWithRouter() {
  const navigate = useNavigate();
  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
    >
      <Outlet />
    </ClerkProvider>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}

export const router = createBrowserRouter([
  {
    element: <ClerkProviderWithRouter />,
    children: [
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
    ],
  },
]);
