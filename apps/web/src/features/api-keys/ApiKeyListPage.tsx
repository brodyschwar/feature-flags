import { useState } from 'react';
import {
  Box, Button, Paper, Table, TableHead, TableRow, TableCell,
  TableBody, TableContainer, IconButton, Tooltip, CircularProgress,
  Alert, Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { PageHeader } from '../../components/Layout/PageHeader';
import { CreateApiKeyDialog } from './CreateApiKeyDialog';
import { useApiKeys, useDeleteApiKey } from '../../hooks/useFlags';
import { formatDate } from '../../lib/utils';
import { SignedIn } from '@clerk/clerk-react';

export function ApiKeyListPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: keys, isLoading, isError, error } = useApiKeys();
  const deleteKey = useDeleteApiKey();

  return (
    <Box>
      <PageHeader
        title="API Keys"
        action={
          <SignedIn>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
              New key
            </Button>
          </SignedIn>
        }
      />

      {isLoading && <CircularProgress />}
      {isError && <Alert severity="error">{(error as Error).message}</Alert>}

      {keys && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Created</TableCell>
                <TableCell>Last used</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell>{k.name}</TableCell>
                  <TableCell>{formatDate(k.createdAt)}</TableCell>
                  <TableCell>
                    {k.lastUsedAt ? formatDate(k.lastUsedAt) : (
                      <Typography variant="body2" color="text.disabled">Never</Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <SignedIn>
                      {k.deletable && (
                        <Tooltip title="Revoke key">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => {
                              if (confirm(`Revoke key "${k.name}"?`)) {
                                deleteKey.mutate(k.id);
                              }
                            }}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </SignedIn>
                  </TableCell>
                </TableRow>
              ))}
              {keys.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    No API keys yet
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <CreateApiKeyDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </Box>
  );
}
