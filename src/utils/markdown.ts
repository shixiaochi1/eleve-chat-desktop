/**
 * Markdown 渲染 + 代码高亮
 * 需要 marked, highlight.js (核心+常用语言), DOMPurify 已在全局可用
 */
let marked: {
  setOptions(opts: Record<string, unknown>): void;
  use(extension: Record<string, unknown>): void;
  parse(text: string, ...args: unknown[]): string;
} | null = null;
let hljs: { registerLanguage(name: string, lang: unknown): void; getLanguage(name: string): unknown; highlight(code: string, options: { language: string }): { value: string }; highlightAuto(code: string): { value: string } } | null = null;
let DOMPurify: { sanitize(html: string, opts?: Record<string, unknown>): string } | null = null;
let depsReady = false;

// 代码高亮 per-parse 开关（对齐 Hermes Shiki defer）：marked renderer 在 use() 时
// 捕获闭包，无法 per-call 传参，故用模块级标志 + renderMarkdown 内同步切换（finally 恢复）。
let highlightEnabled = true;

export async function loadMarkdownDeps(): Promise<void> {
  if (depsReady) return;
  const [m, h, d] = await Promise.all([
    import("marked"),
    import("highlight.js/lib/core"),
    import("dompurify"),
  ]);
  marked = m.marked;
  // Core hljs (仅 ~5KB) + 按需注册常用语言
  hljs = h.default;
  const langs = await Promise.all([
    import("highlight.js/lib/languages/javascript"),
    import("highlight.js/lib/languages/typescript"),
    import("highlight.js/lib/languages/python"),
    import("highlight.js/lib/languages/rust"),
    import("highlight.js/lib/languages/bash"),
    import("highlight.js/lib/languages/json"),
    import("highlight.js/lib/languages/xml"),
    import("highlight.js/lib/languages/css"),
    import("highlight.js/lib/languages/yaml"),
    import("highlight.js/lib/languages/markdown"),
    import("highlight.js/lib/languages/sql"),
    import("highlight.js/lib/languages/go"),
    import("highlight.js/lib/languages/java"),
    import("highlight.js/lib/languages/cpp"),
    import("highlight.js/lib/languages/dockerfile"),
    import("highlight.js/lib/languages/plaintext"),
  ]);
  const langNames = [
    "javascript", "typescript", "python", "rust", "bash",
    "json", "xml", "css", "yaml", "markdown",
    "sql", "go", "java", "cpp", "dockerfile", "plaintext",
  ];
  langs.forEach((mod: { default?: unknown }, i: number) => {
    if (mod.default) hljs!.registerLanguage(langNames[i], mod.default);
  });
  DOMPurify = d.default;
  // 🔴 对齐 Hermes（streamdown/marked 默认）：breaks: false — 单换行折叠为空格，
  // 只有空行（\n\n）才分段落。旧值 breaks: true 把 LLM 输出里的每个单换行
  // 渲染成 <br>，导致“几个字占一行 / 一句话分多行”的段落破碎。
  marked!.setOptions({ breaks: false, gfm: true });
  // 🔴 marked v5+ 删除了 highlight 选项（项目用 v18，旧写法被静默忽略 → 高亮从未生效）
  // 改用 renderer 扩展接 hljs（v13+ token 对象签名）
  marked!.use({
    renderer: {
      code(token: { text: string; lang?: string }) {
        const lang = (token.lang || '').trim();
        let body: string;
        if (!highlightEnabled) {
          // 流式延迟高亮：只输出转义纯文本，class 保留（落定后高亮无布局变化）
          body = escapeHtml(token.text);
        } else {
          try {
            body = lang && hljs!.getLanguage(lang)
              ? hljs!.highlight(token.text, { language: lang }).value
              : hljs!.highlightAuto(token.text).value;
          } catch {
            body = escapeHtml(token.text);
          }
        }
        // data-lang 供 addCopyButtons 生成语言标签卡片（对齐 Hermes CodeCard header）
        const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
        return `<pre${langAttr}><code class="hljs">${body}</code></pre>`;
      },
    },
  });
  depsReady = true;
}

function escapeHtml(text: string): string {
  const span = document.createElement("span");
  span.textContent = text;
  return span.innerHTML;
}

/**
 * 给 HTML 中的 <pre><code> 添加代码卡片（header：语言标签 + 复制按钮）
 * — 对齐 Hermes CodeCard：卡片化容器 + 语言标识，复制按钮进 header。
 */
function addCopyButtons(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;
  const pres = container.querySelectorAll("pre");
  for (const pre of pres) {
    const lang = pre.getAttribute("data-lang") || "";
    pre.removeAttribute("data-lang");

    const wrapper = document.createElement("div");
    wrapper.className = "code-block-wrapper";
    pre.parentNode!.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    // header：语言标签（有 lang 时）+ 复制按钮
    const header = document.createElement("div");
    header.className = "code-block-header";
    if (lang) {
      const langSpan = document.createElement("span");
      langSpan.className = "code-lang";
      langSpan.textContent = lang;
      header.appendChild(langSpan);
    }
    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.textContent = "复制";
    btn.onclick = () => {
      const code = pre.querySelector("code") || pre;
      navigator.clipboard.writeText(code.textContent || '').then(() => {
        btn.textContent = "已复制";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = "复制";
          btn.classList.remove("copied");
        }, 1500);
      });
    };
    header.appendChild(btn);
    wrapper.insertBefore(header, pre);
  }
  return container.innerHTML;
}

/**
 * 渲染 Markdown → 安全 HTML（含代码高亮 + 复制按钮）
 *
 * @param opts.highlight 代码高亮开关（默认 true）。流式尾块传 false 延迟高亮
 *   （对齐 Hermes SyntaxHighlighter defer={isStreaming}）—— 流式中代码块
 *   先渲染转义纯文本（class 结构一致 → 落定高亮无布局突变），
 *   避免大代码块每 flush 全量 hljs 高亮导致卡顿。
 */
export function renderMarkdown(text: string, opts: { highlight?: boolean } = {}): string {
  if (!depsReady) {
    return escapeHtml(text).replace(/\n/g, "<br>");
  }
  // highlightEnabled 是模块级开关（marked renderer 在 use() 时捕获闭包），
  // 同步调用期间临时切换，finally 恢复 —— 无竞态（renderMarkdown 是同步函数）
  const prevHighlight = highlightEnabled;
  if (opts.highlight != null) highlightEnabled = opts.highlight;
  try {
    const raw = marked!.parse(text);
    const safe = DOMPurify
      ? DOMPurify!.sanitize(raw, {
          ADD_ATTR: ["target"],
          ADD_URI_SAFE_ATTR: ["src"],
        })
      : raw;
    return addCopyButtons(safe);
  } catch {
    return escapeHtml(text).replace(/\n/g, "<br>");
  } finally {
    highlightEnabled = prevHighlight;
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
 * 问题背景：中文 LLM 输出常一行一句（每句后单换行）。marked 对行首块语法
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
    // 否则 ``` 后文 同行 → marked 认为 fence 未闭合 → 吞掉后续内容。
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
 * 包裹成 <url> GFM autolink 语法（marked gfm:true 支持），尾部标点剥离。
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
 * 尾部修复：只修复文本尾部未闭合的构造，避免流式中间态被 marked 误解析。
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
