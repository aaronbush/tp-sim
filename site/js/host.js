// ===== host.js: bridge between the page and a VS Code webview host =====
// Does nothing unless `acquireVsCodeApi` exists (i.e. the page runs inside the tp-sim VS Code extension).
// Classic script, loaded last. Uses app.js globals: programs, entryFromText, addEntry, lsOf, flash.
// Messages in  (extension -> page): { type:'openProgram', uri, name, text }
// Messages out (page -> extension): { type:'ready' } and { type:'programChanged', uri, text }
// Edit detection relies on the optional `window.onTPWorkspaceSaved` hook that app.js calls from saveWorkspace().
const TPHost = (() => {
  if (typeof acquireVsCodeApi !== 'function') return { active: false };
  const vscode = acquireVsCodeApi();
  const norm = s => String(s).replace(/\r\n?/g, '\n');
  const byName = new Map();   // program name -> { uri, last }   last = normalized text the file is known to hold
  let timer = 0;

  function find(name) { return programs.find(p => p.name === name); }

  // Open (or replace) a program using the same path as the "Open .ls…" button.
  function openProgram(msg) {
    const en = entryFromText(norm(msg.text));
    if (en.errors && en.errors.length) { if (typeof flash === 'function') flash(`${msg.name || 'file'}: ${en.errors[0]}`); return; }
    const prev = find(en.name);
    // Keep the "edited" baseline of a file-backed tab stable so Revert still goes back to what was first opened.
    if (prev && byName.has(en.name) && prev.origLines != null) { en.origLines = prev.origLines; en.origPos = prev.origPos; }
    addEntry(en, true);
    byName.set(en.name, { uri: msg.uri, last: norm(lsOf(find(en.name))) });  // baseline set after load: no echo back
  }

  function check() {
    for (const [name, rec] of byName) {
      const e = find(name); if (!e) { byName.delete(name); continue; }
      let text; try { text = norm(lsOf(e)); } catch (err) { continue; }
      if (text === rec.last) continue;
      rec.last = text;
      vscode.postMessage({ type: 'programChanged', uri: rec.uri, text });
    }
  }
  window.onTPWorkspaceSaved = () => { clearTimeout(timer); timer = setTimeout(check, 300); };

  window.addEventListener('message', ev => {
    const m = ev.data; if (!m || typeof m !== 'object') return;
    if (m.type === 'openProgram' && typeof m.text === 'string') openProgram(m);
  });
  vscode.postMessage({ type: 'ready' });
  return { active: true, openProgram, check };
})();
