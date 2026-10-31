// ===== tp-sim editor: CodeMirror 6 setup for teach-pendant programs =====
'use strict';
const TPEditor = (() => {
  const { EditorView, EditorState, StateField, StateEffect, Decoration, RangeSetBuilder, gutter, GutterMarker, keymap,
    lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, history, historyKeymap, defaultKeymap,
    StreamLanguage, HighlightStyle, syntaxHighlighting, lintGutter, setDiagnostics, autocompletion, snippetCompletion, tags, Tag, Compartment } = CM;

  // ---- language: one TP instruction per line ----
  const T = { motJ: Tag.define(), motL: Tag.define(), motC: Tag.define(), pos: Tag.define(), io: Tag.define(), term: Tag.define(), opt: Tag.define() };
  const KW = /^(IF|THEN|ELSE|ENDIF|SELECT|FOR|TO|DOWNTO|ENDFOR|JMP|CALL|WAIT|TIMEOUT|END|ABORT|PAUSE|AND|OR|NOT|DIV|MOD|OVERRIDE|PULSE|LPOS|JPOS|UFRAME_NUM|UTOOL_NUM|UFRAME|UTOOL|OFFSET|TOOL_OFFSET|CONDITION|PAYLOAD)\b/i;
  const BR = '\\[[^\\]\\[]*(?:\\[[^\\]]*\\][^\\]\\[]*)?\\]';
  const reIO = new RegExp('^(DI|DO|RI|RO|GI|GO|UI|UO|SI|SO|AI|AO|F|M)' + BR, 'i');
  const reReg = new RegExp('^(R|AR|SR|TIMER)' + BR, 'i');
  const rePos = new RegExp('^(PR|P)' + BR, 'i');
  const reLbl = new RegExp('^LBL' + BR, 'i');
  const tp = StreamLanguage.define({
    name: 'tp',
    startState: () => ({ start: true, afterCall: false }),
    token(stream, st) {
      if (stream.sol()) { st.start = true; st.afterCall = false; }
      if (stream.eatSpace()) return null;
      if (st.start) {
        st.start = false;
        if (stream.match(/^!.*/) || stream.match(/^\/\/.*/)) return 'comment';
        if (stream.match(/^J(?=\s)/)) return 'motJ';
        if (stream.match(/^L(?=\s)/)) return 'motL';
        if (stream.match(/^C(?=\s)/)) return 'motC';
      }
      if (st.afterCall && stream.match(/^[A-Za-z0-9_]+/)) { st.afterCall = false; return 'className'; }
      if (stream.match(reLbl)) return 'labelName';
      if (stream.match(rePos)) return 'pos';
      if (stream.match(reIO)) return 'io';
      if (stream.match(reReg)) return 'variableName';
      if (stream.match(/^(FINE|CNT\s*\d+|CR\s*\d*|max_speed)\b/i)) return 'term';
      if (stream.match(/^(Offset|Tool_Offset|ACC\s*\d+|Wjnt|INC|Skip)\b/)) return 'opt';
      if (stream.match(/^(ON|OFF)\b/)) return 'bool';
      const m = stream.match(KW);
      if (m) { if (/^CALL$/i.test(m[0])) st.afterCall = true; return 'keyword'; }
      if (stream.match(/^\d*\.?\d+\s*(%|mm\/sec|cm\/min|inch\/min|deg\/sec|sec|\(sec\))?/i)) return 'number';
      if (stream.match(/^(<=|>=|<>|=|<|>|\+|-|\*|\/|\(|\)|,)/)) return 'operator';
      stream.next(); return null;
    },
    tokenTable: { motJ: T.motJ, motL: T.motL, motC: T.motC, pos: T.pos, io: T.io, term: T.term, opt: T.opt }
  });
  const style = HighlightStyle.define([
    { tag: tags.comment, color: 'var(--muted)', fontStyle: 'italic' },
    { tag: T.motJ, color: 'var(--mJ)', fontWeight: '700' },
    { tag: T.motL, color: 'var(--mL)', fontWeight: '700' },
    { tag: T.motC, color: 'var(--mC)', fontWeight: '700' },
    { tag: tags.keyword, color: 'var(--kw)', fontWeight: '600' },
    { tag: tags.labelName, color: 'var(--kw)', fontWeight: '600' },
    { tag: tags.className, color: 'var(--kw)', textDecoration: 'underline' },
    { tag: T.pos, color: 'var(--pos)' },
    { tag: tags.variableName, color: 'var(--reg)' },
    { tag: T.io, color: 'var(--io)' },
    { tag: tags.bool, color: 'var(--io)', fontWeight: '600' },
    { tag: tags.number, color: 'var(--num)' },
    { tag: T.term, color: 'var(--muted)', fontWeight: '600' },
    { tag: T.opt, color: 'var(--mC)' },
    { tag: tags.operator, color: 'var(--muted)' }
  ]);

  // ---- completions ----
  const S = snippetCompletion;
  const completions = [
    S('J P[${1}] ${100}% ${FINE}', { label: 'J P[ ] joint move', type: 'keyword' }),
    S('L P[${1}] ${250}mm/sec ${FINE}', { label: 'L P[ ] linear move', type: 'keyword' }),
    S('C P[${1}] P[${2}] ${100}mm/sec ${FINE}', { label: 'C P[ ] P[ ] circular move', type: 'keyword' }),
    S('J PR[${1}] ${100}% ${FINE}', { label: 'J PR[ ] move to position register', type: 'keyword' }),
    S('L P[${1}] ${250}mm/sec ${FINE} Offset,PR[${2}]', { label: 'L P[ ] ... Offset,PR[ ]', type: 'keyword' }),
    S('R[${1}]=${0}', { label: 'R[ ]=value', type: 'variable' }),
    S('R[${1}]=R[${1}]+${1}', { label: 'R[ ]=R[ ]+1 (count)', type: 'variable' }),
    S('PR[${1}]=PR[${1}]-PR[${1}]', { label: 'PR[ ]=PR[ ]-PR[ ] (clear)', type: 'variable' }),
    S('PR[${1},${3}]=PR[${1},${3}]+${50}', { label: 'PR[i,j]=PR[i,j]+value', type: 'variable' }),
    S('PR[${1}]=LPOS', { label: 'PR[ ]=LPOS', type: 'variable' }),
    S('PR[${1}]=P[${2}]', { label: 'PR[ ]=P[ ]', type: 'variable' }),
    S('LBL[${1}]', { label: 'LBL[ ]', type: 'keyword' }),
    S('JMP LBL[${1}]', { label: 'JMP LBL[ ]', type: 'keyword' }),
    S('IF R[${1}]<${5},JMP LBL[${1}]', { label: 'IF R[ ]<value,JMP LBL[ ]', type: 'keyword' }),
    S('IF DI[${1}]=ON,CALL ${PROGRAM}', { label: 'IF DI[ ]=ON,CALL program', type: 'keyword' }),
    S('IF (${R[1]=1}) THEN', { label: 'IF (...) THEN', type: 'keyword' }),
    S('ELSE', { label: 'ELSE', type: 'keyword' }), S('ENDIF', { label: 'ENDIF', type: 'keyword' }),
    S('SELECT R[${1}]=${1},JMP LBL[${1}]', { label: 'SELECT R[ ]=value,JMP LBL[ ]', type: 'keyword' }),
    S('=${2},JMP LBL[${2}]', { label: '=value,JMP LBL[ ] (SELECT branch)', type: 'keyword' }),
    S('ELSE,JMP LBL[${9}]', { label: 'ELSE,JMP LBL[ ] (SELECT branch)', type: 'keyword' }),
    S('FOR R[${1}]=${1} TO ${5}', { label: 'FOR R[ ]=1 TO n', type: 'keyword' }), S('ENDFOR', { label: 'ENDFOR', type: 'keyword' }),
    S('WAIT ${1.00}(sec)', { label: 'WAIT time', type: 'keyword' }),
    S('WAIT DI[${1}]=${ON}', { label: 'WAIT DI[ ]=ON', type: 'keyword' }),
    S('WAIT DI[${1}]=ON TIMEOUT,LBL[${1}]', { label: 'WAIT ... TIMEOUT,LBL[ ]', type: 'keyword' }),
    S('CALL ${PROGRAM}', { label: 'CALL program', type: 'keyword' }),
    S('CALL ${PROGRAM}(${1})', { label: 'CALL program(arguments)', type: 'keyword' }),
    S('R[${1}]=AR[${1}]', { label: 'R[ ]=AR[ ] (read an argument)', type: 'variable' }),
    S('RO[${1}]=${ON}', { label: 'RO[ ]=ON/OFF (gripper)', type: 'variable' }),
    S('DO[${1}]=${ON}', { label: 'DO[ ]=ON/OFF', type: 'variable' }),
    S('DO[${1}]=PULSE,${0.5}sec', { label: 'DO[ ]=PULSE', type: 'variable' }),
    S('OFFSET CONDITION PR[${1}]', { label: 'OFFSET CONDITION PR[ ]', type: 'keyword' }),
    S('UFRAME_NUM=${0}', { label: 'UFRAME_NUM=', type: 'keyword' }), S('UTOOL_NUM=${1}', { label: 'UTOOL_NUM=', type: 'keyword' }),
    S('UFRAME[${1}]=PR[${1}]', { label: 'UFRAME[ ]=PR[ ]', type: 'keyword' }),
    S('OVERRIDE=${50}%', { label: 'OVERRIDE=%', type: 'keyword' }),
    S('END', { label: 'END', type: 'keyword' }), S('! ${comment}', { label: '! comment', type: 'text' })
  ];
  const completeTP = (ctx) => {
    const w = ctx.matchBefore(/[A-Za-z=!][\w\[\]=<>,.%]*/);
    if (!w || (w.from === w.to && !ctx.explicit)) return null;
    return { from: w.from, options: completions, validFor: /^[\w\[\]]*$/ };
  };

  // ---- executing line + execution counts ----
  const setExec = StateEffect.define();
  const execField = StateField.define({
    create: () => Decoration.none,
    update(deco, tr) {
      deco = deco.map(tr.changes);
      for (const e of tr.effects) if (e.is(setExec)) {
        const { line, sub } = e.value;
        if (!line || line > tr.state.doc.lines) deco = Decoration.none;
        else { const l = tr.state.doc.line(line); deco = Decoration.set([Decoration.line({ class: sub ? 'cm-exec cm-exec-sub' : 'cm-exec' }).range(l.from)]); }
      }
      return deco;
    },
    provide: f => EditorView.decorations.from(f)
  });
  const setCounts = StateEffect.define();
  const countField = StateField.define({
    create: () => ({ counts: {}, ran: false }),
    update(v, tr) { for (const e of tr.effects) if (e.is(setCounts)) return e.value; return v; }
  });
  class CountMarker extends GutterMarker {
    constructor(n) { super(); this.n = n; }
    eq(o) { return o.n === this.n; }
    toDOM() { const s = document.createElement('span'); s.textContent = this.n > 1 ? '×' + this.n : '•'; s.title = this.n > 1 ? `Ran ${this.n} times` : 'Ran once'; return s; }
  }
  const countGutter = gutter({
    class: 'cm-count-gutter',
    lineMarker(view, line) { const n = view.state.doc.lineAt(line.from).number, c = view.state.field(countField).counts[n]; return c ? new CountMarker(c) : null; },
    lineMarkerChange: u => u.transactions.some(tr => tr.effects.some(e => e.is(setCounts))) || u.docChanged,
    initialSpacer: () => new CountMarker(99)
  });
  // lines that never ran get dimmed
  const unrunDeco = EditorView.decorations.compute([countField, 'doc'], state => {
    const { counts, ran } = state.field(countField);
    if (!ran) return Decoration.none;
    const b = new RangeSetBuilder();
    for (let i = 1; i <= state.doc.lines; i++) { const l = state.doc.line(i); if (!counts[i] && l.text.trim()) b.add(l.from, l.from, Decoration.line({ class: 'cm-unrun' })); }
    return b.finish();
  });

  const theme = EditorView.theme({
    '&': { backgroundColor: 'var(--paper)', color: 'var(--fg)', fontSize: '13px', height: '100%' },
    '.cm-content': { fontFamily: 'var(--f-mono)', caretColor: 'var(--fg)', padding: '6px 0' },
    '.cm-scroller': { fontFamily: 'var(--f-mono)', lineHeight: '1.55', overflow: 'auto' },
    '.cm-gutters': { backgroundColor: 'var(--panel-2)', color: 'var(--muted)', borderRight: '1px solid var(--line)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--fg)', fontWeight: '600' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--fg) 5%, transparent)' },
    '.cm-exec': { backgroundColor: 'color-mix(in srgb, var(--accent) 26%, transparent)', boxShadow: 'inset 3px 0 0 var(--accent)' },
    '.cm-exec-sub': { backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)', boxShadow: 'inset 3px 0 0 color-mix(in srgb, var(--accent) 60%, transparent)' },
    '.cm-unrun': { opacity: '0.45' },
    '.cm-count-gutter .cm-gutterElement': { fontSize: '11px', padding: '0 4px 0 6px', color: 'var(--accent-text)', fontWeight: '600', minWidth: '3ch', textAlign: 'right' },
    '&.cm-focused': { outline: 'none' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--mL) 30%, transparent)' },
    '.cm-cursor': { borderLeftColor: 'var(--fg)' },
    '.cm-tooltip': { backgroundColor: 'var(--panel)', color: 'var(--fg)', border: '1px solid var(--line)', fontFamily: 'var(--f-body)' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' },
    '.cm-diagnostic': { fontFamily: 'var(--f-body)', fontSize: '13px', maxWidth: '420px' },
    '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warn) 1px' },
    '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--bad) 1px' },
    '.cm-lintRange-info': { backgroundImage: 'none' }
  });

  function create(parent, opts) {
    const readOnly = new Compartment();
    let suppress = false;
    const extensions = [
      lineNumbers(), opts.counts ? countGutter : [], opts.lint ? lintGutter() : [],
      history(), drawSelection(), highlightActiveLine(), highlightActiveLineGutter(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      opts.language === 'tp' ? [tp, syntaxHighlighting(style), autocompletion({ override: [completeTP], icons: false }), execField, countField, unrunDeco] : [],
      theme, EditorView.lineWrapping, readOnly.of(EditorState.readOnly.of(false)),
      EditorView.updateListener.of(u => {
        if (u.docChanged && !suppress && opts.onChange) opts.onChange(u.state.doc.toString());
        if (u.selectionSet && !u.docChanged && opts.onCursor) {
          const pointer = u.transactions.some(tr => tr.isUserEvent('select.pointer'));
          if (pointer) opts.onCursor(u.state.doc.lineAt(u.state.selection.main.head).number);
        }
      }),
      EditorView.contentAttributes.of({ 'aria-label': opts.label || 'Program editor', spellcheck: 'false', autocorrect: 'off', autocapitalize: 'characters' })
    ];
    const view = new EditorView({ state: EditorState.create({ doc: opts.doc || '', extensions }), parent });
    return {
      view,
      getText: () => view.state.doc.toString(),
      setText(text) {
        if (text === view.state.doc.toString()) return;
        suppress = true;
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
        suppress = false;
      },
      setExecLine(line, sub, scroll) {
        const effects = [setExec.of({ line, sub })];
        if (scroll && line && line <= view.state.doc.lines) effects.push(EditorView.scrollIntoView(view.state.doc.line(line).from, { y: 'nearest', yMargin: 40 }));
        view.dispatch({ effects });
      },
      setCounts(counts, ran) { if (opts.language === 'tp') view.dispatch({ effects: setCounts.of({ counts, ran }) }); },
      setDiagnostics(list) {
        const doc = view.state.doc;
        const diags = list.filter(d => d.line >= 1 && d.line <= doc.lines).map(d => {
          const l = doc.line(d.line); const lead = l.text.length - l.text.trimStart().length;
          return { from: l.from + lead, to: Math.max(l.from + lead, l.to), severity: d.sev === 'bad' ? 'error' : d.sev === 'warn' ? 'warning' : 'info', message: d.title + ' — ' + d.detail };
        });
        view.dispatch(setDiagnostics(view.state, diags));
      },
      gotoLine(line) {
        if (line < 1 || line > view.state.doc.lines) return;
        const l = view.state.doc.line(line);
        view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
      },
      cursorLine: () => view.state.doc.lineAt(view.state.selection.main.head).number,
      replaceLine(line, text) {
        const l = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
        view.dispatch({ changes: { from: l.from, to: l.to, insert: text }, selection: { anchor: l.from + text.length } });
      },
      insertLineAfter(line, text) {
        const l = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
        view.dispatch({ changes: { from: l.to, insert: '\n' + text }, selection: { anchor: l.to + 1 + text.length } });
      },
      focus: () => view.focus()
    };
  }
  return { create };
})();
