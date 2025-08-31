import { precacheAndRoute } from 'workbox-precaching';

self.skipWaiting();
self.addEventListener('activate', () => self.clients.claim());

// placeholder for injectManifest — workbox will replace self.__WB_MANIFEST
precacheAndRoute(self.__WB_MANIFEST || []);
