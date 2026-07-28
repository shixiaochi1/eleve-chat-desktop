/**
 * DeepSeek 嵌入注入脚本 — 通过 Tauri initialization_script 在页面加载时自动执行
 *
 * 目标：隐藏 DeepSeek 自身的侧边栏（会话历史）和顶栏（Logo/模型选择器），
 *       只保留聊天消息区 + 输入区，视觉上像 Eleve 原生模块。
 *
 * 维护：DeepSeek 改版时只需更新此文件的选择器，不动主代码。
 *       选择器策略：优先结构语义（aria-label / data-testid / 标签层级），
 *       次选类名模式匹配（[class*="sidebar"]），最后 MutationObserver 兜底。
 */
(function () {
  'use strict';

  // ── 登录页不注入（保留完整登录表单） ──
  const path = window.location.pathname;
  const isLoginPage = path.includes('sign_in') || path.includes('login') || path.includes('register');
  if (isLoginPage) return;

  // ═══════════════════════════════════════════════════════════
  // CSS 注入
  // ═══════════════════════════════════════════════════════════
  const STYLE_ID = 'eleve-deepseek-inject';

  /** 主题 CSS：由 Rust 侧通过全局变量传入（见 lib.rs init_script） */
  const THEME_CSS = window.__ELEVE_DEEPSEEK_THEME__ || '';
  /** 背板色：由 Rust 侧传入，填充 --ev-backboard 变量 */
  const BACKBOARD = window.__ELEVE_DEEPSEEK_BG__ || 'rgb(10,22,40)';

  function injectCSS() {
    if (document.getElementById(STYLE_ID)) return;
    // document-start 时 head 可能尚不存在，等 DOM 就绪
    const host = document.head || document.documentElement;
    if (!host) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* ── 背板色变量（html 画布底色 = 四角颜色） ── */
      :root { --ev-backboard: ${BACKBOARD}; }
      /* ── 主题适配（来自 deepseek-theme.css，圆角核心） ── */
      ${THEME_CSS}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════
  // JS 注入 — MutationObserver 兜底
  // ═══════════════════════════════════════════════════════════

  /** 需要隐藏的元素的匹配规则（临时清空，先隔离验证圆角） */
  const HIDE_PATTERNS = [];

  /** 需要按文本内容隐藏的元素（临时清空，先隔离验证圆角） */
  const HIDE_TEXTS = [];

  function hideEl(el) {
    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('visibility', 'hidden', 'important');
    el.style.setProperty('height', '0', 'important');
    el.style.setProperty('overflow', 'hidden', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
  }

  /** 按文本内容隐藏免责声明容器 */
  function hideDisclaimer(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    const toHide = [];
    while ((node = walker.nextNode())) {
      const txt = (node.textContent || '').trim();
      if (HIDE_TEXTS.some(t => txt.includes(t))) {
        // 向上找到合适的容器（最多 3 层，避免误伤整个页面）
        let el = node.parentElement;
        for (let i = 0; i < 3 && el && el.parentElement; i++) {
          el = el.parentElement;
        }
        if (el) toHide.push(el);
      }
    }
    toHide.forEach(hideEl);
  }

  function shouldHide(el) {
    if (!(el instanceof HTMLElement)) return false;
    const cls = el.className;
    if (typeof cls !== 'string') return false;
    return HIDE_PATTERNS.some(p => p.test(cls));
  }

  function sweepAndHide(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if (shouldHide(node)) {
        node.style.setProperty('display', 'none', 'important');
        node.style.setProperty('visibility', 'hidden', 'important');
        node.style.setProperty('width', '0', 'important');
        node.style.setProperty('height', '0', 'important');
        node.style.setProperty('overflow', 'hidden', 'important');
        node.style.setProperty('pointer-events', 'none', 'important');
      }
    }
  }

  // ── 初始化 ──
  function init() {
    injectCSS();
    sweepAndHide(document.body);
    hideDisclaimer(document.body);

    // MutationObserver：捕获 React 动态渲染的新元素
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLElement) {
            if (shouldHide(node)) {
              node.style.setProperty('display', 'none', 'important');
              node.style.setProperty('visibility', 'hidden', 'important');
              node.style.setProperty('width', '0', 'important');
              node.style.setProperty('height', '0', 'important');
              node.style.setProperty('overflow', 'hidden', 'important');
              node.style.setProperty('pointer-events', 'none', 'important');
            }
            // 子树也扫一遍（React 可能一次挂载整棵子树）
            sweepAndHide(node);
            hideDisclaimer(node);
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── 等待 DOM 就绪 ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── SPA 路由变化时重新注入（DeepSeek 是 React SPA） ──
  let lastPath = window.location.pathname;
  setInterval(() => {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      // 如果导航到了登录页，移除注入
      if (lastPath.includes('sign_in') || lastPath.includes('login')) {
        const el = document.getElementById(STYLE_ID);
        if (el) el.remove();
        return;
      }
      // 否则重新注入
      injectCSS();
      sweepAndHide(document.body);
    }
  }, 1000);
})();
