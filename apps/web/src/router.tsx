import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from './components/Layout/AppShell';
import { FlagListPage } from './features/flags/FlagListPage';
import { FlagDetailPage } from './features/flags/FlagDetailPage';
import { CreateFlagPage } from './features/flags/CreateFlagPage';
import { ApiKeyListPage } from './features/api-keys/ApiKeyListPage';
import { SignIn } from '@clerk/clerk-react';
import { Box } from '@mui/material';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/flags" replace /> },
      { path: 'flags', element: <FlagListPage /> },
      { path: 'flags/new', element: <CreateFlagPage /> },
      { path: 'flags/:key', element: <FlagDetailPage /> },
      { path: 'api-keys', element: <ApiKeyListPage /> },
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
