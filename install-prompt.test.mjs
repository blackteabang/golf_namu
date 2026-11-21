import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sandbox = { globalThis: {}, URL };
sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync(new URL('./install-prompt.js', import.meta.url), 'utf8'), sandbox, { filename: 'install-prompt.js' });
const GolfInstall = sandbox.GolfInstall;
const now = Date.parse('2026-11-17T00:00:00Z');
const day = 24 * 60 * 60 * 1000;

assert.equal(GolfInstall.shouldShow({ standalone: true, hasPrompt: true, now }), false);
assert.equal(GolfInstall.shouldShow({ hasPrompt: true, dismissedAt: now - 2 * day, now }), false);
assert.equal(GolfInstall.shouldShow({ hasPrompt: true, dismissedAt: now - 8 * day, now }), true);
assert.equal(GolfInstall.modeOf({ ios: true }), 'ios');
assert.equal(GolfInstall.modeOf({ inApp: true, ios: true }), 'inapp');
assert.equal(GolfInstall.copyFor('ios').detail.includes('홈 화면에 추가'), true);
assert.equal(GolfInstall.copyFor('prompt').detail, '앱처럼 바로 열기');
assert.equal(GolfInstall.isKakaoAndroid('Mozilla/5.0 (Linux; Android 14) KAKAOTALK'), true);
assert.equal(GolfInstall.isInApp('Mozilla/5.0 NAVER(inapp)'), true);
assert.equal(GolfInstall.chromeIntent('https://blackteabang.github.io/golf_namu/').includes('package=com.android.chrome'), true);
assert.equal(GolfInstall.skipsFetch('https://namugolf-2c1f8-default-rtdb.firebaseio.com/golf_namu.json'), true);
assert.equal(GolfInstall.skipsFetch('https://blackteabang.github.io/golf_namu/app.js?v=20261121a'), false);

const worker = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
assert.equal(worker.includes("var VERSION = '20261121a'"), true);
assert.equal(worker.includes("var CACHE = 'golf-namu-' + VERSION"), true);
assert.equal(worker.includes('firebase'), true);
assert.equal(worker.includes("addEventListener('fetch'"), true);

const manifest = JSON.parse(fs.readFileSync(new URL('./manifest.webmanifest', import.meta.url), 'utf8'));
assert.equal(manifest.name, '싱글벙글골프');
assert.equal(manifest.start_url, './');
assert.equal(manifest.scope, './');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.icons.some((icon) => icon.sizes === '192x192' && icon.purpose === 'any'), true);
assert.equal(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable'), true);

console.log('install prompt tests passed');
