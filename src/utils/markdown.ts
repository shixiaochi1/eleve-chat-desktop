import 'katex/dist/katex.min.css';

/**
 * Markdown 渲染 + 代码高亮 + 数学公式 + mermaid
 *
 * 🔴 解析器统一 unified/rehype 生态（2026-08-05 老大指示，废弃 marked 手写扩展）：
 * 与 Hermes 同栈 —— remark-parse / remark-gfm / remark-math + rehype-katex（memoized）
 * + hast。后期插件对齐（math / mermaid / artifact / embeds）零成本，解析语义与
 * Hermes 一致，避免 marked/unified 双栈边界问题。
 *
 * 流式保护（mergeSingleNewlines / autolinkOutsideFences / repairMarkdownTail /
 * splitMarkdownBlocks）是自研流式语义层（对齐 Hermes preprocessMarkdown /
 * tailBoundedRemend / parseMarkdownIntoBlocks），与解析器无关，保留。
 *
 * 代码高亮：rehype-highlight（lowlight/hljs 桥接，语言注册与旧 marked 版一致）；
 * Shiki 对齐 Hermes 单独立项（TASK 待办）。
 */

// ── 动态依赖（懒加载，不进主包）──
type AnyProcessor = {
  processSync(text: string): { toString(): string };
};
let processorHi: AnyProcessor | null = null; // 高亮版（稳定块 / 落定态）
let processorPlain: AnyProcessor | null = null; // 无高亮版（流式尾块，延迟高亮）
let DOMPurify: { sanitize(html: string, opts?: Record<string, unknown>): string } | null = null;
let depsReady = false;

// 公式 LRU 缓存（对齐 Hermes katex-memo.ts 的 memo 语义）：
// 同一 (displayMode, tex) 只付一次 katex 成本；流式中新公式到达才重渲染。
const MATH_CACHE_MAX = 512;
const mathCache = new Map<string, string>();

