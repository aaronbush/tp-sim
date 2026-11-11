// Copies ../site to ./site so the packaged extension carries the static app. No dependencies.
const fs = require('fs');
const path = require('path');
const src = path.resolve(__dirname, '..', '..', 'site');
const dst = path.resolve(__dirname, '..', 'site');
if (!fs.existsSync(path.join(src, 'index.html'))) { console.error('copy-site: ' + src + ' has no index.html'); process.exit(1); }
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
console.log('copy-site: copied ' + src + ' -> ' + dst);
