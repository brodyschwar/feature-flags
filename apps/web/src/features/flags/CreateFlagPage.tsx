import { useNavigate } from 'react-router';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Box, Button, Paper, Alert } from '@mui/material';
import { PageHeader } from '../../components/Layout/PageHeader';
import { FlagFormFields } from './FlagForm/FlagForm';
import { useCreateFlag } from '../../hooks/useFlags';

const schema = z.discriminatedUnion('type', [
  z.object({
    key: z.string().min(1, 'Required'),
    name: z.string().min(1, 'Required'),
    description: z.string(),
    type: z.literal('boolean'),
    rules: z.object({ enabled: z.boolean() }),
  }),
  z.object({
    key: z.string().min(1, 'Required'),
    name: z.string().min(1, 'Required'),
    description: z.string(),
    type: z.literal('percentage'),
    rules: z.object({ percentage: z.number().min(0).max(100) }),
  }),
  z.object({
    key: z.string().min(1, 'Required'),
    name: z.string().min(1, 'Required'),
    description: z.string(),
    type: z.literal('user_segmented'),
    rules: z.object({
      segments: z.array(z.object({
        attribute: z.string().min(1),
        operator: z.enum(['eq', 'neq', 'in', 'not_in', 'contains', 'regex']),
        values: z.array(z.string()),
        result: z.boolean(),
      })),
      defaultValue: z.boolean(),
    }),
  }),
]);

type FormValues = z.infer<typeof schema>;

export function CreateFlagPage() {
  const navigate = useNavigate();
  const createFlag = useCreateFlag();
  const methods = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'boolean', key: '', name: '', description: '', rules: { enabled: false } },
  });

  const onSubmit = methods.handleSubmit((data) => {
    createFlag.mutate(data as any, {
      onSuccess: (flag) => navigate(`/flags/${flag.key}`),
    });
  });

  return (
    <Box>
      <PageHeader title="Create flag" />
      <Paper variant="outlined" sx={{ p: 3, maxWidth: 600 }}>
        <FormProvider {...methods}>
          <form onSubmit={onSubmit}>
            <FlagFormFields />
            {createFlag.isError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {(createFlag.error as Error).message}
              </Alert>
            )}
            <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
              <Button type="submit" variant="contained" disabled={createFlag.isPending}>
                Create
              </Button>
              <Button variant="outlined" onClick={() => navigate('/flags')}>
                Cancel
              </Button>
            </Box>
          </form>
        </FormProvider>
      </Paper>
    </Box>
  );
}