export async function loadMarkdownDeps(): Promise<void> {
  if (depsReady) return;
  const [uni, rp, rg, rm, rr, rh, rs, katexMod, toTextMod, fromHtmlMod, vp, d] = await Promise.all([
    import('unified'),
    import('remark-parse'),
    import('remark-gfm'),
    import('remark-math'),
    import('remark-rehype'),
    import('rehype-highlight'),
    import('rehype-stringify'),
    import('katex'),
    import('hast-util-to-text'),
    import('hast-util-from-html-isomorphic'),
    import('unist-util-visit-parents'),
    import('dompurify'),
  ]);
  const { unified } = uni as { unified: (...plugins: unknown[]) => unknown };
  const remarkParse = ((rp as { default?: unknown }).default ?? rp) as (...args: unknown[]) => unknown;
  const remarkGfm = ((rg as { default?: unknown }).default ?? rg) as (...args: unknown[]) => unknown;
  const remarkMath = ((rm as { default?: unknown }).default ?? rm) as (...args: unknown[]) => unknown;
  const remarkRehype = ((rr as { default?: unknown }).default ?? rr) as (...args: unknown[]) => unknown;
  const rehypeHighlight = ((rh as { default?: unknown }).default ?? rh) as (...args: unknown[]) => unknown;
  const rehypeStringify = ((rs as { default?: unknown }).default ?? rs) as (...args: unknown[]) => unknown;
  const katex = ((katexMod as { default?: unknown }).default ?? katexMod) as {
    renderToString(tex: string, opts: { displayMode: boolean; throwOnError: boolean; errorColor?: string }): string;
  };
  const toText = (toTextMod as { toText: (node: unknown) => string }).toText;
  const fromHtml = (fromHtmlMod as { fromHtmlIsomorphic: (html: string, opts?: { fragment?: boolean }) => unknown }).fromHtmlIsomorphic;
  const { visitParents, SKIP } = vp as unknown as { visitParents: (tree: unknown, test: string, visitor: (node: any, ancestors: any[]) => unknown) => void; SKIP: string };
  DOMPurify = d as unknown as typeof DOMPurify;

  // 语言注册表：Record<name, LanguageFn>（🔴 2026-08-05 修复：rehype-highlight 的
  // languages 选项是 plain object 映射，传 lowlight 实例会被遍历方法名逐个注册 →
  // 每次渲染抛异常风暴。旧 marked 版 16 语言注册保持一致。）
  const langMap: Record<string, unknown> = {};
  const langs = await Promise.all([
    import('highlight.js/lib/languages/javascript'),
    import('highlight.js/lib/languages/typescript'),
    import('highlight.js/lib/languages/python'),
    import('highlight.js/lib/languages/rust'),
    import('highlight.js/lib/languages/bash'),
    import('highlight.js/lib/languages/json'),
    import('highlight.js/lib/languages/xml'),
    import('highlight.js/lib/languages/css'),
    import('highlight.js/lib/languages/yaml'),
    import('highlight.js/lib/languages/markdown'),
    import('highlight.js/lib/languages/sql'),
    import('highlight.js/lib/languages/go'),
    import('highlight.js/lib/languages/java'),
    import('highlight.js/lib/languages/cpp'),
    import('highlight.js/lib/languages/dockerfile'),
    import('highlight.js/lib/languages/plaintext'),
  ]);
  const langNames = [
    'javascript', 'typescript', 'python', 'rust', 'bash',
    'json', 'xml', 'css', 'yaml', 'markdown',
    'sql', 'go', 'java', 'cpp', 'dockerfile', 'plaintext',
  ];
  langs.forEach((mod: { default?: unknown }, i: number) => {
    if (mod.default) langMap[langNames[i]] = mod.default;
  });

  // ── 插件 1：katex memo（对齐 Hermes katex-memo.ts）──
  // remark-math → remark-rehype 产出 <code class="math-inline|math-display">。
  // LRU 缓存 katex 渲染结果：inline 替换 code 节点；display 上溯替换整个 <pre>
  // （与 rehype-katex 的 pre-walk-up 语义一致）。
  const rehypeKatexMemo = function rehypeKatexMemo() {
    return (tree: unknown) => {
      visitParents(tree, 'element', (node: any, ancestors: any[]) => {
        if (!node || node.tagName !== 'code') return undefined;
        const cls: unknown = node.properties?.className;
        const classes = Array.isArray(cls) ? (cls as unknown[]).filter((c): c is string => typeof c === 'string') : [];
        const isInline = classes.includes('math-inline');
        const isDisplay = classes.includes('math-display');
        if (!isInline && !isDisplay) return undefined;
        const tex = toText(node);
        const key = `${isDisplay ? 'd' : 'i'}:${tex}`;
        let html = mathCache.get(key);
        if (html === undefined) {
          // 🔴 2026-08-18 主题化：错误色改走主题语义红（原硬编码 #cc0000；
          // katex 输出 HTML 字符串，CSS 变量在此生效）
          html = katex.renderToString(tex, { displayMode: isDisplay, throwOnError: false, errorColor: 'var(--ui-red)' });
          mathCache.set(key, html);
          if (mathCache.size > MATH_CACHE_MAX) {
            mathCache.delete(mathCache.keys().next().value as string);
          }
        }
        // display：上溯替换整个 <pre>（对齐 rehype-katex pre-walk-up）
        const container = isDisplay && ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;
        const parent = container ?? ancestors[ancestors.length - 1];
        const target = container ?? node;
        if (!parent || !parent.children) return undefined;
        const idx = parent.children.indexOf(target);
        if (idx < 0) return undefined;
        const parsed = fromHtml(html, { fragment: true }) as { children?: unknown[] };
        const children = (parsed.children ?? [parsed]).filter(Boolean);
        parent.children.splice(idx, 1, ...children);
        return SKIP;
      });
    };
  };

  // ── 插件 2：富围栏占位（mermaid / svg，异步渲染由 StreamBlocks React 层完成）──
  // <pre><code class="language-mermaid|svg"> → <pre class="mermaid-block|svg-block" data-mermaid|data-svg="源码">
  // 流式尾块显示代码占位（data 属性携带源码），落定后提升为图形（对齐 Hermes
  // embeds/registry.tsx 的 LAZY_FENCE 路由：mermaid 懒加载 mermaid.js，svg 走
  // DOMPurify svg profile 硬清洗后内联渲染）。
  const rehypeRichFencePlaceholder = function rehypeRichFencePlaceholder() {
    return (tree: unknown) => {
      visitParents(tree, 'element', (node: any) => {
        if (!node || node.tagName !== 'code') return undefined;
        const cls: unknown = node.properties?.className;
        const classes = Array.isArray(cls) ? (cls as unknown[]).filter((c): c is string => typeof c === 'string') : [];
        const lang = classes
          .map((c) => c.replace(/^language-/, ''))
          .find((c) => c === 'mermaid' || c === 'svg');
        if (!lang) return undefined;
        const codeText = toText(node);
        const pre = node.parent ?? null;
        const target = pre && pre.tagName === 'pre' ? pre : node;
        const parent = target.parent ?? null;
        if (!parent || !parent.children) return undefined;
        const idx = parent.children.indexOf(target);
        if (idx < 0) return undefined;
        const attrName = lang === 'mermaid' ? 'dataMermaid' : 'dataSvg';
        const div = {
          type: 'element',
          tagName: 'pre',
          properties: {
            className: [lang === 'mermaid' ? 'mermaid-block' : 'svg-block'],
            [attrName]: escapeAttr(codeText),
          },
          children: [{
            type: 'element',
            tagName: 'code',
            properties: { className: ['hljs'] },
            children: [{ type: 'text', value: codeText }],
          }],
        };
        parent.children.splice(idx, 1, div);
        return SKIP;
      });
    };
  };

  // ── 插件 3：本地媒体占位（🔴 2026-08-09 对齐 Hermes MarkdownImageContent）──
  // <img src="本地路径">（用户/模型直接写 ![](C:\...)）→ 转 data-media-src 占位：
  // 图片永远不进 markdown 文本流（base64 内联会触发大文本降级/DOMPurify 过滤/
  // 解析卡顿三连，send_local_image 乱码事故根因），由 StreamBlocks 渲染后
  // 异步 resolveMediaSrc() 读文件挂载 img.src。网络/data/blob URL 不受影响。
  // （MEDIA:path 标签不走此管线——MessageBubble 用块级 MediaImage 组件直读，
  //   对齐 Hermes MediaAttachment，见 utils/media.ts extractMediaRefs）
  const rehypeLocalMediaPlaceholder = function rehypeLocalMediaPlaceholder() {
    return (tree: unknown) => {
      visitParents(tree, 'element', (node: any) => {
        if (!node || !node.properties || node.tagName !== 'img') return undefined;
        const src: unknown = node.properties?.src;
        if (typeof src !== 'string' || src === '') return undefined;
        if (/^(https?:|data:|#|\/\/)/i.test(src)) return undefined;
        // 本地路径（C:\... / /home/... / 相对路径）→ 占位，渲染后异步加载
        node.properties['data-media-src'] = src;
        node.properties['src'] = undefined;
        node.properties['alt'] = node.properties['alt'] ?? src;
        return undefined;
      });
    };
  };

  // 构建两套 processor（高亮版 / 无高亮版，流式尾块延迟高亮）
  // allowDangerousHtml：保留 LLM 输出中的原始 HTML（与旧 marked 行为一致），
  // 最终经 DOMPurify 清洗（安全模型不变）。
  const build = (withHighlight: boolean) => {
    let p = (unified as unknown as (...plugins: unknown[]) => any)()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkMath, { singleDollarTextMath: true })
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeRichFencePlaceholder)
      .use(rehypeKatexMemo)
      .use(rehypeLocalMediaPlaceholder);
    if (withHighlight) {
      p = p.use(rehypeHighlight, { languages: langMap, detect: true });
    }
    p = p.use(rehypeStringify, { allowDangerousHtml: true });
    return p as AnyProcessor;
  };

  processorHi = build(true);
  processorPlain = build(false);
  depsReady = true;
}

