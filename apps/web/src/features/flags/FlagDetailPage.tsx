import { useParams, useNavigate } from 'react-router';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Box, Paper, Button, Alert, CircularProgress, Typography, Chip } from '@mui/material';
import { PageHeader } from '../../components/Layout/PageHeader';
import { FlagFormFields } from './FlagForm/FlagForm';
import { EvaluatePanel } from './EvaluatePanel';
import { useFlag, useUpdateFlag, useDeleteFlag } from '../../hooks/useFlags';
import { useEffect } from 'react';
import { SignedIn } from '@clerk/clerk-react';

const patchSchema = z.object({
  key: z.string(),
  name: z.string().min(1, 'Required'),
  description: z.string(),
  type: z.string(),
  rules: z.any(),
});

type PatchValues = z.infer<typeof patchSchema>;

export function FlagDetailPage() {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const { data: flag, isLoading, isError, error } = useFlag(key!);
  const updateFlag = useUpdateFlag(key!);
  const deleteFlag = useDeleteFlag();

  const methods = useForm<PatchValues>({
    resolver: zodResolver(patchSchema),
  });

  useEffect(() => {
    if (flag) {
      methods.reset({ key: flag.key, name: flag.name, description: flag.description, type: flag.type, rules: flag.rules });
    }
  }, [flag, methods]);

  const onSubmit = methods.handleSubmit((data) => {
    updateFlag.mutate({ name: data.name, description: data.description, rules: data.rules });
  });

  if (isLoading) return <CircularProgress />;
  if (isError) return <Alert severity="error">{(error as Error).message}</Alert>;
  if (!flag) return null;

  return (
    <Box>
      <PageHeader
        title={flag.name}
        action={
          <SignedIn>
            <Button
              variant="outlined"
              color="error"
              onClick={() => {
                if (confirm(`Delete flag "${flag.key}"?`)) {
                  deleteFlag.mutate(flag.key, { onSuccess: () => navigate('/flags') });
                }
              }}
            >
              Delete
            </Button>
          </SignedIn>
        }
      />

      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <Typography variant="body2" sx={{ fontFamily: 'monospace', bgcolor: 'grey.100', px: 1, borderRadius: 1 }}>
          {flag.key}
        </Typography>
        <Chip label={flag.type} size="small" />
      </Box>

      <Paper variant="outlined" sx={{ p: 3, maxWidth: 600 }}>
        <FormProvider {...methods}>
          <form onSubmit={onSubmit}>
            <FlagFormFields disableTypeSelect />
            {updateFlag.isError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {(updateFlag.error as Error).message}
              </Alert>
            )}
            {updateFlag.isSuccess && (
              <Alert severity="success" sx={{ mt: 2 }}>Saved</Alert>
            )}
            <SignedIn>
              <Button type="submit" variant="contained" sx={{ mt: 2 }} disabled={updateFlag.isPending}>
                Save changes
              </Button>
            </SignedIn>
          </form>
        </FormProvider>
      </Paper>

      <EvaluatePanel flagKey={flag.key} type={flag.type} />
    </Box>
  );
}
