import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import { db, DATA_DIR } from './db.js';

function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = join(DATA_DIR, 'jwt-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8');
  const secret = randomBytes(48).toString('hex');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}
const SECRET = loadSecret();

const COLORS = ['#3b82d4', '#e5484d', '#30a46c', '#f5a524', '#7c5cd8', '#0ea5a4', '#d6409f', '#8b6b4a'];

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

const publicUser = (u) => ({ id: u.id, name: u.name, color: u.color });

export function listUsers() {
  return db.prepare('SELECT id, name, color FROM users ORDER BY name').all().map(publicUser);
}

const signToken = (user) => jwt.sign({ sub: user.id }, SECRET, { expiresIn: '60d' });

export function register(name, password) {
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 40) {
    return { error: 'Nom invalide (2 à 40 caractères)', status: 400 };
  }
  if (typeof password !== 'string' || password.length < 6) {
    return { error: 'Mot de passe trop court (6 caractères minimum)', status: 400 };
  }
  const taken = db.prepare('SELECT 1 FROM users WHERE name = ?').get(name.trim());
  if (taken) return { error: 'Ce nom est déjà utilisé', status: 409 };

  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const user = {
    id: randomUUID(),
    name: name.trim(),
    color: COLORS[count % COLORS.length],
  };
  db.prepare('INSERT INTO users (id, name, password_hash, color, created_at) VALUES (?, ?, ?, ?, ?)').run(
    user.id,
    user.name,
    hashPassword(password),
    user.color,
    Date.now(),
  );
  return { token: signToken(user), user };
}

export function login(name, password) {
  const row = db.prepare('SELECT * FROM users WHERE name = ?').get(String(name ?? '').trim());
  if (!row || !verifyPassword(String(password ?? ''), row.password_hash)) {
    return { error: 'Identifiants incorrects', status: 401 };
  }
  return { token: signToken(row), user: publicUser(row) };
}

/** Middleware Express : exige un jeton Bearer valide. */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  try {
    const { sub } = jwt.verify(token, SECRET);
    const row = db.prepare('SELECT id, name, color FROM users WHERE id = ?').get(sub);
    if (!row) return res.status(401).json({ error: 'Utilisateur inconnu' });
    req.user = publicUser(row);
    next();
  } catch {
    res.status(401).json({ error: 'Jeton invalide' });
  }
}
