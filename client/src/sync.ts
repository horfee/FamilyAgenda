import { api, ApiError } from './api';
import { getDb, getCursor, getOutbox } from './localdb';
import type { AgendaEvent, OutboxEntry, User } from './types';

interface SyncResponse {
  events: Array<AgendaEvent & { rev: number }>;
  cursor: number;
  users: User[];
  rejected: Array<string | null>;
}

export type SyncResult = 'ok' | 'offline' | 'unauthorized';

let running: Promise<SyncResult> | null = null;

/**
 * Envoie les modifications locales puis récupère celles du serveur.
 * Les appels concurrents partagent la même exécution.
 */
export function syncNow(token: string): Promise<SyncResult> {
  return (running ??= doSync(token).finally(() => {
    running = null;
  }));
}

async function doSync(token: string): Promise<SyncResult> {
  try {
    const outbox = await getOutbox();
    const cursor = await getCursor();
    const res = await api<SyncResponse>('/api/sync', {
      token,
      body: { cursor, mutations: outbox.map(({ v: _v, ...ev }) => ev) },
    });

    const db = await getDb();
    const tx = db.transaction(['events', 'outbox', 'meta'], 'readwrite');
    const events = tx.objectStore('events');
    const out = tx.objectStore('outbox');

    // Retire de la file ce qui a été envoyé, sauf si modifié localement entre-temps.
    const sent = new Map<string, OutboxEntry>(outbox.map((o) => [o.id, o]));
    for (const [id, o] of sent) {
      const current = await out.get(id);
      if (current && current.v === o.v) await out.delete(id);
    }

    // Applique les changements serveur, sauf pour les évènements ayant une modif locale en attente.
    for (const ev of res.events) {
      if (await out.get(ev.id)) continue;
      if (ev.deleted) await events.delete(ev.id);
      else {
        const { rev: _rev, ...clean } = ev;
        await events.put(clean);
      }
    }

    const meta = tx.objectStore('meta');
    // Mutation rejetée : on repart de zéro au prochain tour pour réaligner la copie locale.
    await meta.put(res.rejected.length > 0 ? 0 : res.cursor, 'cursor');
    await meta.put(res.users, 'users');
    await tx.done;
    return 'ok';
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401) return 'unauthorized';
      if (err.status === 0) return 'offline';
    }
    console.error('[sync]', err);
    return 'offline';
  }
}
