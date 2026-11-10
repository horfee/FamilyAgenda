import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || join(here, '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'familyagenda.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    color         TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id          TEXT PRIMARY KEY,
    rev         INTEGER NOT NULL,
    owner_id    TEXT NOT NULL,
    title       TEXT NOT NULL,
    location    TEXT NOT NULL DEFAULT '',
    notes       TEXT NOT NULL DEFAULT '',
    all_day     INTEGER NOT NULL DEFAULT 0,
    starts_at   INTEGER NOT NULL,
    ends_at     INTEGER NOT NULL,
    attendees   TEXT NOT NULL DEFAULT '[]',
    reminders   TEXT NOT NULL DEFAULT '[]',
    color       TEXT NOT NULL DEFAULT '',
    deleted     INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_rev ON events(rev);
  CREATE INDEX IF NOT EXISTS idx_events_start ON events(starts_at);

  CREATE TABLE IF NOT EXISTS push_subs (
    endpoint TEXT PRIMARY KEY,
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    p256dh   TEXT NOT NULL,
    auth     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reminders_sent (
    event_id  TEXT NOT NULL,
    minutes   INTEGER NOT NULL,
    starts_at INTEGER NOT NULL,
    PRIMARY KEY (event_id, minutes, starts_at)
  );
`);

// Migration des bases créées avant l'ajout de la couleur.
if (!db.prepare('PRAGMA table_info(events)').all().some((c) => c.name === 'color')) {
  db.exec("ALTER TABLE events ADD COLUMN color TEXT NOT NULL DEFAULT ''");
}

/** Exécute fn dans une transaction. */
export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function rowToEvent(r) {
  return {
    id: r.id,
    rev: r.rev,
    ownerId: r.owner_id,
    title: r.title,
    location: r.location,
    notes: r.notes,
    allDay: !!r.all_day,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    attendees: JSON.parse(r.attendees),
    reminders: JSON.parse(r.reminders),
    color: r.color,
    deleted: !!r.deleted,
    updatedAt: r.updated_at,
  };
}

const selectChanges = db.prepare('SELECT * FROM events WHERE rev > ? ORDER BY rev ASC');
const selectMaxRev = db.prepare('SELECT COALESCE(MAX(rev), 0) AS rev FROM events');
const selectOne = db.prepare('SELECT * FROM events WHERE id = ?');
const upsert = db.prepare(`
  INSERT INTO events (id, rev, owner_id, title, location, notes, all_day,
                      starts_at, ends_at, attendees, reminders, color, deleted, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    rev = excluded.rev, title = excluded.title,
    location = excluded.location, notes = excluded.notes, all_day = excluded.all_day,
    starts_at = excluded.starts_at, ends_at = excluded.ends_at,
    attendees = excluded.attendees, reminders = excluded.reminders, color = excluded.color,
    deleted = excluded.deleted, updated_at = excluded.updated_at
`);

export function getChangesSince(rev) {
  return {
    events: selectChanges.all(rev).map(rowToEvent),
    cursor: selectMaxRev.get().rev,
  };
}

export function getEvent(id) {
  const r = selectOne.get(id);
  return r ? rowToEvent(r) : null;
}

/** Enregistre un évènement (déjà validé). Le propriétaire d'origine est conservé. */
export function saveEvent(e, userId) {
  const existing = selectOne.get(e.id);
  const rev = selectMaxRev.get().rev + 1;
  upsert.run(
    e.id,
    rev,
    existing ? existing.owner_id : userId,
    e.title,
    e.location,
    e.notes,
    e.allDay ? 1 : 0,
    e.startsAt,
    e.endsAt,
    JSON.stringify(e.attendees),
    JSON.stringify(e.reminders),
    e.color,
    e.deleted ? 1 : 0,
    Date.now(),
  );
  return getEvent(e.id);
}
