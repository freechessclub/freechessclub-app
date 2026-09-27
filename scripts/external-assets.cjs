// Build-time source of truth for CDN assets. npm-backed URLs and integrity hashes
// come from the installed, lockfile-controlled packages used by this build.
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');

function packageDirectory(name) {
  return path.join(__dirname, '..', 'node_modules', name);
}

function distributionUrl(name) {
  const { version } = JSON.parse(readFileSync(path.join(packageDirectory(name), 'package.json'), 'utf8'));
  return `https://cdn.jsdelivr.net/npm/${name}@${version}/dist/`;
}

function asset(name, file) {
  const bytes = readFileSync(path.join(packageDirectory(name), 'dist', file));
  return {
    url: distributionUrl(name) + file,
    integrity: `sha384-${createHash('sha384').update(bytes).digest('base64')}`,
  };
}

const fontAwesome = 'https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@7.2.0/';
const styles = [
  asset('bootstrap', 'css/bootstrap.min.css'),
  ...['fontawesome', 'solid', 'regular'].map(name => ({ url: `${fontAwesome}css/${name}.min.css` })),
];
const fontsStylesheet = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Math&family=Noto+Sans+Symbols+2&display=swap';
const scripts = [
  asset('jquery', 'jquery.slim.min.js'),
  asset('@popperjs/core', 'umd/popper.min.js'),
  asset('bootstrap', 'js/bootstrap.min.js'),
];
const precache = [
  ...styles.map(asset => asset.url),
  fontsStylesheet,
  ...scripts.map(asset => asset.url),
  `${fontAwesome}webfonts/fa-solid-900.woff2`,
  `${fontAwesome}webfonts/fa-regular-400.woff2`,
  'https://fonts.gstatic.com/s/notosanssymbols2/v24/I_uyMoGduATTei9eI8daxVHDyfisHr71-vrgfE71.woff2',
  'https://fonts.gstatic.com/s/notosansmath/v15/7Aump_cpkSecTWaHRlH2hyV5UEl981w.woff2',
].map(url => ({ url, revision: '1' }));

module.exports = { styles, scripts, fontsStylesheet, precache, onnxDistUrl: distributionUrl('onnxruntime-web') };
