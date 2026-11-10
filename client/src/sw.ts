import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
};

// --- Cache hors ligne de l'application (shell) -----------------------------
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

self.skipWaiting();
clientsClaim();

// --- Notifications push -----------------------------------------------------
interface PushPayload {
  title: string;
  body?: string;
  tag?: string;
  eventId?: string;
}

self.addEventListener('push', (event) => {
  let payload: PushPayload = { title: 'Familly Agenda' };
  try {
    payload = { ...payload, ...(event.data?.json() as PushPayload) };
  } catch {
    const text = event.data?.text();
    if (text) payload.body = text;
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { eventId: payload.eventId },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const eventId: string | undefined = event.notification.data?.eventId;
  // App fermée : l'identifiant passe par l'adresse. App ouverte : par message.
  const url = eventId ? `/?event=${encodeURIComponent(eventId)}` : '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows[0];
      if (existing) {
        try {
          await existing.focus();
        } catch {
          /* iOS peut refuser focus() : le message suffit */
        }
        existing.postMessage({ type: 'open-event', eventId });
      } else {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
