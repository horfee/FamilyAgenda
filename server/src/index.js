import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listUsers, login, register, requireAuth } from './auth.js';
import { getChangesSince, getEvent, saveEvent, transaction } from './db.js';
import { removeSubscription, saveSubscription, vapidPublicKey } from './push.js';
import { startScheduler } from './scheduler.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Valide et normalise un évènement venant du client. Retourne null si invalide. */
function sanitizeEvent(input, validUserIds) {
  if (!input || typeof input.id !== 'string' || input.id.length < 8 || input.id.length > 64) return null;
  const title = str(input.title, 200).trim();
  const startsAt = Number(input.startsAt);
  const endsAt = Number(input.endsAt);
  if (!input.deleted && !title) return null;
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt < startsAt) return null;
  return {
    id: input.id,
    title: title || '(supprimé)',
    location: str(input.location, 300),
    notes: str(input.notes, 5000),
    allDay: !!input.allDay,
    startsAt,
    endsAt,
    attendees: Array.isArray(input.attendees)
      ? [...new Set(input.attendees.filter((id) => validUserIds.has(id)))]
      : [],
    reminders: Array.isArray(input.reminders)
      ? [...new Set(input.reminders.map(Number).filter((m) => Number.isInteger(m) && m >= 0 && m <= 60 * 24 * 60))]
      : [],
    color: typeof input.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.color) ? input.color.toLowerCase() : '',
    deleted: !!input.deleted,
  };
}

// --- Auth -----------------------------------------------------------------
app.post('/api/register', (req, res) => {
  const { name, password } = req.body ?? {};
  const r = register(name, password);
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json(r);
});

app.post('/api/login', (req, res) => {
  const { name, password } = req.body ?? {};
  const r = login(name, password);
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json(r);
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.user }));
app.get('/api/users', requireAuth, (_req, res) => res.json({ users: listUsers() }));

// --- Push -----------------------------------------------------------------
app.get('/api/push/key', requireAuth, (_req, res) => res.json({ publicKey: vapidPublicKey }));

app.post('/api/push/subscribe', requireAuth, (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return res.status(400).json({ error: 'Abonnement invalide' });
  }
  saveSubscription(req.user.id, sub);
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', requireAuth, (req, res) => {
  if (req.body?.endpoint) removeSubscription(req.body.endpoint);
  res.json({ ok: true });
});

// --- Synchronisation ------------------------------------------------------
/**
 * Corps : { cursor: number, mutations: Event[] }
 * Applique les mutations hors-ligne (dernier écrit gagnant) puis renvoie tous les
 * changements depuis `cursor`. Une mutation sur un évènement dont l'utilisateur
 * n'est ni propriétaire ni participant est rejetée.
 */
app.post('/api/sync', requireAuth, (req, res) => {
  const cursor = Number.isInteger(req.body?.cursor) ? req.body.cursor : 0;
  const mutations = Array.isArray(req.body?.mutations) ? req.body.mutations.slice(0, 500) : [];
  const users = listUsers();
  const validIds = new Set(users.map((u) => u.id));
  const rejected = [];

  transaction(() => {
    for (const m of mutations) {
      const ev = sanitizeEvent(m, validIds);
      if (!ev) {
        rejected.push(m?.id ?? null);
        continue;
      }
      const existing = getEvent(ev.id);
      if (existing && existing.ownerId !== req.user.id && !existing.attendees.includes(req.user.id)) {
        rejected.push(ev.id);
        continue;
      }
      saveEvent(ev, req.user.id);
    }
  });

  const { events, cursor: newCursor } = getChangesSince(cursor);
  res.json({ events, cursor: newCursor, users, rejected });
});

// --- Client statique (production) ----------------------------------------
const dist = join(here, '..', '..', 'client', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Familly Agenda serveur sur http://localhost:${port}`);
  startScheduler();
});
