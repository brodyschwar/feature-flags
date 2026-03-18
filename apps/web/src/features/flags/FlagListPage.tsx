import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Box, Button, ToggleButtonGroup, ToggleButton, CircularProgress, Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { PageHeader } from '../../components/Layout/PageHeader';
import { FlagTable } from './FlagTable';
import { useFlags } from '../../hooks/useFlags';
import type { FlagType } from '../../types/flag';
import { SignedIn } from '@clerk/clerk-react';

export function FlagListPage() {
  const navigate = useNavigate();
  const [typeFilter, setTypeFilter] = useState<FlagType | undefined>();
  const { data: flags, isLoading, isError, error } = useFlags(typeFilter);

  return (
    <Box>
      <PageHeader
        title="Feature Flags"
        action={
          <SignedIn>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => navigate('/flags/new')}
            >
              New flag
            </Button>
          </SignedIn>
        }
      />

      <ToggleButtonGroup
        value={typeFilter ?? 'all'}
        exclusive
        size="small"
        onChange={(_, v) => setTypeFilter(v === 'all' ? undefined : v)}
        sx={{ mb: 2 }}
      >
        <ToggleButton value="all">All</ToggleButton>
        <ToggleButton value="boolean">Boolean</ToggleButton>
        <ToggleButton value="percentage">Percentage</ToggleButton>
        <ToggleButton value="user_segmented">User segmented</ToggleButton>
      </ToggleButtonGroup>

      {isLoading && <CircularProgress />}
      {isError && <Alert severity="error">{(error as Error).message}</Alert>}
      {flags && <FlagTable flags={flags} />}
    </Box>
  );
}