function escapeHtml(text: string): string {
  const span = document.createElement('span');
  span.textContent = text;
  return span.innerHTML;
}

/** HTML attribute 安全转义（escapeHtml 用 textContent 不转义引号，不能用于 attribute） */
function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 给 HTML 中的 <pre><code> 添加代码卡片（header：语言标签 + 复制按钮）
 * — 对齐 Hermes CodeCard：卡片化容器 + 语言标识，复制按钮进 header。
 * 语言从 <code class="language-xxx"> 提取（unified 输出 class，非 data-lang）。
 * mermaid 占位 pre（class="mermaid-block"）同样被卡片化（无语言标签），
 * 渲染成功后由 StreamBlocks 整体替换为 SVG。
 */
function addCopyButtons(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;
  const pres = container.querySelectorAll('pre');
  for (const pre of pres) {
    const codeEl = pre.querySelector('code');
    const lang = extractLanguage(codeEl);

    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';
    pre.parentNode!.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    // header：语言标签（有 lang 时）+ 复制按钮
    const header = document.createElement('div');
    header.className = 'code-block-header';
    if (lang) {
      const langSpan = document.createElement('span');
      langSpan.className = 'code-lang';
      langSpan.textContent = lang;
      header.appendChild(langSpan);
    }
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = '复制';
    btn.onclick = () => {
      const code = pre.querySelector('code') || pre;
      navigator.clipboard.writeText(code.textContent || '').then(() => {
        btn.textContent = '已复制';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = '复制';
          btn.classList.remove('copied');
        }, 1500);
      });
    };
    header.appendChild(btn);
    wrapper.insertBefore(header, pre);
  }
  return container.innerHTML;
}

