import { useState } from 'react';
import {
  Box, Typography, TextField, Button, Alert, Paper, Divider,
} from '@mui/material';
import { useEvaluateFlag } from '../../hooks/useFlags';
import type { FlagType } from '../../types/flag';

interface Props {
  flagKey: string;
  type: FlagType;
}

export function EvaluatePanel({ flagKey, type }: Props) {
  const [userId, setUserId] = useState('');
  const [attrs, setAttrs] = useState('');
  const evaluate = useEvaluateFlag(flagKey);

  const handleEvaluate = () => {
    let attributes: Record<string, string> | undefined;
    try {
      attributes = attrs.trim() ? JSON.parse(attrs) : undefined;
    } catch {
      evaluate.reset();
      return;
    }
    evaluate.mutate({ userId: userId || undefined, attributes });
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, mt: 3 }}>
      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
        Test Evaluation
      </Typography>
      <Divider sx={{ mb: 2 }} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {(type === 'percentage' || type === 'user_segmented') && (
          <TextField
            label="userId"
            size="small"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="e.g. user_abc123"
          />
        )}
        {type === 'user_segmented' && (
          <TextField
            label='attributes (JSON, e.g. {"plan":"pro"})'
            size="small"
            multiline
            rows={3}
            value={attrs}
            onChange={(e) => setAttrs(e.target.value)}
          />
        )}
        <Button variant="contained" onClick={handleEvaluate} disabled={evaluate.isPending}>
          Evaluate
        </Button>
        {evaluate.isSuccess && (
          <Alert severity={evaluate.data.result ? 'success' : 'info'}>
            Result: <strong>{String(evaluate.data.result)}</strong>
          </Alert>
        )}
        {evaluate.isError && (
          <Alert severity="error">{(evaluate.error as Error).message}</Alert>
        )}
      </Box>
    </Paper>
  );
}
