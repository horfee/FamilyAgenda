import { useCallback, useEffect, useRef, useState } from 'react';
import { putEvent, getAllEvents, getUsers, countOutbox } from './localdb';
import { syncNow } from './sync';
import { refreshSubscription } from './push';
import type { AgendaEvent, Session, User } from './types';

const SYNC_INTERVAL_MS = 30_000;

export function useAgenda(session: Session, onUnauthorized: () => void) {
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const token = session.token;
  const unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;

  const reload = useCallback(async () => {
    const [e, u, p] = await Promise.all([getAllEvents(), getUsers(), countOutbox()]);
    setEvents(e);
    setUsers(u);
    setPending(p);
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    const result = await syncNow(token);
    setOnline(result !== 'offline');
    setSyncing(false);
    if (result === 'unauthorized') unauthorizedRef.current();
    await reload();
  }, [token, reload]);

  useEffect(() => {
    void reload().then(sync);
    void refreshSubscription(token);
    const onOnline = () => void sync();
    const onOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void sync();
    }, SYNC_INTERVAL_MS);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [reload, sync, token]);

  const save = useCallback(
    async (ev: AgendaEvent) => {
      await putEvent(ev);
      await reload();
      void sync();
    },
    [reload, sync],
  );

  const remove = useCallback((ev: AgendaEvent) => save({ ...ev, deleted: true }), [save]);

  return { events, users, pending, online, syncing, save, remove, sync };
}