/** 从 code class 提取语言名（unified/rehype-highlight 输出 language-xxx） */
function extractLanguage(codeEl: Element | null): string {
  if (!codeEl) return '';
  for (const cls of Array.from(codeEl.classList)) {
    if (cls.startsWith('language-')) {
      return cls.slice('language-'.length);
    }
  }
  return '';
}

/**
 * 渲染 Markdown → 安全 HTML（unified/rehype 管线 + 代码高亮 + 公式 + 复制按钮）
 *
 * @param opts.highlight 代码高亮开关（默认 true）。流式尾块传 false 延迟高亮
 *   （对齐 Hermes Shiki defer={isStreaming}）—— 流式中代码块先渲染纯文本
 *   （class 结构一致 → 落定高亮无布局突变），避免大代码块每 flush 全量高亮卡顿。
 */
export function renderMarkdown(text: string, opts: { highlight?: boolean } = {}): string {
  if (!depsReady || !processorHi || !processorPlain) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
  const processor = (opts.highlight ?? true) ? processorHi : processorPlain;
  try {
    const vfile = processor.processSync(text);
    const raw = vfile.toString();
    const safe = DOMPurify
      ? DOMPurify!.sanitize(raw, {
          ADD_ATTR: ['target'],
          ADD_URI_SAFE_ATTR: ['src'],
          // 🔴 2026-08-09 修复（send_local_image 破图）：DOMPurify 默认 URI 白名单
          // 不含 data: → resolve_media 输出的 data:image/... 内联图片 src 被剥掉。
          // 仅放行 data:image/（图片 base64），其它 data: 仍拦截。
          ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|data:image\/|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
        })
      : raw;
    return addCopyButtons(safe);
  } catch {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
}

export function isDepsReady(): boolean {
  return depsReady;
}

// ────────────────────────────────────────────────────────────────
// 流式块渲染工具（对齐 Hermes Streamdown 的块数组 + remend-tail 精神）
// ────────────────────────────────────────────────────────────────

/**
 * 统计子串出现次数（跳过 \\ 转义）。用于尾部未闭合标记检测。
 */
function countUnescaped(text: string, needle: string): number {
  let count = 0;
  let i = 0;
  while (i < text.length) {
    const idx = text.indexOf(needle, i);
    if (idx === -1) break;
    // 被奇数个反斜杠转义则跳过
    let slashes = 0;
    for (let j = idx - 1; j >= 0 && text[j] === '\\'; j--) slashes++;
    if (slashes % 2 === 0) count++;
    i = idx + needle.length;
  }
  return count;
}

/**
 * 单换行折叠（对齐 LLM 输出习惯 + Hermes 的 p 内换行折叠语义）
 *
 * 问题背景：中文 LLM 输出常一行一句（每句后单换行）。CommonMark 对行首块语法
 * （- / # / > / 数字. / 表格 | 等）会强制拆块 → “一句完整的话从中间断开”。
 *
 * 处理：fence 感知地遍历行——单换行（非空行分隔）且下一行**不是**块语法开头 →
 * 折叠为空格（句子接回一行）；下一行是块语法开头（真列表/标题/引用/表格）→ 保留换行。
 *
 * 流式安全性：折叠是确定性的，追加式文本变化 → 折叠结果连续平滑，无“接回去”跳动
 * （未折叠前单行文本就是一行，折叠后仍是一行）。
 */
const BLOCK_START_RE = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|[-+*](?:[ \t]|$)|[0-9]{1,9}[.)](?:[ \t]|$)|>(?:[ \t]|$)|```|~~~|\|)/;
const HR_RE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;

function isBlockStartLine(line: string): boolean {
  return BLOCK_START_RE.test(line) || HR_RE.test(line);
}

export function mergeSingleNewlines(text: string): string {
  if (!text.includes('\n')) return text;

  const lines = text.split('\n');
  const out: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceRun = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;
    const first = trimmed[0];
    const isFenceMarker = (first === '`' || first === '~') && indent <= 3;

    if (isFenceMarker) {
      let run = 0;
      while (run < trimmed.length && trimmed[run] === first) run++;
      if (run >= 3) {
        if (!inFence) {
          inFence = true;
          fenceChar = first;
          fenceRun = run;
        } else if (first === fenceChar && run >= fenceRun && trimmed.slice(run).trim() === '') {
          inFence = false;
        }
      }
    }

    out.push(line);
    if (i === lines.length - 1) break;

    const next = lines[i + 1];
    // 保留换行：fence 内 / fence 标记行后 / 当前行是块语法行（列表项/标题/引用/表格，
    // 防后续行被吸入块内）/ 空行分隔 / 下一行块语法行首；
    // 其余单换行折叠为空格（句子接回一行）。闭合 fence 行后的换行必须保留，
    // 否则 ``` 后文 同行 → 解析器认为 fence 未闭合 → 吞掉后续内容。
    if (!isFenceMarker && !inFence && line.trim() !== '' && !isBlockStartLine(line) && next.trim() !== '' && !isBlockStartLine(next)) {
      out.push(' ');
    } else {
      out.push('\n');
    }
  }

  return out.join('');
}

