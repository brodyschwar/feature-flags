import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Alert, Box, Typography, IconButton, Tooltip,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useCreateApiKey } from '../../hooks/useFlags';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreateApiKeyDialog({ open, onClose }: Props) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<{ name: string }>();
  const createKey = useCreateApiKey();
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const onSubmit = handleSubmit(({ name }) => {
    createKey.mutate(name, {
      onSuccess: (data) => setCreatedKey(data.key),
    });
  });

  const handleClose = () => {
    reset();
    setCreatedKey(null);
    setCopied(false);
    createKey.reset();
    onClose();
  };

  const handleCopy = () => {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey);
      setCopied(true);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Create API Key</DialogTitle>
      {!createdKey ? (
        <form onSubmit={onSubmit}>
          <DialogContent>
            <TextField
              label="Name"
              size="small"
              fullWidth
              autoFocus
              {...register('name', { required: 'Required' })}
              error={!!errors.name}
              helperText={errors.name?.message}
              placeholder="e.g. production-backend"
            />
            {createKey.isError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {(createKey.error as Error).message}
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={handleClose}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={createKey.isPending}>
              Create
            </Button>
          </DialogActions>
        </form>
      ) : (
        <>
          <DialogContent>
            <Alert severity="warning" sx={{ mb: 2 }}>
              Copy this key now — it will never be shown again.
            </Alert>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'grey.100', p: 1.5, borderRadius: 1 }}>
              <Typography sx={{ fontFamily: 'monospace', fontSize: '0.85rem', flex: 1, wordBreak: 'break-all' }}>
                {createdKey}
              </Typography>
              <Tooltip title={copied ? 'Copied!' : 'Copy'}>
                <IconButton onClick={handleCopy} size="small">
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button variant="contained" onClick={handleClose}>Done</Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
