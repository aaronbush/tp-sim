// Runs the webview HTML rewriting on site/index.html and checks the result. No deps.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { buildHtml, isLocal } = require('../rewrite');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'site', 'index.html'), 'utf8');
const ROOT = 'https://file+.vscode-resource.vscode-cdn.net/site';
const out = buildHtml(html, { toUri: r => ROOT + '/' + r, baseHref: ROOT + '/', cspSource: 'https://file+.vscode-resource.vscode-cdn.net' });
const tags = [...out.matchAll(/<(?:script|link|img)\b[^>]*?\s(?:src|href)=(["'])(.*?)\1/gi)].map(m => m[2]);
assert(tags.length >= 8, 'found tags');
const local = tags.filter(isLocal);
assert.deepStrictEqual(local, [], 'unrewritten local URLs: ' + local);
assert(tags.includes(ROOT + '/js/host.js') && tags.includes(ROOT + '/css/app.css'));
assert(!/unsafe-eval/.test(out), 'no unsafe-eval');
const csp = /Content-Security-Policy" content="([^"]*)"/.exec(out)[1];
assert(/script-src [^;]*/.exec(csp)[0].indexOf('unsafe') < 0, 'script-src has no unsafe-*');
assert(/connect-src https:\/\/file/.test(csp));
assert(/<base href="[^"]+\/">/.test(out));
assert(/<script(?![^>]*\ssrc=)[^>]*>/i.test(out) === false, 'no inline scripts in site');
assert(out.includes('href="#help-start"'), 'fragment links untouched');
console.log('rewrite ok: ' + tags.length + ' tags, csp=' + csp);
