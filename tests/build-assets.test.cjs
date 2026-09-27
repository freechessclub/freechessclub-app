// Run after npm run bundle: verify the emitted app, not only the source config.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assets = require('../scripts/external-assets.cjs');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'www/play.html'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'www/service-worker.js'), 'utf8');

test('rendered CDN assets match the cache manifest and their integrity metadata', () => {
  const cachedUrls = new Set(assets.precache.map(asset => asset.url));
  assert.equal(cachedUrls.size, assets.precache.length);
  for (const asset of [...assets.styles, ...assets.scripts]) {
    assert.ok(html.includes(asset.url), `Missing HTML asset: ${asset.url}`);
    assert.ok(cachedUrls.has(asset.url), `Uncached asset: ${asset.url}`);
    assert.ok(worker.includes(asset.url), `Missing service-worker asset: ${asset.url}`);
    if (asset.integrity)
      assert.ok(html.includes(asset.integrity), `Missing integrity: ${asset.url}`);
  }
  assert.ok(!html.includes('<%'), 'Unrendered template expression');
  assert.ok(!worker.includes('__EXTERNAL_PRECACHE__'), 'Unreplaced build constant');
  assert.ok(!worker.includes('__WB_MANIFEST'), 'Precache manifest was not injected');
  assert.ok(!/https:\/\/[^"\s]*\/d3@/.test(html + worker), 'D3 must be bundled locally');
});

test('Maia uses the installed, pinned ONNX version and passes its URL to the worker', () => {
  const version = require('../node_modules/onnxruntime-web/package.json').version;
  assert.equal(require('../package.json').dependencies['onnxruntime-web'], version);
  assert.equal(assets.onnxDistUrl, `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`);
  const chunks = ['www', 'www/assets/js'].flatMap(directory =>
    fs.readdirSync(path.join(root, directory)).filter(file => file.endsWith('.js'))
      .map(file => fs.readFileSync(path.join(root, directory, file), 'utf8')));
  assert.ok(chunks.some(code => code.includes(assets.onnxDistUrl) && code.includes('onnxDistUrl:')));
  assert.ok(chunks.some(code => code.includes('.onnxDistUrl') && code.includes('ORT.env.wasm.wasmPaths')));
});
