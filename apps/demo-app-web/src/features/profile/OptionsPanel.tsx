import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Tooltip,
  Typography,
  Alert,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import type { UserOptions } from "../../types/user.ts";

interface Props {
  options: UserOptions | undefined;
  isLoading: boolean;
  error: Error | null;
}

export default function OptionsPanel({ options, isLoading, error }: Props) {
  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardHeader
        title="Flag State"
        subheader="Live output of GET /users/:id/options"
        titleTypographyProps={{ variant: "subtitle1", fontWeight: 700 }}
        subheaderTypographyProps={{ variant: "caption" }}
      />
      <Divider />
      <CardContent>
        {isLoading && (
          <Box display="flex" justifyContent="center" py={4}>
            <CircularProgress size={28} />
          </Box>
        )}

        {error && <Alert severity="error">{error.message}</Alert>}

        {options && (
          <Stack spacing={3}>
            {/* show-favorite-number */}
            <Box>
              <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                show-favorite-number
              </Typography>
              <Stack direction="row" alignItems="center" spacing={1}>
                {options.favoriteNumberEnabled ? (
                  <CheckCircleIcon fontSize="small" color="success" />
                ) : (
                  <CancelIcon fontSize="small" color="disabled" />
                )}
                <Typography variant="body2" fontWeight={500}>
                  {options.favoriteNumberEnabled ? "Enabled" : "Disabled"}
                </Typography>
                {options.favoriteNumberRange && (
                  <Typography variant="body2" color="text.secondary">
                    — range&nbsp;
                    <strong>
                      {options.favoriteNumberRange.min}–{options.favoriteNumberRange.max}
                    </strong>
                  </Typography>
                )}
              </Stack>
            </Box>

            {/* extended-color-palette */}
            <Box>
              <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                extended-color-palette — {options.availableColors.length} colors
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                {options.availableColors.map((color) => (
                  <Tooltip key={color} title={color}>
                    <Box
                      sx={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        bgcolor: color,
                        border: "2px solid",
                        borderColor: "divider",
                        cursor: "default",
                      }}
                    />
                  </Tooltip>
                ))}
              </Box>
            </Box>

            {/* pro-number-range */}
            <Box>
              <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                pro-number-range
              </Typography>
              {options.favoriteNumberRange ? (
                <Chip
                  size="small"
                  label={`max ${options.favoriteNumberRange.max}`}
                  color={
                    options.favoriteNumberRange.max === 100
                      ? "success"
                      : options.favoriteNumberRange.max === 50
                        ? "warning"
                        : "default"
                  }
                  variant="outlined"
                />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  n/a (number disabled)
                </Typography>
              )}
            </Box>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
