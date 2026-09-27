/** Fetch Lichess opening tables and append the final FEN to each opening. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { Chess } = require('chess.js');

const baseUrl = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master/';
const inputFiles = ['a.tsv', 'b.tsv', 'c.tsv', 'd.tsv', 'e.tsv'];
const outputFilePath = path.join(__dirname, 'src/assets/data/openings.tsv');

async function main() {
  const chess = new Chess();
  const openings = [];

  for (const file of inputFiles) {
    const response = await fetch(new URL(file, baseUrl), {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(`${file}: HTTP ${response.status}`);

    const data = await response.text();
    let count = 0;
    for (const line of data.split(/\r?\n/)) {
      const columns = line.split('\t');
      if (columns.length !== 3 || !columns[2].startsWith('1.'))
        continue;
      if (!chess.load_pgn(columns[2]))
        throw new Error(`${file}: invalid PGN for ${columns[0]} (${columns[1]})`);
      openings.push(`${line}\t${chess.fen()}`);
      count++;
    }
    if (count === 0)
      throw new Error(`${file}: no openings found`);
  }

  // Leave the existing dataset intact if downloading or parsing any table fails.
  await fs.writeFile(outputFilePath, openings.join('\n'), 'utf8');
}

main().catch((error) => {
  console.error('Failed to build openings:', error.message);
  process.exitCode = 1;
});
