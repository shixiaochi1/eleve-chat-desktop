import { describe, it, expect } from 'vitest';
import {
  asText, normalize, includesQuery,
  firstStringField, firstRawStringField, truncateOneLine,
  looksLikeUrl, looksLikePath,
} from './text';

describe('asText', () => {
  it('null/undefined → 空串，非字符串 String() 化', () => {
    expect(asText(null)).toBe('');
    expect(asText(undefined)).toBe('');
    expect(asText(42)).toBe('42');
    expect(asText('s')).toBe('s');
  });
});

describe('normalize / includesQuery（session-search 消费）', () => {
  it('trim + toLowerCase', () => {
    expect(normalize('  Hello World ')).toBe('hello world');
    expect(normalize(123)).toBe('123');
  });

  it('includesQuery 值侧 toLowerCase', () => {
    expect(includesQuery('Hello World', 'world')).toBe(true);
    expect(includesQuery(null, 'x')).toBe(false);
  });
});

describe('firstStringField（trim 版）', () => {
  it('按键序取首个非空字段并 trim', () => {
    expect(firstStringField({ a: '', b: '  val  ' }, ['a', 'b'])).toBe('val');
  });

  it('全空 → 空串', () => {
    expect(firstStringField({ a: '' }, ['a', 'b'])).toBe('');
    expect(firstStringField({}, ['x'])).toBe('');
  });

  it('非字符串值跳过', () => {
    expect(firstStringField({ a: 1, b: 's' }, ['a', 'b'])).toBe('s');
  });
});

describe('firstRawStringField（保真版——read content 用）', () => {
  it('返回原值不 trim（首尾空白/空行保真）', () => {
    expect(firstRawStringField({ content: '  line\n' }, ['content'])).toBe('  line\n');
  });

  it('空串跳过继续找', () => {
    expect(firstRawStringField({ a: '', b: 'x' }, ['a', 'b'])).toBe('x');
  });
});

describe('truncateOneLine', () => {
  it('空白压缩为单空格', () => {
    expect(truncateOneLine('a\n\n  b\tc', 100)).toBe('a b c');
  });

  it('超长截断加省略号', () => {
    expect(truncateOneLine('abcdef', 4)).toBe('abc…');
  });
});

describe('looksLikeUrl / looksLikePath（Hermes targets.ts 对齐）', () => {
  it('http/https 判 URL', () => {
    expect(looksLikeUrl('https://x.dev/a')).toBe(true);
    expect(looksLikeUrl('ftp://x')).toBe(false);
  });

  it('file:// 与 POSIX 绝对/相对路径判 path', () => {
    expect(looksLikePath('file:///a/b.html')).toBe(true);
    expect(looksLikePath('/abs/path')).toBe(true);
    expect(looksLikePath('./rel')).toBe(true);
    expect(looksLikePath('plain.txt')).toBe(false);
  });
});
