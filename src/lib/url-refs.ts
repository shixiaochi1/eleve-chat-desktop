/**
 * url-refs — 输入框 URL → `@url:` 引用（对齐 Hermes composer/url-refs.ts）
 *
 * Hermes 基线：输入框里出现的任何 URL（"+ 添加链接"对话框 / 粘贴 / 手输按空格）
 * 最终都变成 `@url:` directive —— 后端网关 REFERENCE_PATTERN 识别并展开网页内容。
 *
 * ELEVE textarea 无 contenteditable chip 渲染，退化为纯文本 `@url:` 注入
 * （= Hermes 无 host onAddUrl 时的 fallback 语义 `insertText('@url:'+url)`），
 * 后端 eleve-gateway context_references.rs expand_url_reference 同样展开。
 *
 * 与 Hermes 的差异仅限展示层（chip vs 文本），语义（发送时为 @url: directive）一致。
 */

// 显式 scheme 才识别 — 裸 example.com 太容易误伤（文件名/版本号/句子）；
// 括号和引号围栏 URL 在散文中保持完整；圆括号不算围栏（留在 URL 内，尾部不配平再裁掉）
const URL_RE = /https?:\/\/[^\s<>[\]{}"'`]+/gi;
const TYPED_URL_RE = /(?:^|\s)(https?:\/\/[^\s<>[\]{}"'`]+)$/i;
// 已在 @引用 directive 围栏内（@file:`…` / @url:"…" 等）的 URL 不重复转换（对齐 Hermes REF_RE fenced 检测）
// 已在 @引用 directive 围栏内（@file:`…` / @url:"…" 等）的 URL 不重复转换（对齐 Hermes REF_RE = referenceRe()：8 种 wire kinds，无前置要求）
const REF_FENCE_RE = /@(file|folder|url|image|tool|line|terminal|session):(`[^`\n]+`|"[^"\n]+"|'[^'\n]+'|\S+)/g;

/** 句子末尾的 URL 会带上结束它的标点（对齐 Hermes splitUrlTail） */
function splitUrlTail(raw: string): { trailing: string; url: string } {
  let url = raw.replace(/[,.;:!?]+$/, '');

  while (url.endsWith(')') && url.split(')').length > url.split('(').length) {
    url = url.slice(0, -1);
  }

  return { trailing: raw.slice(url.length), url };
}

/** URL 需要 scheme 后带 host 才值得变成引用（对齐 Hermes hasHost） */
const hasHost = (url: string) => /^https?:\/\/[^/\s]/i.test(url);

/** 引用值格式化：含空白/括号/引号时用引号围栏包裹（对齐 Hermes formatRefValue；
 *  后端 REFERENCE_PATTERN value 支持 `…` / "…" / '…' 围栏） */
export function formatRefValue(value: string): string {
  if (!/[\s()[\]{}<>"'`]/.test(value)) {
    return value;
  }

  if (!value.includes('`')) {
    return `\`${value}\``;
  }

  if (!value.includes('"')) {
    return `"${value}"`;
  }

  if (!value.includes("'")) {
    return `'${value}'`;
  }

  return value;
}
/** 总是引号围栏包裹的引用值（对齐 Hermes quoteRefValue — chip/linkify/空格提交用，
 *  即使安全值也加围栏；后端 REFERENCE_PATTERN 优先匹配围栏形态） */
export function quoteRefValue(value: string): string {
  if (!value.includes('`')) {
    return `\`${value}\``;
  }

  if (!value.includes('"')) {
    return `"${value}"`;
  }

  if (!value.includes("'")) {
    return `'${value}'`;
  }

  return formatRefValue(value);
}

/** 把 `text` 中的裸链接改写成 `@url:` directive，已在 directive 里的链接不重复处理。
 *  没有裸链接时原样返回（对齐 Hermes linkifyUrls：quoteRefValue 总是反引号包裹，无 chip 纯文本形态） */
/** 把 `text` 中的裸链接改写成 `@url:` directive，已在 directive 里的链接不重复处理。
 *  没有裸链接时原样返回（对齐 Hermes linkifyUrls，无 chip 纯文本形态） */
export function linkifyUrls(text: string): string {
  // 围栏区间：@file:`…` / @url:"…" 等 directive 内的 URL 保持原样
  const fenced = Array.from(text.matchAll(REF_FENCE_RE)).map((match) => {
    const start = match.index ?? 0;
    return { start, end: start + match[0].length };
  });

  let out = '';
  let cursor = 0;

  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    const { url } = splitUrlTail(match[0]);

    if (!hasHost(url) || fenced.some((span) => start >= span.start && start < span.end)) {
      continue;
    }

    out += `${text.slice(cursor, start)}@url:${quoteRefValue(url)}`;
    cursor = start + url.length;
  }

  return out + text.slice(cursor);
}

export interface TypedUrlRewrite {
  /** 改写后的光标前文本（原 URL 已替换为 @url:directive） */
  before: string;
  /** 改写后的光标位置（directive 末尾） */
  caret: number;
}

/** textarea 版空格提交识别：光标前是完整 URL（行首/空白后、含 scheme + host）时
 *  改写成 `@url:` directive。命中返回改写结果，未命中返回 null。
 *  调用方负责写入（受控组件 setValue / 非受控 el.value）并保持光标。
 *  （对齐 Hermes chipTypedUrlOnSpace 语义；textarea 无 chip，退化为文本改写） */
export function rewriteTypedUrl(before: string): TypedUrlRewrite | null {
  const match = TYPED_URL_RE.exec(before);
  const token = match?.[1];

  if (!token) {
    return null;
  }

  const { url } = splitUrlTail(token);

  if (!hasHost(url)) {
    return null;
  }

  const directive = `@url:${quoteRefValue(url)}`;
  const insertAt = before.length - token.length;

  return { before: before.slice(0, insertAt) + directive, caret: insertAt + directive.length };
}
