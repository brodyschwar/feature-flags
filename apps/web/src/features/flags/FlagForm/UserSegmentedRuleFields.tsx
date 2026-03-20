import { useFormContext, useFieldArray, Controller } from 'react-hook-form';
import {
  Box, Typography, Button, IconButton, TextField,
  Select, MenuItem, FormControl, InputLabel, FormControlLabel, Switch, Divider, Paper,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';

const OPERATORS = ['eq', 'neq', 'in', 'not_in', 'contains', 'regex'] as const;

export function UserSegmentedRuleFields() {
  const { control, register } = useFormContext();
  const { fields, append, remove } = useFieldArray({ control, name: 'rules.segments' });

  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>Segments</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Evaluated top-to-bottom. First match wins.
      </Typography>

      {fields.map((field, i) => (
        <Paper key={field.id} variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <TextField
              label="Attribute"
              size="small"
              {...register(`rules.segments.${i}.attribute`)}
              sx={{ flex: 1, minWidth: 120 }}
            />
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>Operator</InputLabel>
              <Controller
                name={`rules.segments.${i}.operator`}
                control={control}
                defaultValue="eq"
                render={({ field }) => (
                  <Select label="Operator" {...field}>
                    {OPERATORS.map((op) => (
                      <MenuItem key={op} value={op}>{op}</MenuItem>
                    ))}
                  </Select>
                )}
              />
            </FormControl>
            <TextField
              label="Values (comma-separated)"
              size="small"
              sx={{ flex: 2, minWidth: 180 }}
              defaultValue=""
              {...register(`rules.segments.${i}.values`, {
                setValueAs: (v: string | string[]) =>
                  Array.isArray(v) ? v : v.split(',').map((s: string) => s.trim()).filter(Boolean),
              })}
            />
            <Controller
              name={`rules.segments.${i}.result`}
              control={control}
              defaultValue={true}
              render={({ field }) => (
                <FormControlLabel
                  control={<Switch checked={field.value} onChange={field.onChange} size="small" />}
                  label="Result"
                />
              )}
            />
            <IconButton color="error" onClick={() => remove(i)} size="small">
              <DeleteIcon />
            </IconButton>
          </Box>
        </Paper>
      ))}

      <Button
        startIcon={<AddIcon />}
        onClick={() => append({ attribute: '', operator: 'eq', values: [], result: true })}
        variant="outlined"
        size="small"
        sx={{ mb: 3 }}
      >
        Add segment
      </Button>

      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" gutterBottom>Default value (no match)</Typography>
      <Controller
        name="rules.defaultValue"
        control={control}
        defaultValue={false}
        render={({ field }) => (
          <FormControlLabel
            control={<Switch checked={field.value} onChange={field.onChange} />}
            label={field.value ? 'true' : 'false'}
          />
        )}
      />
    </Box>
  );
}
