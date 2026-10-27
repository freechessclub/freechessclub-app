const fs = require('fs');

const input = 'all.tsv';
const output = 'openings.tsv';

const lines = fs.readFileSync(input, 'utf8').split(/\r?\n/);

const filtered = lines.map(line => {
    const [eco, name, pgn, uci, epd] = line.split('\t');
    return [eco, name, epd].join('\t');
});

fs.writeFileSync(output, filtered.join('\n'));