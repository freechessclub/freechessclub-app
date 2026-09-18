const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Run the application modules with native plugins, sockets, and time controlled
// by the tests. No device, server connection, or additional test framework needed.
function loadModule(name, imports, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/js', name), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: name => {
      assert.ok(name in imports, `Unexpected dependency: ${name}`);
      return imports[name];
    },
    ...globals
  }, { filename: name });
  return exports;
}

function notificationFixture() {
  const delivered = new Map();
  const errors = [];
  const document = { hidden: true };
  let permitted = true;
  const api = loadModule('android.ts', {
    './utils': { isAndroidCapacitor: () => true, logError: (...args) => errors.push(args) },
    '@capacitor/local-notifications': { LocalNotifications: {
      checkPermissions: async () => ({ display: permitted ? 'granted' : 'denied' }),
      schedule: async ({ notifications }) => {
        // Plugin 8.3.1 opens exact-alarm settings even for immediate notifications.
        // Android blocks this activity while backgrounded, leaving schedule pending.
        for (const notification of notifications) {
          if (notification.isExactNotification !== false)
            throw new Error('Exact-alarm permission activity would be blocked');
          delivered.set(notification.id, notification);
        }
      },
      getDeliveredNotifications: async () => ({ notifications: [...delivered.values()] }),
      removeDeliveredNotifications: async ({ notifications }) => notifications.forEach(n => {
        if (n.groupSummary) {
          for (const item of delivered.values())
            if (item.group === n.group) delivered.delete(item.id);
        }
        delivered.delete(n.id);
      })
    } }
  }, { document });
  return { api, delivered, errors, document, denyPermission: () => { permitted = false; } };
}

test('background events and rebuilt group summaries work without exact-alarm access', async () => {
  const { api, delivered, errors } = notificationFixture();
  await api.showAndroidNotification('Alice', 'Hello', { kind: 'chat', user: 'Alice' }, true);
  await api.showAndroidNotification('Bob', 'Hello', { kind: 'chat', user: 'Bob' }, true);
  await api.showAndroidNotification('Game request', 'Play?', { kind: 'offers', offerId: 7 }, true);
  assert.equal(delivered.size, 4);
  const offer = [...delivered.values()].find(n => n.extra?.offerId === 7);
  assert.equal(offer.actionTypeId, 'fcc-game-request');
  assert.equal(delivered.get(2).groupSummary, true);
  await api.removeAndroidOfferNotification(7);
  assert.equal(delivered.size, 3);
  assert.ok(!delivered.has(offer.id));
  assert.equal(delivered.get(2).body, '2 new updates');
  assert.equal(errors.length, 0);
});

test('foreground, disabled, and permission-denied notifications remain suppressed', async () => {
  const f = notificationFixture();
  f.document.hidden = false;
  await f.api.showAndroidNotification('Test', 'Test', { kind: 'offers' }, true);
  f.document.hidden = true;
  await f.api.showAndroidNotification('Test', 'Test', { kind: 'offers' }, false);
  f.denyPermission();
  await f.api.showAndroidNotification('Test', 'Test', { kind: 'offers' }, true);
  assert.equal(f.delivered.size, 0);
  assert.equal(f.errors.length, 0);
});

test('removing an offer preserves the remaining alert when its summary disappears', async () => {
  const { api, delivered, errors } = notificationFixture();
  await api.showAndroidNotification('Alice', 'Hello', { kind: 'chat', user: 'Alice' }, true);
  await api.showAndroidNotification('Game request', 'Play?', { kind: 'offers', offerId: 7 }, true);
  assert.equal(delivered.size, 3);
  await api.removeAndroidOfferNotification(7);
  assert.equal(delivered.size, 1);
  assert.equal([...delivered.values()][0].extra.user, 'Alice');
  assert.equal(errors.length, 0);
});

