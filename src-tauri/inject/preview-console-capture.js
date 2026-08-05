/**
 * Preview webview console 捕获注入脚本（对齐 Hermes Electron webview console-message 事件）
 *
 * 在远程页面 document 创建时（CSP 之前，WebView2 AddScriptToExecuteOnDocumentCreated）
 * 重写 console.log/info/warn/error/debug：
 *   - 参数序列化（对象 JSON / Error.stack），单参 1KB 截断（Rust 侧 4KB 兜底）
 *   - 从调用栈提取 source:line（对齐 Hermes console-message 的 sourceId/line 语义）
 *   - 经 __TAURI_INTERNALS__.invoke 推送 preview_console_push → Rust 缓冲治理
 *   - 保留原生 console 输出（devtools 面板仍可见）
 *
 * __PREVIEW_CONSOLE_LABEL__ 由 Rust 侧创建 webview 时替换为实际 label。
 */
(() => {
  // 🔴 静默降级（2026-08-06 老大反馈噪音）：外部页面无 __TAURI_INTERNALS__
  // （非 Tauri 环境）→ console 捕获不可用是预期行为（Hermes 同款），
  // 不再打印 warn 刷屏（push 内 try/catch 已兜底 undefined 访问）
  const __label = '__PREVIEW_CONSOLE_LABEL__';
  const MAX_LEN = 1024;

  // 参数序列化：Error → stack，对象 → JSON，其余 → String；超长截断
  const fmtArg = (a) => {
    try {
      if (a instanceof Error) return a.stack || String(a);
      if (typeof a === 'object' && a !== null) {
        const s = JSON.stringify(a);
        return s === undefined ? String(a) : s;
      }
      return String(a);
    } catch {
      return String(a);
    }
  };
  const fmt = (...args) => args.map(fmtArg).join(' ').slice(0, MAX_LEN);

  // 从调用栈提取调用 console 的页面位置（对齐 Hermes sourceId:line）
  const srcLine = () => {
    try {
      const lines = (new Error().stack || '').split('\n').slice(2);
      for (const line of lines) {
        const m = line.match(/at\s+(?:.*?\s+\()?(https?:\/\/[^)\s]+):(\d+):(\d+)\)?/);
        if (m) {
          return { source: m[1].split('?')[0], line: Number(m[2]) };
        }
      }
    } catch {}
    return { source: undefined, line: undefined };
  };

  const push = (level, text) => {
    try {
      const { source, line } = srcLine();
      window.__TAURI_INTERNALS__.invoke('preview_console_push', {
        label: __label,
        level,
        text,
        source,
        line,
      });
    } catch {}
  };

  const levels = { log: 0, debug: 0, info: 1, warn: 2, error: 3 };
  for (const name of Object.keys(levels)) {
    const orig = console[name];
    if (typeof orig !== 'function') continue;
    console[name] = (...args) => {
      try {
        push(levels[name], fmt(...args));
      } catch {}
      orig.apply(console, args);
    };
  }
})();
