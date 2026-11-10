'use strict';
// TP Sim: hosts the static site (site/) in a webview. Works as a desktop and web extension:
// only the `vscode` API is used (no fs/path); files go through vscode.workspace.fs and Uri.joinPath.
const vscode = require('vscode');
const { buildHtml } = require('./rewrite');

const norm = s => String(s).replace(/\r\n?/g, '\n');
let panel = null;
let siteRoot = null;
let ready = false;
const pending = [];                 // messages queued until the page says 'ready'
const files = new Map();            // uri string -> { uri, last }  last = normalized text known to be in sync
let writing = new Set();            // uri strings with a write in flight

async function exists(uri) { try { await vscode.workspace.fs.stat(uri); return true; } catch (e) { return false; } }

// Prefer the bundled copy (vscode/site, made by scripts/copy-site.js), else the repo's ../site.
async function findSiteRoot(ctx) {
  const bundled = vscode.Uri.joinPath(ctx.extensionUri, 'site');
  if (await exists(vscode.Uri.joinPath(bundled, 'index.html'))) return bundled;
  const repo = vscode.Uri.joinPath(ctx.extensionUri, '..', 'site');
  if (await exists(vscode.Uri.joinPath(repo, 'index.html'))) return repo;
  throw new Error('TP Sim: site/index.html not found (run "node scripts/copy-site.js" in the vscode folder).');
}

async function renderHtml(webview) {
  const raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(siteRoot, 'index.html')));
  const toUri = rel => {
    const m = /^([^?#]*)(.*)$/.exec(rel);
    return webview.asWebviewUri(vscode.Uri.joinPath(siteRoot, ...m[1].split('/').filter(Boolean))).toString() + m[2];
  };
  const baseHref = webview.asWebviewUri(siteRoot).toString().replace(/\/?$/, '/');
  return buildHtml(raw, { toUri, baseHref, cspSource: webview.cspSource });
}

function post(msg) {
  if (!panel) return;
  if (ready) panel.webview.postMessage(msg); else pending.push(msg);
}

async function ensurePanel(ctx) {
  if (panel) { panel.reveal(undefined, true); return; }
  siteRoot = await findSiteRoot(ctx);
  ready = false;
  panel = vscode.window.createWebviewPanel('tpSim', 'TP Sim', vscode.ViewColumn.Beside, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [siteRoot]
  });
  panel.webview.onDidReceiveMessage(onPageMessage);
  panel.onDidDispose(() => { panel = null; ready = false; pending.length = 0; files.clear(); });
  panel.webview.html = await renderHtml(panel.webview);
}

async function onPageMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'ready') {
    ready = true;
    // Re-send everything we track (the page may have reloaded).
    for (const rec of files.values()) pending.push(openMsg(rec.uri, rec.text));
    for (const m of pending.splice(0)) panel && panel.webview.postMessage(m);
    return;
  }
  if (msg.type === 'programChanged' && typeof msg.text === 'string' && typeof msg.uri === 'string') {
    const rec = files.get(msg.uri);
    if (!rec) return;                                   // only write back files we opened
    const text = norm(msg.text);
    if (text === rec.last) return;
    // Don't clobber unsaved edits in the text editor.
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === msg.uri);
    if (doc && doc.isDirty) { vscode.window.showWarningMessage('TP Sim: not writing to ' + vscode.workspace.asRelativePath(rec.uri) + ' because it has unsaved changes in the editor.'); return; }
    const eol = rec.eol || '\n';
    rec.last = text; rec.text = text;                   // set first so the resulting doc-change event is ignored
    writing.add(msg.uri);
    try { await vscode.workspace.fs.writeFile(rec.uri, new TextEncoder().encode(text.replace(/\n/g, eol))); }
    catch (e) { vscode.window.showErrorMessage('TP Sim: could not write file: ' + e.message); }
    finally { setTimeout(() => writing.delete(msg.uri), 500); }
  }
}

const openMsg = (uri, text) => ({ type: 'openProgram', uri: uri.toString(), name: uri.path.split('/').pop(), text });

async function openUri(ctx, uri) {
  await ensurePanel(ctx);
  const key = uri.toString();
  const raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  const text = norm(raw);
  files.set(key, { uri, text, last: text, eol: /\r\n/.test(raw) ? '\r\n' : '\n' });
  post(openMsg(uri, text));
}

function activate(ctx) {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('tpSim.open', async () => {
      try { await ensurePanel(ctx); } catch (e) { vscode.window.showErrorMessage(e.message); }
    }),
    vscode.commands.registerCommand('tpSim.openFile', async arg => {
      try {
        let uri = arg instanceof vscode.Uri ? arg : (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
        if (!uri) { vscode.window.showInformationMessage('TP Sim: open a .ls file first.'); return; }
        await openUri(ctx, uri);
      } catch (e) { vscode.window.showErrorMessage(e.message); }
    }),
    // Edits made in the VS Code text editor -> page.
    vscode.workspace.onDidChangeTextDocument(ev => {
      const key = ev.document.uri.toString();
      const rec = files.get(key);
      if (!rec || !panel || !ev.contentChanges.length || writing.has(key)) return;
      const text = norm(ev.document.getText());
      if (text === rec.last) return;                    // echo of our own write
      rec.last = text; rec.text = text;
      post(openMsg(rec.uri, text));
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
