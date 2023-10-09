/** This script fetches the opening files from https://github.com/lichess-org/chess-openings
 * and appends a FEN onto the end of each line then outputs it as a single file openings.tsv
 */

const fs = require('fs');
const chess_js = require('chess.js');
const request = require('sync-request');

var chess = new chess_js.Chess();

const filePath = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master/';
const inputFiles = ['a.tsv', 'b.tsv', 'c.tsv', 'd.tsv', 'e.tsv'];
const outputFilePath = 'assets/data/openings.tsv'; // Replace with your output file path

var modifiedData = [];
for(const file of inputFiles) {   
    try {  
        var response = request('GET', filePath + file);
    }
    catch (error) {
        console.error('Error:', error.message);
        process.exit();
    }

    if (response.statusCode === 200) {
        var data = response.getBody('utf-8');
    } else {
        console.error(`HTTP error! Status: ${response.statusCode}`);
        process.exit();
    }

    const lines = data.split('\n');
    const modifiedLines = lines.map((line) => {
        var cols = line.split('\t');
        if(cols.length === 3 && cols[2].startsWith('1.')) {
            chess.load_pgn(cols[2]);
            return line + '\t' + chess.fen();
        }
    });
    modifiedData.push(modifiedLines.filter((element) => element).join('\n'));
}

fs.writeFile(outputFilePath, modifiedData.join('\n'), 'utf8', (err) => {
    if (err) {
        console.error('Error writing the output file:', err);
        return;
    }
});

