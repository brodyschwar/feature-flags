import { Controller, useFormContext } from 'react-hook-form';
import { FormControlLabel, Switch, Box, Typography } from '@mui/material';

export function BooleanRuleFields() {
  const { control } = useFormContext();
  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>Rules</Typography>
      <Controller
        name="rules.enabled"
        control={control}
        defaultValue={false}
        render={({ field }) => (
          <FormControlLabel
            control={<Switch checked={field.value} onChange={field.onChange} />}
            label="Enabled"
          />
        )}
      />
    </Box>
  );
}
