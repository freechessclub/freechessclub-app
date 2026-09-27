const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'build_openings.js'), 'utf8');
const table = 'eco\tname\tpgn\r\nA00\tExample\t1. e4 e5\r\n';

async function run(fetch) {
  const writes = [];
  const errors = [];
  const process = { exitCode: 0 };
  const context = {
    __dirname: root,
    require: (name) => name === 'node:fs/promises'
      ? { writeFile: async (...args) => writes.push(args) }
      : require(name),
    fetch,
    URL,
    AbortSignal,
    process,
    console: { error: (...args) => errors.push(args.join(' ')) },
  };
  await vm.runInNewContext(source, context);
  return { writes, errors, exitCode: process.exitCode };
}

test('openings builder fetches all tables and writes FENs to the source directory', async () => {
  const urls = [];
  const result = await run(async (url) => {
    urls.push(url.pathname);
    return { ok: true, text: async () => table };
  });
  assert.equal(urls.length, 5);
  assert.deepEqual(urls.map(url => path.basename(url)), ['a.tsv', 'b.tsv', 'c.tsv', 'd.tsv', 'e.tsv']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.writes.length, 1);
  assert.equal(result.writes[0][0], path.join(root, 'src/assets/data/openings.tsv'));
  const expected = 'A00\tExample\t1. e4 e5\trnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2';
  assert.equal(result.writes[0][1], Array(5).fill(expected).join('\n'));
});

for (const [name, fetch] of Object.entries({
  HTTP: async () => ({ ok: false, status: 503 }),
  network: async () => { throw new Error('network unavailable'); },
  PGN: async () => ({ ok: true, text: async () => 'A00\tBad\t1. invalid' }),
  empty: async () => ({ ok: true, text: async () => 'eco\tname\tpgn\n' }),
  partial: async (url) => url.pathname.endsWith('/e.tsv')
    ? { ok: false, status: 503 }
    : { ok: true, text: async () => table },
})) {
  test(`openings builder fails without writing on ${name} failure`, async () => {
    const result = await run(fetch);
    assert.equal(result.exitCode, 1);
    assert.equal(result.writes.length, 0);
    assert.equal(result.errors.length, 1);
  });
}
