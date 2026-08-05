/**
 * CodeEditor 主题 — 移植 Hermes code-editor-theme.ts
 *
 * GitHub "default" 明暗色板（对齐 Hermes：与只读视图 Shiki 主题同源，
 * 编辑/预览切换不换色）。token 色值为固定色（CodeMirror Lezer 分词 vs
 * Shiki TextMate——色板匹配而非逐字节一致）。
 *
 * 布局变量适配 ELEVE：字体走 --dt-font-mono（主题字体体系），弱化色走
 * --ui-text-tertiary（语义层）。行高/字号对齐 Hermes（1.25rem / 0.7rem）
 * 保证 编辑⇄预览 切换零位移。
 */

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

interface GithubPalette {
  comment: string;
  constant: string;
  entity: string;
  fg: string;
  keyword: string;
  number: string;
  string: string;
  tag: string;
  type: string;
}

const DARK: GithubPalette = {
  comment: '#8b949e',
  constant: '#79c0ff',
  entity: '#d2a8ff',
  fg: '#e6edf3',
  keyword: '#ff7b72',
  number: '#79c0ff',
  string: '#a5d6ff',
  tag: '#7ee787',
  type: '#ffa657',
};

const LIGHT: GithubPalette = {
  comment: '#6e7781',
  constant: '#0550ae',
  entity: '#8250df',
  fg: '#1f2328',
  keyword: '#cf222e',
  number: '#0550ae',
  string: '#0a3069',
  tag: '#116329',
  type: '#953800',
};

function makeHighlightStyle(p: GithubPalette): HighlightStyle {
  return HighlightStyle.define([
    { color: p.keyword, tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.moduleKeyword] },
    { color: p.string, tag: [t.string, t.special(t.string), t.regexp, t.character, t.attributeName] },
    { color: p.constant, tag: [t.constant(t.name), t.standard(t.name), t.bool, t.null, t.number, t.integer, t.float] },
    { color: p.comment, tag: [t.lineComment, t.blockComment, t.docComment, t.meta] },
    { color: p.type, tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName)] },
    { color: p.entity, tag: [t.definition(t.name), t.function(t.variableName), t.labelName] },
    { color: p.tag, tag: [t.tagName, t.angleBracket] },
    { color: p.fg, tag: [t.variableName, t.propertyName, t.operator, t.punctuation] },
  ]);
}

// 对齐 Hermes LAYOUT_THEME：SourceView 几何/字体 1:1（编辑⇄预览零位移）。
// 变量适配 ELEVE：--dt-font-mono（主题字体）/ --ui-text-tertiary（gutter 弱化）。
const LAYOUT_THEME = EditorView.theme({
  '&': {
    WebkitFontSmoothing: 'antialiased',
    backgroundColor: 'transparent',
    height: '100%',
  },
  // CM 基础主题自带 .cm-content { padding: 4px 0 }——显式清零，
  // 与只读视图 flush-top 对齐
  '.cm-content': {
    fontFamily: 'var(--dt-font-mono)',
    fontSize: '0.7rem',
    fontWeight: '400',
    lineHeight: '1.25rem',
    padding: '0',
    paddingBottom: '0',
    paddingTop: '0',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--ui-text-tertiary)',
    fontFamily: 'var(--dt-font-mono)',
    fontSize: '0.7rem',
  },
  // 双类选择器压过 CM 基础 .cm-lineNumbers .cm-gutterElement
  '.cm-lineNumbers .cm-gutterElement': {
    boxSizing: 'border-box',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: '400',
    lineHeight: '1.25rem',
    minWidth: '2.25rem',
    padding: '0 0.5rem 0 0',
    textAlign: 'right',
  },
  '.cm-line': {
    fontFamily: 'var(--dt-font-mono)',
    fontSize: '0.7rem',
    fontWeight: '400',
    lineHeight: '1.25rem',
    padding: '0 0.625rem',
  },
  '.cm-scroller': {
    fontFamily: 'var(--dt-font-mono)',
    fontSize: '0.7rem',
    lineHeight: '1.25rem',
    overflow: 'auto',
  },
  // 光标/选区走主题语义色（暗色下不可见时由浏览器默认兜底）
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--ui-text-primary)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--ui-text-primary) 18%, transparent)',
  },
});

export function githubEditorTheme(isDark: boolean): Extension {
  const p = isDark ? DARK : LIGHT;
  return [
    syntaxHighlighting(makeHighlightStyle(p)),
    EditorView.theme({ '&': { color: p.fg } }),
    LAYOUT_THEME,
  ];
}
