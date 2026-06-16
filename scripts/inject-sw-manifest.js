const workboxBuild = require("workbox-build");
const path = require('path');
const fs = require('fs');

const outputDir = 'www';

function cleanupStaleHashedBundles() {
  const jsDir = path.join(outputDir, 'assets/js');
  if(!fs.existsSync(jsDir))
    return;

  const referencedBundles = new Set();
  for(const file of fs.readdirSync(outputDir)) {
    if(!file.endsWith('.html'))
      continue;

    const html = fs.readFileSync(path.join(outputDir, file), 'utf8');
    for(const match of html.matchAll(/assets\/js\/bundle\.[^"']+\.js/g))
      referencedBundles.add(path.basename(match[0]));
  }

  for(const file of fs.readdirSync(jsDir)) {
    const bundleMatch = file.match(/^(bundle\.[a-f0-9]+\.js)(?:\.LICENSE\.txt)?$/);
    if(bundleMatch && !referencedBundles.has(bundleMatch[1]))
      fs.rmSync(path.join(jsDir, file), { force: true });
  }
}

cleanupStaleHashedBundles();

workboxBuild.injectManifest({
  swSrc: "./www/service-worker.js",
  swDest: "./www/service-worker.js",
  globDirectory: outputDir,
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
