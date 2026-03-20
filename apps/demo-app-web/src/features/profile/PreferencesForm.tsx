import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Divider,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import type { User, UserOptions } from "../../types/user.ts";
import { useUpdatePreferences } from "../../hooks/useUser.ts";

interface Props {
  user: User;
  options: UserOptions;
}

const schema = z.object({
  plan: z.enum(["free", "basic", "pro"]),
  favoriteColor: z.string().nullable(),
  favoriteNumber: z.number().nullable(),
});

type FormValues = z.infer<typeof schema>;

export default function PreferencesForm({ user, options }: Props) {
  const update = useUpdatePreferences(user.id);

  const { control, handleSubmit, reset, formState: { isDirty } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      plan: user.plan,
      favoriteColor: user.favoriteColor,
      favoriteNumber: user.favoriteNumber ?? null,
    },
  });

  // Sync form when user data changes (e.g. after successful save)
  useEffect(() => {
    reset({
      plan: user.plan,
      favoriteColor: user.favoriteColor,
      favoriteNumber: user.favoriteNumber ?? null,
    });
  }, [user, reset]);

  function onSubmit(values: FormValues) {
    const prefs: Record<string, unknown> = { plan: values.plan };
    if (values.favoriteColor !== null) prefs.favoriteColor = values.favoriteColor;
    if (options.favoriteNumberEnabled && values.favoriteNumber !== null) {
      prefs.favoriteNumber = values.favoriteNumber;
    }
    update.mutate(prefs);
  }

  const numberMin = options.favoriteNumberRange?.min ?? 0;
  const numberMax = options.favoriteNumberRange?.max ?? 100;

  return (
    <Card>
      <CardHeader
        title="Preferences"
        titleTypographyProps={{ variant: "subtitle1", fontWeight: 700 }}
      />
      <Divider />
      <CardContent>
        <Box component="form" onSubmit={handleSubmit(onSubmit)}>
          <Stack spacing={3}>
            {/* Plan */}
            <Controller
              name="plan"
              control={control}
              render={({ field, fieldState }) => (
                <FormControl fullWidth error={!!fieldState.error}>
                  <InputLabel>Plan</InputLabel>
                  <Select {...field} label="Plan">
                    <MenuItem value="free">Free</MenuItem>
                    <MenuItem value="basic">Basic</MenuItem>
                    <MenuItem value="pro">Pro</MenuItem>
                  </Select>
                  {fieldState.error && (
                    <FormHelperText>{fieldState.error.message}</FormHelperText>
                  )}
                </FormControl>
              )}
            />

            {/* Favorite Color */}
            <Controller
              name="favoriteColor"
              control={control}
              render={({ field }) => (
                <Box>
                  <Typography variant="body2" color="text.secondary" mb={1}>
                    Favorite Color
                  </Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                    {options.availableColors.map((color) => {
                      const selected = field.value === color;
                      return (
                        <Tooltip key={color} title={color}>
                          <Box
                            onClick={() => field.onChange(color)}
                            sx={{
                              width: 36,
                              height: 36,
                              borderRadius: "50%",
                              bgcolor: color,
                              border: "3px solid",
                              borderColor: selected ? "primary.main" : "divider",
                              cursor: "pointer",
                              boxShadow: selected ? 3 : 0,
                              transform: selected ? "scale(1.15)" : "scale(1)",
                              transition: "all 0.15s",
                            }}
                          />
                        </Tooltip>
                      );
                    })}
                  </Box>
                  {field.value && (
                    <Typography variant="caption" color="text.secondary" mt={0.5} display="block">
                      Selected: {field.value}
                    </Typography>
                  )}
                </Box>
              )}
            />

            {/* Favorite Number — only rendered when flag is on */}
            {options.favoriteNumberEnabled && (
              <Controller
                name="favoriteNumber"
                control={control}
                render={({ field }) => (
                  <Box>
                    <Typography variant="body2" color="text.secondary" mb={2}>
                      Favorite Number&nbsp;
                      <Typography component="span" variant="caption" color="text.disabled">
                        ({numberMin}–{numberMax})
                      </Typography>
                    </Typography>
                    <Stack direction="row" spacing={2} alignItems="center">
                      <Slider
                        value={field.value ?? numberMin}
                        onChange={(_, v) => field.onChange(v as number)}
                        min={numberMin}
                        max={numberMax}
                        step={1}
                        valueLabelDisplay="auto"
                        sx={{ flexGrow: 1 }}
                      />
                      <Typography variant="body1" fontWeight={600} minWidth={32} textAlign="right">
                        {field.value ?? numberMin}
                      </Typography>
                    </Stack>
                  </Box>
                )}
              />
            )}

            {update.isError && (
              <Alert severity="error">{update.error.message}</Alert>
            )}

            {update.isSuccess && !isDirty && (
              <Alert severity="success">Preferences saved.</Alert>
            )}

            <Button
              type="submit"
              variant="contained"
              startIcon={update.isPending ? <CircularProgress size={16} /> : <SaveIcon />}
              disabled={update.isPending || !isDirty}
              fullWidth
            >
              Save Changes
            </Button>
          </Stack>
        </Box>
      </CardContent>
    </Card>
  );
}
