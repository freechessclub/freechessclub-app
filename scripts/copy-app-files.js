const fs = require('fs').promises;

async function copyFiles() {
  try {
    await fs.mkdir('./app', { recursive: true });
    await fs.copyFile('./www/play.html', './app/index.html');
    await fs.copyFile('./www/service-worker.js', './app/service-worker.js');
    await fs.cp('./www/assets', './app/assets', { recursive: true, force: true });
    await fs.copyFile('./src/js/android/MainActivity.java', './android/app/src/main/java/club/freechess/FreeChessClub/MainActivity.java');
  } catch (err) {
    console.error("Error during copy:", err.message);
  }
}

copyFiles();