/**
 * 裸 URL 自动链接（对齐 Hermes preprocessMarkdown 的 RAW_URL_RE）— fence 感知：
 * 只处理代码 fence 外的文本，代码块内的 URL 保持字面（避免 < > 泄漏到代码显示）。
 * 包裹成 <url> autolink 语法（CommonMark/GFM 支持），尾部标点剥离。
 * 前置要求空白/行首/开括号（不误伤 [text](url) 里的 URL）。
 */
const RAW_URL_RE = /(^|[\s(（【\[])(https?:\/\/[^\s<>"'`*]+?)(?=[\s.,;:!?)\]）】。，；：！？]|$)/g;

export function autolinkOutsideFences(text: string): string {
  if (!/https?:\/\//.test(text)) return text;

  let inFence = false;
  let fenceChar = '';
  let fenceRun = 0;
  const lines = text.split('\n');
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;
    const first = trimmed[0];
    const isFenceMarker = (first === '`' || first === '~') && indent <= 3;

    if (isFenceMarker) {
      let run = 0;
      while (run < trimmed.length && trimmed[run] === first) run++;
      if (run >= 3) {
        if (!inFence) {
          inFence = true;
          fenceChar = first;
          fenceRun = run;
        } else if (first === fenceChar && run >= fenceRun && trimmed.slice(run).trim() === '') {
          inFence = false;
        }
      }
    }

    out.push(inFence ? line : line.replace(RAW_URL_RE, '$1<$2>'));
  }

  return out.join('\n');
}

/**
 * 尾部修复：只修复文本尾部未闭合的构造，避免流式中间态被解析器误解析。
 * 对齐 Hermes tailBoundedRemend 的“修复只发生在尾部窗口”思想，覆盖面对齐 remend：
 * - 未闭合代码 fence（``` 或 ~~~ 只开未关）→ 补一个闭合 fence
 * - fence 外未闭合行内 code（奇数个反引号）→ 补一个 `
 * - fence 外未闭合强调（奇数个 ** / __）→ 补闭合标记
 * - fence 外未闭合删除线（奇数个 ~~）→ 补 ~~
 * - fence 外未闭合链接 [text](url → 补 )
 *
 * 修复只作用于本次渲染副本（repair 后进 split/render），不污染 store 里的真实文本。
 */
export function repairMarkdownTail(text: string): string {
  if (!text) return text;

  // 逐行扫描 fence 状态（``` 或 ~~~，≤3 空格缩进），同时收集 fence 外文本片段
  let inFence = false;
  let fenceChar = '';
  let fenceRun = 0;
  const lines = text.split('\n');
  const outside: string[] = [];
  let inFenceAtEnd = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;
    const first = trimmed[0];
    const isFenceMarker = (first === '`' || first === '~') && indent <= 3;

    if (isFenceMarker) {
      let run = 0;
      while (run < trimmed.length && trimmed[run] === first) run++;
      if (run >= 3) {
        if (!inFence) {
          inFence = true;
          fenceChar = first;
          fenceRun = run;
        } else if (first === fenceChar && run >= fenceRun && trimmed.slice(run).trim() === '') {
          inFence = false;
        }
      }
    }
    if (i === lines.length - 1) inFenceAtEnd = inFence;
    if (!inFence) outside.push(line);
  }

  if (inFenceAtEnd) {
    // 尾部仍在 fence 内 → 补闭合 marker（与开启 marker 等长）
    return text + '\n' + fenceChar.repeat(fenceRun) + '\n';
  }

  const outsideText = outside.join('\n');
  let repaired = text;

  // 反引号（奇数个未闭合 → 补一个）
  if (countUnescaped(outsideText, '`') % 2 === 1) repaired += '`';
  // 强调 **（奇数 → 补闭合）
  if (countUnescaped(outsideText, '**') % 2 === 1) repaired += '**';
  // 强调 __（奇数 → 补闭合）
  if (countUnescaped(outsideText, '__') % 2 === 1) repaired += '__';
  // 删除线 ~~（奇数 → 补闭合）
  if (countUnescaped(outsideText, '~~') % 2 === 1) repaired += '~~';
  // 链接 [text](url 尾部未闭合（无右括号）→ 补 )
  if (/\[[^\]]*\]\([^)\n]*$/.test(outsideText)) repaired += ')';

  return repaired;
}

/**
 * fence 感知的块切分：按空行（\n\n+）切分 markdown 块。
 * 代码 fence 内部的空行不切分（fence 保持为单块）。
 *
 * 返回块数组，最后一块是“活动块”——流式 flush 时只有它持续增长，
 * 其余块视为已闭合稳定块（React memo 跳过重渲染，对齐 Streamdown 的
 * parseMarkdownIntoBlocks 分块模型）。
 */
export function splitMarkdownBlocks(text: string): string[] {
  if (!text) return [];

  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceRun = 0;

  const flush = () => {
    if (current.length > 0) {
      blocks.push(current.join('\n'));
      current = [];
    }
  };

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;
    const first = trimmed[0];
    const isFenceMarker = (first === '`' || first === '~') && indent <= 3;

    if (isFenceMarker) {
      let run = 0;
      while (run < trimmed.length && trimmed[run] === first) run++;
      if (run >= 3) {
        if (!inFence) {
          inFence = true;
          fenceChar = first;
          fenceRun = run;
        } else if (first === fenceChar && run >= fenceRun && trimmed.slice(run).trim() === '') {
          inFence = false;
        }
      }
    }

    const isEmpty = trimmed === '';
    if (isEmpty && !inFence) {
      flush();
    } else {
      current.push(line);
    }
  }
  flush();

  return blocks;
}

// ── 块解析 LRU 缓存（对齐 Hermes blockCache）──
// 同一文本（如虚拟化滚动重新挂载、多 surface 同内容）重复 split 时直接命中，
// 零正确性风险（同输入 → 同输出）。流式尾块增长天然 miss（每 flush 新字符串）——
// 这是不可避免的解析成本，与 Hermes 的缓存策略一致。
const BLOCK_CACHE_MAX = 64;
const BLOCK_CACHE_MIN_LENGTH = 1024;
const blockCache = new Map<string, string[]>();

export function splitMarkdownBlocksCached(text: string): string[] {
  if (text.length < BLOCK_CACHE_MIN_LENGTH) {
    return splitMarkdownBlocks(text);
  }

  const hit = blockCache.get(text);
  if (hit) {
    // 刷新 recency（Map 迭代序 = 插入序）
    blockCache.delete(text);
    blockCache.set(text, hit);
    return hit;
  }

  const blocks = splitMarkdownBlocks(text);
  blockCache.set(text, blocks);

  if (blockCache.size > BLOCK_CACHE_MAX) {
    blockCache.delete(blockCache.keys().next().value as string);
  }

  return blocks;
}
