import { api, clearToken, getToken } from './api.js';

export async function loadSession() {
  if (!getToken()) return null;
  try {
    const { user } = await api('/api/auth/me');
    return user;
  } catch {
    clearToken();
    return null;
  }
}

export function logoutSession() {
  clearToken();
  return api('/api/auth/logout', { method: 'POST' }).catch(() => {});
}
