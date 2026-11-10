# TP Sim — teach pendant trainer (VS Code extension)

A thin wrapper that hosts the static simulator in `../site/` inside a VS Code webview, so `.ls` teach-pendant programs can be edited in VS Code and run in the simulator beside them. Plain JavaScript, no bundler, no runtime dependencies. It uses only APIs that exist in both desktop and web VS Code, so it also loads in vscode.dev / Codespaces.

## Commands

- **TP Sim: Open simulator** opens the simulator panel.
- **TP Sim: Open this .ls file in the simulator** (also in the editor title bar, editor context menu and Explorer menu for `.ls` files) loads the file as a tab.

The extension also registers a `tp-ls` language for `.ls` files with basic syntax highlighting.

## Run it in the Extension Development Host

From the repo root, press **F5** (uses `.vscode/launch.json`, "TP Sim extension"), or run:

```bash
code --extensionDevelopmentPath=./vscode
```

When run from the repo the extension serves `../site` directly, so edits to `site/` show up after reloading the panel. If `vscode/site/` exists it is used instead.

## Package

```bash
cd vscode
npx @vscode/vsce package
```

`vscode:prepublish` runs `scripts/copy-site.js`, which copies `../site` into `vscode/site/` (git-ignored) so the `.vsix` carries the app. Run `node scripts/copy-site.js` by hand if you want to test the bundled layout without packaging. A `repository` field in `package.json` will quiet vsce's warning.

## How the bridge works

`site/js/host.js` does nothing outside VS Code. Inside it:

- The extension sends `{type:'openProgram', uri, name, text}`; the page opens it through the same code as the "Open .ls…" button.
- When you edit that program in the simulator, the page posts `{type:'programChanged', uri, text}` (text from the app's own `.ls` serializer) and the extension writes the file with `workspace.fs.writeFile`. This relies on the `window.onTPWorkspaceSaved` hook called from `saveWorkspace()` in `app.js`.
- Edits made in the VS Code text editor are sent to the page again as `openProgram`.
- Both sides remember the last text they know is in sync, so writes do not echo back.

Security: the webview CSP allows scripts only from the bundled site files (no inline, no `eval`), allows Google Fonts like the site does, and limits `localResourceRoots` to the site folder.

## Known limits

- The simulator re-serializes programs, so the first save may normalize formatting (line numbers, `C` move continuation lines, spacing). Line endings of the original file are kept.
- Each save writes the whole file from the simulator's view of it. If the file has unsaved changes in the text editor, the write is skipped with a warning.
- Only files opened with the commands above are synced. Programs opened with the page's own "Open .ls…" or Examples are not linked to a file.
- The program tab name comes from the `/PROG` name in the file, not the file name; two files with the same `/PROG` name share one tab.
- Fonts need network access (the page has fallbacks). Not tested in a real vscode.dev session.
- The page keeps its own saved workspace in webview storage, which VS Code scopes per extension.
