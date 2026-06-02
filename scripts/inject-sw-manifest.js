const workboxBuild = require("workbox-build");
const path = require('path');

workboxBuild.injectManifest({
  swSrc: "./www/service-worker.js",
  swDest: "./www/service-worker.js",
  globDirectory: 'www',
  globPatterns: [
    "play.html",
    "assets/**/*.{html,js,wasm,css,png,jpg,svg,json,bin,tsv,ico}",
  ],
}).then(({count, size, warnings}) => {
  if (warnings.length > 0) {
    console.warn(
      'Warnings encountered while injecting the manifest:',
      warnings.join('\n')
    );
  }
});
