import { useParams, useNavigate } from "react-router";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import RefreshIcon from "@mui/icons-material/Refresh";
import PersonIcon from "@mui/icons-material/Person";
import { useUser, useUserOptions } from "../../hooks/useUser.ts";
import PreferencesForm from "./PreferencesForm.tsx";
import OptionsPanel from "./OptionsPanel.tsx";

const PLAN_COLOR: Record<string, "default" | "primary" | "success"> = {
  free: "default",
  basic: "primary",
  pro: "success",
};

export default function ProfilePage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const userQuery = useUser(id);
  const optionsQuery = useUserOptions(id);

  function handleRefresh() {
    void userQuery.refetch();
    void optionsQuery.refetch();
  }

  const isLoading = userQuery.isLoading || optionsQuery.isLoading;
  const user = userQuery.data;
  const options = optionsQuery.data;

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "grey.50" }}>
      {/* Top bar */}
      <Box sx={{ bgcolor: "white", borderBottom: "1px solid", borderColor: "divider", px: 2, py: 1.5 }}>
        <Container maxWidth="lg">
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Stack direction="row" alignItems="center" spacing={1}>
              <IconButton size="small" onClick={() => void navigate("/")}>
                <ArrowBackIcon fontSize="small" />
              </IconButton>
              <PersonIcon color="action" />
              {user ? (
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography variant="h6" fontWeight={700}>
                    {user.username}
                  </Typography>
                  <Chip
                    label={user.plan}
                    size="small"
                    color={PLAN_COLOR[user.plan]}
                    variant={user.plan === "pro" ? "filled" : "outlined"}
                  />
                </Stack>
              ) : (
                <Typography variant="h6" color="text.secondary">
                  Loading…
                </Typography>
              )}
            </Stack>

            <Tooltip title="Re-fetch user and flag state">
              <span>
                <Button
                  size="small"
                  startIcon={
                    userQuery.isFetching || optionsQuery.isFetching ? (
                      <CircularProgress size={14} />
                    ) : (
                      <RefreshIcon />
                    )
                  }
                  onClick={handleRefresh}
                  disabled={userQuery.isFetching || optionsQuery.isFetching}
                >
                  Refresh
                </Button>
              </span>
            </Tooltip>
          </Stack>

          {/* User ID — useful for re-accessing the profile */}
          {user && (
            <Typography variant="caption" color="text.disabled" sx={{ pl: "36px" }}>
              ID: {user.id}
            </Typography>
          )}
        </Container>
      </Box>

      {/* Body */}
      <Container maxWidth="lg" sx={{ py: 4 }}>
        {isLoading && (
          <Box display="flex" justifyContent="center" py={8}>
            <CircularProgress />
          </Box>
        )}

        {userQuery.isError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {userQuery.error.message}
          </Alert>
        )}

        {user && options && (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1fr 340px" },
              gap: 3,
              alignItems: "start",
            }}
          >
            <PreferencesForm user={user} options={options} />
            <OptionsPanel
              options={options}
              isLoading={optionsQuery.isFetching && !options}
              error={optionsQuery.error}
            />
          </Box>
        )}
      </Container>
    </Box>
  );
}
