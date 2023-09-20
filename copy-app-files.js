const fs = require('fs');
fs.cpSync('./play.html', './app/index.html', {preserveTimestamps: true});
fs.cpSync('./assets', './app/assets', {recursive: true, preserveTimestamps: true});