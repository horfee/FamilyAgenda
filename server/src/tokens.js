import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { db } from './db.js';

const PREFIX = 'fa_';
const hash = (token) => createHash('sha256').update(token).digest('hex');

const view = (r) => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  expiresAt: r.expires_at, // null = sans expiration
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
});

/** Valide un nom et une date d'expiration (ms, ou null/absente = sans expiration). */
function validate({ name, expiresAt }, { partial }) {
  const out = {};
  if (!partial || name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 60) {
      return { error: 'Nom invalide (1 à 60 caractères)' };
    }
    out.name = name.trim();
  }
  if (expiresAt !== undefined) {
    if (expiresAt !== null && (!Number.isInteger(expiresAt) || expiresAt <= Date.now())) {
      return { error: "Date d'expiration invalide (doit être dans le futur)" };
    }
    out.expiresAt = expiresAt;
  }
  return { value: out };
}

export function listTokens(userId) {
  return db
    .prepare('SELECT * FROM access_tokens WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId)
    .map(view);
}

/** Crée un jeton ; la valeur en clair n'est renvoyée qu'ici (seul son hash est conservé). */
export function createToken(userId, body) {
  const v = validate(body ?? {}, { partial: false });
  if (v.error) return { error: v.error, status: 400 };
  const token = PREFIX + randomBytes(32).toString('base64url');
  const row = {
    id: randomUUID(),
    user_id: userId,
    name: v.value.name,
    token_hash: hash(token),
    prefix: token.slice(0, PREFIX.length + 6),
    expires_at: v.value.expiresAt ?? null,
    created_at: Date.now(),
    last_used_at: null,
  };
  db.prepare(
    `INSERT INTO access_tokens (id, user_id, name, token_hash, prefix, expires_at, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.user_id, row.name, row.token_hash, row.prefix, row.expires_at, row.created_at, row.last_used_at);
  return { token, item: view(row) };
}

/** Modifie le nom et/ou l'expiration (null = sans expiration). */
export function updateToken(userId, id, body) {
  const existing = db.prepare('SELECT * FROM access_tokens WHERE id = ? AND user_id = ?').get(id, userId);
  if (!existing) return { error: 'Jeton introuvable', status: 404 };
  const v = validate(body ?? {}, { partial: true });
  if (v.error) return { error: v.error, status: 400 };
  const name = v.value.name ?? existing.name;
  const expiresAt = v.value.expiresAt !== undefined ? v.value.expiresAt : existing.expires_at;
  db.prepare('UPDATE access_tokens SET name = ?, expires_at = ? WHERE id = ?').run(name, expiresAt, id);
  return { item: view({ ...existing, name, expires_at: expiresAt }) };
}

export function deleteToken(userId, id) {
  const r = db.prepare('DELETE FROM access_tokens WHERE id = ? AND user_id = ?').run(id, userId);
  return r.changes ? { ok: true } : { error: 'Jeton introuvable', status: 404 };
}

/** Middleware Express : authentifie par jeton d'accès (Bearer fa_…), utilisé par le serveur MCP. */
export function requireAccessToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token.startsWith(PREFIX)) return res.status(401).json({ error: 'Non authentifié' });
  const row = db
    .prepare(
      `SELECT t.id AS token_id, t.expires_at, u.id, u.name, u.color
       FROM access_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?`,
    )
    .get(hash(token));
  if (!row) return res.status(401).json({ error: 'Jeton invalide' });
  if (row.expires_at !== null && row.expires_at <= Date.now()) {
    return res.status(401).json({ error: 'Jeton expiré' });
  }
  db.prepare('UPDATE access_tokens SET last_used_at = ? WHERE id = ?').run(Date.now(), row.token_id);
  req.user = { id: row.id, name: row.name, color: row.color };
  next();
}
