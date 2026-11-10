import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AgendaEvent, OutboxEntry, User } from './types';

interface Schema extends DBSchema {
  events: { key: string; value: AgendaEvent };
  outbox: { key: string; value: OutboxEntry };
  meta: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

export const getDb = (): Promise<IDBPDatabase<Schema>> =>
  (dbPromise ??= openDB<Schema>('familyagenda', 1, {
    upgrade(db) {
      db.createObjectStore('events', { keyPath: 'id' });
      db.createObjectStore('outbox', { keyPath: 'id' });
      db.createObjectStore('meta');
    },
  }));

let lastVersion = 0;
const nextVersion = () => (lastVersion = Math.max(Date.now(), lastVersion + 1));

/** Écrit l'évènement localement et le met en file d'attente pour la synchro. */
export async function putEvent(ev: AgendaEvent): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['events', 'outbox'], 'readwrite');
  if (ev.deleted) tx.objectStore('events').delete(ev.id);
  else tx.objectStore('events').put(ev);
  tx.objectStore('outbox').put({ ...ev, v: nextVersion() });
  await tx.done;
}

export async function getAllEvents(): Promise<AgendaEvent[]> {
  return (await getDb()).getAll('events');
}

export async function getOutbox(): Promise<OutboxEntry[]> {
  return (await getDb()).getAll('outbox');
}

export async function countOutbox(): Promise<number> {
  return (await getDb()).count('outbox');
}

export async function getCursor(): Promise<number> {
  return ((await (await getDb()).get('meta', 'cursor')) as number | undefined) ?? 0;
}

export async function getUsers(): Promise<User[]> {
  return ((await (await getDb()).get('meta', 'users')) as User[] | undefined) ?? [];
}

export async function clearAll(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['events', 'outbox', 'meta'], 'readwrite');
  await Promise.all([
    tx.objectStore('events').clear(),
    tx.objectStore('outbox').clear(),
    tx.objectStore('meta').clear(),
  ]);
  await tx.done;
}
