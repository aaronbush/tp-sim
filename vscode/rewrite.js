// Pure HTML rewriting for the webview (no vscode / fs / path imports; shared by extension.js and the test).
'use strict';

const isLocal = u => u && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u);

// opts: { toUri(rel) -> string, baseHref, cspSource }
function buildHtml(html, opts) {
  const { toUri, baseHref, cspSource } = opts;
  // Rewrite relative src/href on tags (leave <a href="#..."> and absolute URLs alone).
  let out = html.replace(/(<(?:script|link|img|source|audio|video)\b[^>]*?\s)(src|href)=(["'])(.*?)\3/gi,
    (m, pre, attr, q, val) => isLocal(val) ? `${pre}${attr}=${q}${toUri(val)}${q}` : m);
  const csp = [
    "default-src 'none'",
    `script-src ${cspSource}`,                                   // external files only: no inline, no eval
    `style-src ${cspSource} 'unsafe-inline' https://fonts.googleapis.com`, // site uses style="" attributes
    `font-src ${cspSource} https://fonts.gstatic.com data:`,
    `img-src ${cspSource} data: blob:`,
    `connect-src ${cspSource}`,                                  // fetch('examples/...') resolves via <base>
    "worker-src blob:",
    "base-uri " + cspSource
  ].join('; ');
  const inject = `<meta http-equiv="Content-Security-Policy" content="${csp}">\n<base href="${baseHref}">\n`;
  return /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, m => m + '\n' + inject) : inject + out;
}

module.exports = { buildHtml, isLocal };
