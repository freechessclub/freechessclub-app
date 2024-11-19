const fs = require('fs').promises;

async function copyFiles() {
  try {
    await fs.copyFile('./play.html', './app/index.html');
    await fs.cp('./assets', './app/assets', { recursive: true, force: true });
  } catch (err) {
    console.error("Error during copy:", err.message);
  }
}

copyFiles();
