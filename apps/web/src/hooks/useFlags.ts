import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../lib/api';
import type { Flag, FlagType, ApiKey } from '../types/flag';

// ── Flags ────────────────────────────────────────────────────────────────────

export function useFlags(type?: FlagType) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['flags', type],
    queryFn: () => api<Flag[]>(`/flags${type ? `?type=${type}` : ''}`),
  });
}

export function useFlag(key: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['flags', key],
    queryFn: () => api<Flag>(`/flags/${key}`),
    enabled: !!key,
  });
}

export function useCreateFlag() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<Flag, 'id' | 'createdAt' | 'updatedAt'>) =>
      api<Flag>('/flags', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['flags'] }),
  });
}

export function useUpdateFlag(key: string) {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Pick<Flag, 'name' | 'description' | 'rules'>>) =>
      api<Flag>(`/flags/${key}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['flags'] });
      qc.invalidateQueries({ queryKey: ['flags', key] });
    },
  });
}

export function useDeleteFlag() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => api<void>(`/flags/${key}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['flags'] }),
  });
}

export function useEvaluateFlag(key: string) {
  const api = useApiClient();
  return useMutation({
    mutationFn: (context: { userId?: string; attributes?: Record<string, string> }) =>
      api<{ key: string; result: boolean }>(`/flags/${key}/evaluate`, {
        method: 'POST',
        body: JSON.stringify({ context }),
      }),
  });
}

// ── API Keys ─────────────────────────────────────────────────────────────────

export function useApiKeys() {
  const api = useApiClient();
  return useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api<ApiKey[]>('/api-keys'),
  });
}

export function useCreateApiKey() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api<{ key: string } & ApiKey>('/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });
}

export function useDeleteApiKey() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });
}
