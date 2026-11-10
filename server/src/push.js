import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import webpush from 'web-push';
import { db, DATA_DIR } from './db.js';

function loadVapid() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const file = join(DATA_DIR, 'vapid.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const keys = webpush.generateVAPIDKeys();
  writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
  return keys;
}

const vapid = loadVapid();
const subject = process.env.VAPID_SUBJECT || 'mailto:admin@familyagenda.local';
webpush.setVapidDetails(subject, vapid.publicKey, vapid.privateKey);

// Apple (iPhone) rejette en « BadJwtToken » un sujet VAPID qui n'est pas une vraie adresse de contact.
if (!process.env.VAPID_SUBJECT || /(^|[@.\/])(local|localhost|example\.\w+|invalid|test)(\W|$)/i.test(subject)) {
  console.warn(
    `[push] VAPID_SUBJECT="${subject}" n'est pas une adresse réelle : Apple risque de refuser les notifications ` +
      '(BadJwtToken). Définissez VAPID_SUBJECT=mailto:vous@votredomaine.fr',
  );
}

export const vapidPublicKey = vapid.publicKey;

export function saveSubscription(userId, sub) {
  db.prepare(
    `INSERT INTO push_subs (endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id,
       p256dh = excluded.p256dh, auth = excluded.auth`,
  ).run(sub.endpoint, userId, sub.keys.p256dh, sub.keys.auth);
}

export function removeSubscription(endpoint) {
  db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint);
}

/** Envoie un payload à tous les appareils des utilisateurs donnés. */
export async function notifyUsers(userIds, payload) {
  if (userIds.length === 0) return;
  const marks = userIds.map(() => '?').join(',');
  const subs = db.prepare(`SELECT * FROM push_subs WHERE user_id IN (${marks})`).all(...userIds);
  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) removeSubscription(s.endpoint);
        else {
          let host = '?';
          try {
            host = new URL(s.endpoint).host;
          } catch {
            /* endpoint illisible */
          }
          const detail = String(err.body ?? '').slice(0, 300);
          console.error(`[push] échec envoi (${host}):`, err.statusCode || err.message, detail);
          if (detail.includes('BadJwtToken')) {
            console.error(
              `[push] BadJwtToken : vérifiez VAPID_SUBJECT (actuel : "${subject}") et l'horloge du conteneur ` +
                `(heure serveur : ${new Date().toISOString()}, comparez avec l'heure réelle).`,
            );
          }
        }
      }
    }),
  );
}
