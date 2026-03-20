import { useNavigate } from 'react-router';
import {
  Table, TableHead, TableRow, TableCell, TableBody,
  Chip, IconButton, Tooltip, TableContainer, Paper,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import type { Flag } from '../../types/flag';
import { formatDate } from '../../lib/utils';
import { useDeleteFlag } from '../../hooks/useFlags';
import { SignedIn } from '@clerk/clerk-react';

interface Props {
  flags: Flag[];
}

const TYPE_COLOR: Record<string, 'default' | 'primary' | 'secondary'> = {
  boolean: 'default',
  percentage: 'primary',
  user_segmented: 'secondary',
};

export function FlagTable({ flags }: Props) {
  const navigate = useNavigate();
  const deleteFlag = useDeleteFlag();

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Key</TableCell>
            <TableCell>Name</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Updated</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {flags.map((flag) => (
            <TableRow
              key={flag.id}
              hover
              sx={{ cursor: 'pointer' }}
              onClick={() => navigate(`/flags/${flag.key}`)}
            >
              <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{flag.key}</TableCell>
              <TableCell>{flag.name}</TableCell>
              <TableCell>
                <Chip label={flag.type} size="small" color={TYPE_COLOR[flag.type]} />
              </TableCell>
              <TableCell>{formatDate(flag.updatedAt)}</TableCell>
              <SignedIn>
                <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                <Tooltip title="Delete flag">
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => {
                      if (confirm(`Delete flag "${flag.key}"?`)) {
                        deleteFlag.mutate(flag.key);
                      }
                    }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </TableCell>
              </SignedIn>
            </TableRow>
          ))}
          {flags.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                No flags found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
