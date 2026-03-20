import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Stack,
  TextField,
  Typography,
  Alert,
} from "@mui/material";
import FlagIcon from "@mui/icons-material/Flag";
import { useRegister } from "../../hooks/useUser.ts";

export default function RegisterPage() {
  const navigate = useNavigate();
  const register = useRegister();

  const [username, setUsername] = useState("");
  const [lookupId, setLookupId] = useState("");
  const [usernameError, setUsernameError] = useState("");

  function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setUsernameError("");
    if (!username.trim()) {
      setUsernameError("Username is required");
      return;
    }
    register.mutate(username.trim(), {
      onSuccess: (user) => void navigate(`/users/${user.id}`),
      onError: (err) => setUsernameError(err.message),
    });
  }

  function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    if (lookupId.trim()) void navigate(`/users/${lookupId.trim()}`);
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "grey.50",
        p: 2,
      }}
    >
      <Card sx={{ width: "100%", maxWidth: 440 }}>
        <CardContent sx={{ p: 4 }}>
          <Stack alignItems="center" spacing={1} mb={4}>
            <FlagIcon color="primary" sx={{ fontSize: 40 }} />
            <Typography variant="h5" fontWeight={700}>
              Feature Flags Demo
            </Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              A user-preferences app where every interesting behaviour is controlled by a feature flag.
            </Typography>
          </Stack>

          {/* Register */}
          <Typography variant="subtitle1" fontWeight={600} mb={1}>
            Register
          </Typography>
          <Box component="form" onSubmit={handleRegister}>
            <Stack spacing={2}>
              <TextField
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                error={!!usernameError}
                helperText={usernameError || "Letters, numbers, underscores, and hyphens only"}
                fullWidth
                autoFocus
                disabled={register.isPending}
                inputProps={{ maxLength: 50 }}
              />
              {register.isError && !usernameError && (
                <Alert severity="error">{register.error.message}</Alert>
              )}
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={register.isPending}
                fullWidth
              >
                {register.isPending ? <CircularProgress size={22} /> : "Get Started"}
              </Button>
            </Stack>
          </Box>

          <Divider sx={{ my: 3 }}>
            <Typography variant="caption" color="text.secondary">
              already registered
            </Typography>
          </Divider>

          {/* Look up existing user */}
          <Box component="form" onSubmit={handleLookup}>
            <Stack spacing={2}>
              <TextField
                label="User ID"
                value={lookupId}
                onChange={(e) => setLookupId(e.target.value)}
                helperText="Paste the ID from a previous session"
                fullWidth
                size="small"
              />
              <Button type="submit" variant="outlined" fullWidth disabled={!lookupId.trim()}>
                Go to Profile
              </Button>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
