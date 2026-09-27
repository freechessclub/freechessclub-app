import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate } from 'workbox-strategies';

// Injected from scripts/external-assets.cjs, shared with the HTML template.
const externals = __EXTERNAL_PRECACHE__;

const urlParams = new URLSearchParams(self.location.search);
if(urlParams.get('env') === 'app') // Capacitor or Electron app, don't cache static assets
  precacheAndRoute(externals);
else 
  precacheAndRoute([...self.__WB_MANIFEST, ...externals]); // __WB_MANIFEST is injected by inject-manifest.js

registerRoute(
  ({ url }) => url.origin.endsWith('.jsdelivr.net'),
      new StaleWhileRevalidate({ cacheName: 'stalewhile-cache' })
);

cleanupOutdatedCaches();

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim()); 
});
