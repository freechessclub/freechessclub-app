// Run with: node --test scripts/theme-effects.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function createHarness() {
  const animations = [];
  class Element {
    isConnected = true;
    style = {};
    children = [];
    append(child) { this.children.push(child); child.parent = this; }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
    setAttribute() {}
    getBoundingClientRect() { return { width: 400, height: 500 }; }
    animate(keyframes, options) {
      let finish, reject;
      const animation = {
        keyframes, options, cancelled: false,
        finished: new Promise((resolve, fail) => { finish = resolve; reject = fail; }),
        cancel() { this.cancelled = true; reject(new Error('cancelled')); },
        finish: () => finish()
      };
      animations.push(animation);
      return animation;
    }
  }
  const events = {};
  const document = {
    hidden: false,
    createElement: () => new Element(),
    addEventListener: (event, callback) => { events[event] = callback; }
  };
  // Compile the real modules in an isolated DOM/animation harness, without a browser dependency.
  const modules = new Map();
  function load(name) {
    if(modules.has(name)) return modules.get(name);
    const filename = path.resolve(__dirname, '../src/js', `${name}.ts`);
    const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    });
    const exports = {};
    modules.set(name, exports);
    vm.runInNewContext(outputText, { exports, document, require: id => load(id.replace('./', '')) }, { filename });
    return exports;
  }
  return { ...load('theme-effects'), ...load('theme-animations'), ...load('theme-effects-registry'), animations, document, events, target: () => new Element() };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('themes independently opt into shared hooks and reuse animations with their own palette', () => {
  const h = createHarness(), clock = h.target(), card = h.target();
  h.setThemeEffects(h.themeEffectsRegistry.default);
  h.runThemeEffect('playerTurn', clock);
  h.runThemeEffect('playerWin', card);
  assert.equal(h.animations.length, 0);

  h.setThemeEffects({ playerTurn: h.clockGlow('rebeccapurple', 500) });
  h.runThemeEffect('playerWin', card);
  h.runThemeEffect('playerTurn', clock);
  assert.equal(h.animations.length, 1);
  assert.match(h.animations[0].keyframes[1].boxShadow, /rebeccapurple/);
  assert.equal(h.animations[0].options.duration, 500);

  h.setThemeEffects(h.themeEffectsRegistry.clubhouse);
  assert(h.animations[0].cancelled);
  h.runThemeEffect('playerWin', card);
  assert.equal(card.children[0].children.length, 72);
  assert.equal(new Set(h.animations.slice(1).map(a => a.options.delay)).size, 3);
  h.setThemeEffects();
  assert.equal(card.children.length, 0);
  assert(h.animations.every(a => a.cancelled));
});

test('custom handlers share cleanup, and an old completion cannot cancel its replacement', async () => {
  const h = createHarness(), target = h.target();
  let calls = 0;
  h.setThemeEffects({ playerTurn: element => { calls++; return element.animate([], {}); } });
  h.runThemeEffect('playerTurn', target);
  h.runThemeEffect('playerTurn', target);
  await settle();
  assert.equal(calls, 2);
  assert(h.animations[0].cancelled);
  assert(!h.animations[1].cancelled);
  h.animations[1].finish();
  await settle();
  assert(h.animations[1].cancelled);
});

test('hidden pages cancel all targets, and hidden or detached targets cannot start effects', () => {
  const h = createHarness(), clock = h.target(), card = h.target();
  h.setThemeEffects(h.themeEffectsRegistry.clubhouse);
  h.runThemeEffect('playerTurn', clock);
  h.runThemeEffect('playerWin', card);
  h.document.hidden = true;
  h.events.visibilitychange();
  assert.equal(card.children.length, 0);
  assert(h.animations.every(a => a.cancelled));
  const count = h.animations.length;
  h.runThemeEffect('playerTurn', clock);
  h.document.hidden = false;
  card.isConnected = false;
  h.runThemeEffect('playerWin', card);
  assert.equal(h.animations.length, count);
});

test('a completed celebration removes its temporary DOM', async () => {
  const h = createHarness(), card = h.target();
  h.setThemeEffects(h.themeEffectsRegistry.clubhouse);
  h.runThemeEffect('playerWin', card);
  h.animations.forEach(animation => animation.finish());
  await settle();
  assert.equal(card.children.length, 0);
});
