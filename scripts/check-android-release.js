const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const apk = process.argv[2] || 'android/app/build/outputs/apk/release/app-release.apk';
const localProperties = fs.existsSync('android/local.properties')
  ? fs.readFileSync('android/local.properties', 'utf8') : '';
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  || localProperties.match(/^sdk.dir=(.+)$/m)?.[1].trim();
if (!sdk) throw new Error('Set ANDROID_HOME to the Android SDK directory.');
const buildTools = path.join(sdk, 'build-tools');
const versions = fs.readdirSync(buildTools).sort((a, b) => b.localeCompare(a, undefined, {numeric: true}));
const aapt = versions.map(version => path.join(buildTools, version, process.platform === 'win32' ? 'aapt2.exe' : 'aapt2'))
  .find(file => fs.existsSync(file));
if (!aapt) throw new Error('Android SDK build-tools/aapt2 is required.');
const resources = execFileSync(aapt, ['dump', 'resources', apk], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
if (!/^\s*resource 0x[0-9a-f]+ drawable\/ic_fcc_notification\s*$/m.test(resources)) {
  throw new Error('Release APK is missing ic_fcc_notification: notifications will use a fallback icon and the foreground service cannot post its notification.');
}
console.log('Release APK retains the notification icon used by both native plugins.');
