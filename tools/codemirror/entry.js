export { EditorView, keymap, Decoration, gutter, GutterMarker, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, ViewPlugin, placeholder } from '@codemirror/view';
export { EditorState, StateField, StateEffect, RangeSetBuilder, Compartment, RangeSet } from '@codemirror/state';
export { basicSetup } from 'codemirror';
export { StreamLanguage, HighlightStyle, syntaxHighlighting, indentUnit } from '@codemirror/language';
export { linter, lintGutter, setDiagnostics, forceLinting } from '@codemirror/lint';
export { autocompletion, snippetCompletion, completeFromList } from '@codemirror/autocomplete';
export { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
export { tags, Tag } from '@lezer/highlight';
