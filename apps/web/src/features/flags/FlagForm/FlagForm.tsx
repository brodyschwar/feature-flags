import { useFormContext } from 'react-hook-form';
import { TextField, Box, MenuItem } from '@mui/material';
import { BooleanRuleFields } from './BooleanRuleFields';
import { PercentageRuleFields } from './PercentageRuleFields';
import { UserSegmentedRuleFields } from './UserSegmentedRuleFields';

interface Props {
  disableTypeSelect?: boolean;
}

export function FlagFormFields({ disableTypeSelect = false }: Props) {
  const { register, watch, formState: { errors } } = useFormContext();
  const type = watch('type');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField
        label="Key"
        size="small"
        {...register('key')}
        error={!!(errors as any).key}
        helperText={(errors as any).key?.message}
        placeholder="e.g. new-checkout-flow"
        disabled={disableTypeSelect}
      />
      <TextField
        label="Name"
        size="small"
        {...register('name')}
        error={!!(errors as any).name}
        helperText={(errors as any).name?.message}
      />
      <TextField
        label="Description"
        size="small"
        multiline
        rows={2}
        {...register('description')}
      />
      <TextField
        label="Type"
        size="small"
        select
        disabled={disableTypeSelect}
        value={type ?? 'boolean'}
        {...register('type')}
      >
        <MenuItem value="boolean">Boolean</MenuItem>
        <MenuItem value="percentage">Percentage rollout</MenuItem>
        <MenuItem value="user_segmented">User segmented</MenuItem>
      </TextField>

      {type === 'boolean' && <BooleanRuleFields />}
      {type === 'percentage' && <PercentageRuleFields />}
      {type === 'user_segmented' && <UserSegmentedRuleFields />}
    </Box>
  );
}
