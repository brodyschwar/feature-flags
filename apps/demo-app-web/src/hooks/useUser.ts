import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.ts";
import type { Preferences } from "../types/user.ts";

export function useUser(id: string) {
  return useQuery({
    queryKey: ["user", id],
    queryFn: () => api.getUser(id),
    enabled: !!id,
  });
}

export function useUserOptions(id: string) {
  return useQuery({
    queryKey: ["user-options", id],
    queryFn: () => api.getUserOptions(id),
    enabled: !!id,
    refetchOnWindowFocus: true,
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: (username: string) => api.registerUser(username),
  });
}

export function useUpdatePreferences(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (prefs: Preferences) => api.updatePreferences(id, prefs),
    onSuccess: (updated) => {
      queryClient.setQueryData(["user", id], updated);
      // Plan change may alter what options the flag returns
      void queryClient.invalidateQueries({ queryKey: ["user-options", id] });
    },
  });
}
