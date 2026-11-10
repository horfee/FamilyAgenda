import { db, rowToEvent } from './db.js';
import { notifyUsers } from './push.js';

const TICK_MS = 20_000;
/** Un rappel manqué depuis plus longtemps que ça (serveur éteint) est ignoré. */
const MAX_LATE_MS = 10 * 60_000;

const selectCandidates = db.prepare('SELECT * FROM events WHERE deleted = 0 AND ends_at > ?');
const markSent = db.prepare('INSERT OR IGNORE INTO reminders_sent (event_id, minutes, starts_at) VALUES (?, ?, ?)');
const cleanup = db.prepare('DELETE FROM reminders_sent WHERE starts_at < ?');

function describeDelay(minutes) {
  if (minutes <= 0) return 'Maintenant';
  if (minutes < 60) return `Dans ${minutes} min`;
  if (minutes < 1440) {
    const h = minutes / 60;
    return `Dans ${Number.isInteger(h) ? h : h.toFixed(1)} h`;
  }
  const d = Math.round(minutes / 1440);
  return `Dans ${d} jour${d > 1 ? 's' : ''}`;
}

async function tick() {
  const now = Date.now();
  const rows = selectCandidates.all(now);
  for (const row of rows) {
    const ev = rowToEvent(row);
    for (const minutes of ev.reminders) {
      const fireAt = ev.startsAt - minutes * 60_000;
      if (fireAt > now || now - fireAt > MAX_LATE_MS) continue;
      // INSERT OR IGNORE : changes === 0 si déjà envoyé
      const res = markSent.run(ev.id, minutes, ev.startsAt);
      if (res.changes === 0) continue;

      const recipients = [...new Set([ev.ownerId, ...ev.attendees])];
      const parts = [describeDelay(minutes)];
      if (ev.location) parts.push(ev.location);
      notifyUsers(recipients, {
        title: ev.title,
        body: parts.join(' · '),
        eventId: ev.id,
        tag: `${ev.id}:${minutes}`,
      }).catch((e) => console.error('[scheduler] notify', e));
    }
  }
  cleanup.run(now - 24 * 3600_000);
}

export function startScheduler() {
  const run = () => tick().catch((e) => console.error('[scheduler]', e));
  run();
  return setInterval(run, TICK_MS);
}
