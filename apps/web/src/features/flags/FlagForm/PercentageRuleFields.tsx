import { Controller, useFormContext } from 'react-hook-form';
import { Box, Typography, Slider, TextField } from '@mui/material';

export function PercentageRuleFields() {
  const { control, formState: { errors } } = useFormContext();
  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>Rules</Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Rollout Percentage (0–100)
      </Typography>
      <Controller
        name="rules.percentage"
        control={control}
        defaultValue={0}
        render={({ field }) => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Slider
              value={field.value}
              onChange={(_, v) => field.onChange(v)}
              min={0}
              max={100}
              valueLabelDisplay="auto"
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              type="number"
              value={field.value}
              onChange={(e) => field.onChange(Number(e.target.value))}
              sx={{ width: 80 }}
              inputProps={{ min: 0, max: 100 }}
              error={!!(errors as any)?.rules?.percentage}
            />
          </Box>
        )}
      />
    </Box>
  );
}
