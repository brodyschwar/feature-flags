import { useAuth } from '@clerk/clerk-react';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export function useApiClient() {
  const { getToken } = useAuth();

  return async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await getToken();
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Request failed: ${res.status}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json();
  };
}
