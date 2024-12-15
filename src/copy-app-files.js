const fs = require('fs').promises;

async function copyFiles() {
  try {
    await fs.copyFile('./play.html', './app/index.html');
    await fs.copyFile('./manifest.json', './app/manifest.json');
    await fs.copyFile('./service-worker.js', './app/service-worker.js');
    await fs.cp('./assets', './app/assets', { recursive: true, force: true });
    await fs.copyFile('./src/MainActivity.java', './android/app/src/main/java/club/freechess/FreeChessClub/MainActivity.java');
  } catch (err) {
    console.error("Error during copy:", err.message);
  }
}

copyFiles();
