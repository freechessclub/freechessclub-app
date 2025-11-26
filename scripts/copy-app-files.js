const fs = require('fs').promises;

async function copyFiles() {
  try {
    await fs.mkdir('./app', { recursive: true });
    await fs.copyFile('./www/play.html', './app/index.html');
    await fs.copyFile('./www/manifest.json', './app/manifest.json');
    await fs.copyFile('./www/service-worker.js', './app/service-worker.js');
    await fs.cp('./www/assets', './app/assets', { recursive: true, force: true });
  } catch (err) {
    console.error("Error during copy:", err.message);
  }
}

copyFiles();
