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
  marked!.setOptions({ breaks: true, gfm: true });
  // 🔴 marked v5+ 删除了 highlight 选项（项目用 v18，旧写法被静默忽略 → 高亮从未生效）
  // 改用 renderer 扩展接 hljs（v13+ token 对象签名）
  marked!.use({
    renderer: {
      code(token: { text: string; lang?: string }) {
        const lang = (token.lang || '').trim();
        let body: string;
        try {
          body = lang && hljs!.getLanguage(lang)
            ? hljs!.highlight(token.text, { language: lang }).value
            : hljs!.highlightAuto(token.text).value;
        } catch {
          body = escapeHtml(token.text);
        }
        return `<pre><code class="hljs">${body}</code></pre>`;
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
 * 给 HTML 中的 <pre><code> 添加复制按钮
 */
function addCopyButtons(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;
  const pres = container.querySelectorAll("pre");
  for (const pre of pres) {
    const wrapper = document.createElement("div");
    wrapper.className = "code-block-wrapper";
    pre.parentNode!.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);
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
    wrapper.appendChild(btn);
  }
  return container.innerHTML;
}

/**
 * 渲染 Markdown → 安全 HTML（含代码高亮 + 复制按钮）
 */
export function renderMarkdown(text: string): string {
  if (!depsReady) {
    return escapeHtml(text).replace(/\n/g, "<br>");
  }
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
  }
}

export function isDepsReady(): boolean {
  return depsReady;
}
