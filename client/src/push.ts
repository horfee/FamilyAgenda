import { api } from './api';

export type PushState = 'unsupported' | 'denied' | 'off' | 'on';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const bufferToBase64Url = (buf: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/**
 * Un abonnement est lié à la clé VAPID avec laquelle il a été créé. Si le serveur a d'autres clés
 * (nouveau conteneur, volume perdu…), le service push répond 403 : on abandonne l'ancien abonnement
 * et on en crée un nouveau avec la clé actuelle.
 */
async function subscribeWithCurrentKey(token: string, reg: ServiceWorkerRegistration): Promise<PushSubscription> {
  const { publicKey } = await api<{ publicKey: string }>('/api/push/key', { token });
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    const current = existing.options.applicationServerKey;
    if (current && bufferToBase64Url(current) === publicKey) return existing;
    await api('/api/push/unsubscribe', { token, body: { endpoint: existing.endpoint } }).catch(() => undefined);
    await existing.unsubscribe();
  }
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
}

export async function getPushState(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}

export async function enablePush(token: string): Promise<PushState> {
  if (!supported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  const reg = await navigator.serviceWorker.ready;
  const sub = await subscribeWithCurrentKey(token, reg);
  await api('/api/push/subscribe', { token, body: sub.toJSON() });
  return 'on';
}

export async function disablePush(token: string): Promise<PushState> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api('/api/push/unsubscribe', { token, body: { endpoint: sub.endpoint } }).catch(() => undefined);
    await sub.unsubscribe();
  }
  return 'off';
}

/**
 * Ré-enregistre l'abonnement existant auprès du serveur (nouvel utilisateur / base réinitialisée)
 * et le recrée si le serveur a changé de clés VAPID.
 */
export async function refreshSubscription(token: string): Promise<void> {
  if (!supported() || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!(await reg.pushManager.getSubscription())) return;
    const sub = await subscribeWithCurrentKey(token, reg);
    await api('/api/push/subscribe', { token, body: sub.toJSON() });
  } catch {
    /* hors ligne, ou réabonnement refusé sans geste de l'utilisateur : le bouton « Activer » reste disponible */
  }
}
