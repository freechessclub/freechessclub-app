const workboxBuild = require("workbox-build");
const path = require('path');

workboxBuild.injectManifest({
  swSrc: "./www/service-worker.js",
  swDest: "./www/service-worker.js",
  globDirectory: path.resolve(process.cwd(), 'www'),
  globPatterns: [
    "play.html",
    "assets/**/*.{html,js,wasm,css,png,jpg,svg,json,bin,tsv,ico}",
  ],
});
