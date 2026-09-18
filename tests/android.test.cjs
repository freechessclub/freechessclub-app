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

test('Android notification settings and native tap events are bridged without JS posting', async () => {
  const calls = [];
  let listener;
  let callback;
  const api = loadModule('android.ts', {
    './utils': { isAndroidCapacitor: () => true, logError: (...args) => { throw new Error(args.join(' ')); } },
    '@capacitor/core': { registerPlugin: name => {
      assert.equal(name, 'FicsSocket');
      return {
        configureNotifications: async options => calls.push(options.enabled),
        addListener: async (event, handler) => { assert.equal(event, 'notificationAction'); listener = handler; }
      };
    } },
    '@capacitor/local-notifications': { LocalNotifications: {
      checkPermissions: async () => ({ display: 'granted' })
    } }
  });
  await api.initAndroidNotifications(true, action => { callback = action; });
  await api.initAndroidNotifications(true, () => assert.fail('Initialized twice'));
  const action = {actionId: 'tap', target: {kind: 'chat', user: 'Alice'}};
  listener(action);
  assert.equal(callback, action);
  await api.configureAndroidNotifications(false);
  assert.deepEqual(calls, [true, false]);
  assert.equal(api.showAndroidNotification, undefined);
});

test('web notification configuration never calls native APIs', async () => {
  const api = loadModule('android.ts', {
    './utils': { isAndroidCapacitor: () => false },
    '@capacitor/core': { registerPlugin: () => new Proxy({}, {get: () => assert.fail('Native API on web')}) }
  });
  await api.initAndroidNotifications(true, () => {});
  await api.configureAndroidNotifications(false);
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
    './fics-socket': { createFicsSocket: () => new FakeWebSocket() },
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

function nativeSocketFixture({ android = true } = {}) {
  const listeners = new Set();
  const queues = new Map();
  const sent = [];
  const disposed = [];
  let id;
  let closed = 0;
  const native = {
    async addListener(name, callback) {
      listeners.add(callback);
      return { remove: async () => listeners.delete(callback) };
    },
    async connect(options) { id = options.id; queues.set(id, []); },
    async send(options) { sent.push(options); },
    async close() { closed++; },
    async dispose(options) { disposed.push(options.id); },
    async drain(options) {
      const queue = queues.get(options.id) || [];
      return { events: queue.splice(0, 2), more: queue.length > 0 };
    }
  };
  class BrowserSocket { constructor(url) { this.url = url; } }
  const { createFicsSocket } = loadModule('fics-socket.ts', {
    '@capacitor/core': {
      Capacitor: { isNativePlatform: () => android, getPlatform: () => android ? 'android' : 'web' },
      registerPlugin: () => native
    }
  }, { WebSocket: BrowserSocket, Blob, Uint8Array, DOMException, btoa, atob });
  return {
    createFicsSocket, native, sent, disposed, listeners,
    get closed() { return closed; },
    async settle() { for(let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); },
    emit(events) {
      queues.get(id).push(...events);
      for(const callback of listeners) callback({ id });
    }
  };
}

test('web transport remains the browser WebSocket', () => {
  const f = nativeSocketFixture({ android: false });
  assert.equal(f.createFicsSocket().url, 'wss://www.freechess.org:5001');
});

test('native transport preserves binary commands and ordered buffered messages', async () => {
  const f = nativeSocketFixture();
  const socket = f.createFicsSocket();
  const received = [];
  socket.onopen = () => socket.send(Uint8Array.of(0, 128, 255, 10).buffer);
  socket.onmessage = async ({ data }) => {
    const text = await data.text();
    if(text === 'first') await new Promise(resolve => setImmediate(resolve));
    received.push(text);
  };
  await f.settle();
  f.emit([{ type: 'open' }, ...['first', 'second', 'third'].map(text => ({ type: 'message', data: btoa(text) }))]);
  await f.settle();
  assert.equal(socket.readyState, 1);
  assert.equal(f.sent.length, 1);
  assert.deepEqual([...Buffer.from(f.sent[0].data, 'base64')], [0, 128, 255, 10]);
  assert.deepEqual(received, ['first', 'second', 'third']);
  assert.equal(f.closed, 0);
});

test('closing during native connection setup never opens the JS session', async () => {
  const f = nativeSocketFixture();
  const socket = f.createFicsSocket();
  let opened = false;
  socket.onopen = () => { opened = true; };
  socket.close();
  await f.settle();
  f.emit([{ type: 'open' }, { type: 'close', code: 1000, reason: '', wasClean: true }]);
  await f.settle();
  assert.equal(opened, false);
  assert.equal(f.closed, 1);
  assert.equal(socket.readyState, 3);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.disposed.length, 1);
});

test('native failure reports error then close and releases listeners and socket', async () => {
  const f = nativeSocketFixture();
  const socket = f.createFicsSocket();
  const events = [];
  socket.onerror = () => events.push('error');
  socket.onclose = event => events.push(`close:${event.code}:${event.wasClean}`);
  await f.settle();
  f.emit([{ type: 'open' }, { type: 'error' }, { type: 'close', code: 1006, reason: '', wasClean: false }]);
  await f.settle();
  assert.deepEqual(events, ['error', 'close:1006:false']);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.disposed.length, 1);
});

test('bridge send rejection closes once instead of leaving an apparently open socket', async () => {
  const f = nativeSocketFixture();
  f.native.send = async () => { throw new Error('bridge unavailable'); };
  const socket = f.createFicsSocket();
  let closed = 0;
  socket.onclose = () => closed++;
  await f.settle();
  f.emit([{ type: 'open' }]);
  await f.settle();
  socket.send(Uint8Array.of(1).buffer);
  await f.settle();
  assert.equal(socket.readyState, 3);
  assert.equal(closed, 1);
  assert.equal(f.disposed.length, 1);
});
