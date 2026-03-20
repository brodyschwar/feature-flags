import type { User, UserOptions, Preferences } from "../types/user.ts";

const API_URL = import.meta.env.VITE_DEMO_API_URL ?? "http://localhost:3002";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  registerUser: (username: string) =>
    apiFetch<{ id: string; username: string; plan: string }>("/users", {
      method: "POST",
      body: JSON.stringify({ username }),
    }),

  getUser: (id: string) => apiFetch<User>(`/users/${id}`),

  getUserOptions: (id: string) => apiFetch<UserOptions>(`/users/${id}/options`),

  updatePreferences: (id: string, prefs: Preferences) =>
    apiFetch<User>(`/users/${id}/preferences`, {
      method: "PATCH",
      body: JSON.stringify(prefs),
    }),
};
