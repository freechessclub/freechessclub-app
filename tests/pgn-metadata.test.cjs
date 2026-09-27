const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const { parse } = require('@mliebelt/pgn-parser');

// Isolate the actual metadata update function without running index.ts startup,
// which initializes the DOM, engines, and server connection.
const source = ts.createSourceFile('index.ts', fs.readFileSync(
  path.join(__dirname, '../src/js/index.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const update = source.statements.find(node => ts.isFunctionDeclaration(node)
  && node.name?.text === 'updateGameFromMetatags');
assert.ok(update);
const compiled = ts.transpileModule(update.getText(source), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;

function fixture(tags, examining = false, role = 0) {
  const values = new Map();
  const commands = [];
  function element(selector = '') {
    return {
      find: child => element(`${selector} ${child}`),
      text: value => {
        assert.equal(typeof value, 'string', 'Name/rating updates must pass a string to jQuery');
        values.set(selector, value);
      },
      html: value => value === undefined ? values.get(selector) : values.set(selector, value),
    };
  }
  const game = {
    role, isExamining: () => examining,
    history: { metatags: tags },
    wname: 'PreviousWhite', bname: 'PreviousBlack',
    element: element(), statusElement: element(),
  };
  const context = { Role: { NONE: 0 }, session: { send: command => commands.push(command) } };
  vm.runInNewContext(compiled, context);
  context.updateGameFromMetatags(game);
  return { game, values, commands };
}

for (const [name, headers, white, black] of [
  ['both names missing', '', 'Unknown', 'Unknown'],
  ['white missing', '[Black "Black Player"]', 'Unknown', 'Black Player'],
  ['black missing', '[White "White Player"]', 'White Player', 'Unknown'],
  ['date missing', '[White "White Player"]\n[Black "Black Player"]', 'White Player', 'Black Player'],
]) {
  test(`PGN metadata tolerates ${name}`, () => {
    const [pgn] = parse(`[Event "Regression"]\n${headers}\n[Result "*"]\n\n1. e4 e5 *`, { startRule: 'games' });
    const { game, values, commands } = fixture(pgn.tags);
    assert.equal(values.get(' .white-status .name'), white);
    assert.equal(values.get(' .black-status .name'), black);
    assert.equal(game.wname, white.replace(/[^\w]+/g, '_'));
    assert.equal(game.bname, black.replace(/[^\w]+/g, '_'));
    assert.deepEqual(commands, []);
    assert.equal(pgn.moves.length, 2);
  });
}

test('examined imports use a valid fallback name without changing the source tags', () => {
  const tags = { White: 'A Long Player Name Beyond Limit' };
  const { game, commands, values } = fixture(tags, true);
  assert.equal(game.wname, 'A_Long_Player_Nam');
  assert.equal(values.get(' .white-status .name'), tags.White);
  assert.deepEqual(commands, ['wname A_Long_Player_Nam', 'bname Unknown']);
  assert.equal(tags.Black, undefined);
});

test('metadata does not overwrite players in an active game', () => {
  const { game, values, commands } = fixture({}, false, 1);
  assert.equal(game.wname, 'PreviousWhite');
  assert.equal(game.bname, 'PreviousBlack');
  assert.equal(values.size, 0);
  assert.deepEqual(commands, []);
});