function sessionFixture({ loggedIn = true, foregroundService = true } = {}) {
  const sockets = [];
  const messages = [];
  const timers = new Map();
  const listeners = new Map();
  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    constructor() { this.readyState = 0; sockets.push(this); }
    send() {}
    close() { this.finishClose(true); }
    finishClose(wasClean = false) { this.readyState = 3; this.onclose({ wasClean }); }
  }
  const jquery = new Proxy({}, { get: () => () => jquery });
  const document = {
    visibilityState: 'hidden',
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name)
  };
  const { Session } = loadModule('session.ts', {
    './parser': { __esModule: true, default: class {} },
    './utils': { isAndroidCapacitor: () => true, isMobile: () => true },
    './settings': { settings: { visited: true, foregroundServiceToggle: foregroundService } }
  }, {
    $: () => jquery, document, WebSocket: FakeWebSocket,
    setTimeout: (callback, delay) => { const timer = { callback, delay }; timers.set(timer, timer); return timer; },
    clearTimeout: timer => timers.delete(timer)
  });
  const session = new Session(message => messages.push(message), 'tester', 'password');
  if (loggedIn) {
    sockets[0].readyState = 1;
    session.setUser('tester');
  }
  return {
    session, sockets, messages, timers, listeners, document,
    tick() {
      assert.equal(timers.size, 1);
      const timer = timers.values().next().value;
      timers.delete(timer);
      timer.callback();
      return timer.delay;
    }
  };
}

test('socket error then close preserves background recovery and avoids a service-stop signal', () => {
  const f = sessionFixture();
  f.sockets[0].onerror();
  assert.equal(f.session.isConnected(), true);
  f.sockets[0].finishClose();
  assert.equal(f.messages.at(-1).command, 4);
  assert.equal(f.session.isReconnecting(), true);
  assert.equal(f.tick(), 1000);
  assert.equal(f.sockets.length, 2);
  assert.equal(f.session.isConnecting(), true);
  assert.ok(!f.messages.some(message => message.command === 3));
});

test('failed reconnects back off, remain recoverable, and reset after login', () => {
  const f = sessionFixture();
  f.sockets[0].finishClose();
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    assert.equal(f.tick(), delay);
    f.sockets.at(-1).onerror();
    f.sockets.at(-1).finishClose();
    assert.equal(f.messages.at(-1).command, 4);
  }
  f.tick();
  f.session.setUser('tester');
  assert.equal(f.session.isReconnecting(), false);
  f.sockets.at(-1).finishClose();
  assert.equal(f.tick(), 1000);
});

test('intentional disconnect and destruction cancel pending reconnects', () => {
  for (const operation of ['disconnect', 'destroy']) {
    const f = sessionFixture();
    f.sockets[0].finishClose();
    f.session[operation]();
    assert.equal(f.timers.size, 0);
    assert.equal(f.session.isReconnecting(), false);
  }
});

test('initial connection failure and clean server close do not retry indefinitely', () => {
  const initial = sessionFixture({ loggedIn: false });
  initial.sockets[0].onerror();
  initial.sockets[0].finishClose();
  assert.equal(initial.messages.at(-1).command, 3);
  assert.equal(initial.timers.size, 0);
  const clean = sessionFixture();
  clean.sockets[0].finishClose(true);
  assert.equal(clean.messages.at(-1).command, 3);
  assert.equal(clean.timers.size, 0);
});

test('network recovery waits for connectivity and reconnects when it returns', () => {
  const f = sessionFixture();
  f.session.setNetworkConnected(false);
  assert.equal(f.messages.at(-1).command, 4);
  assert.equal(f.timers.size, 0);
  f.session.setNetworkConnected(true);
  assert.equal(f.sockets.length, 2);
});

test('background reconnect stays deferred when the foreground service is disabled', () => {
  const f = sessionFixture({ foregroundService: false });
  f.sockets[0].finishClose();
  f.tick();
  assert.equal(f.sockets.length, 1);
  f.document.visibilityState = 'visible';
  f.listeners.get('visibilitychange')();
  assert.equal(f.sockets.length, 2);
});
