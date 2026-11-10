import type { Session } from './types';

const KEY = 'familyagenda.session';

export const getSession = (): Session | null => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
};

export const setSession = (s: Session): void => localStorage.setItem(KEY, JSON.stringify(s));
export const clearSession = (): void => localStorage.removeItem(KEY);
