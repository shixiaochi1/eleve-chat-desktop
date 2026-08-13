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

  // ── 浮动关闭按钮（登录页也必须能关，故在 isLoginPage 判断之前注入）──
  function createCloseButton() {
    if (!document.body || document.getElementById('eleve-deepseek-close')) return;
    const btn = document.createElement('div');
    btn.id = 'eleve-deepseek-close';
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', '关闭 DeepSeek');
    btn.title = '关闭';
    btn.textContent = '✕';
    // 内联样式（防被站点 CSS 覆盖）；半透明黑底白叉，任意主题可见
    btn.style.cssText =
      'position:fixed;top:10px;right:10px;z-index:2147483647;width:28px;height:28px;' +
      'border-radius:50%;display:flex;align-items:center;justify-content:center;' +
      'font-size:13px;line-height:1;color:#fff;background:rgba(0,0,0,0.45);' +
      'cursor:pointer;user-select:none;border:1px solid rgba(255,255,255,0.18);' +
      'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);' +
      'transition:background .15s;font-family:system-ui,sans-serif;';
    btn.addEventListener('mouseenter', () => (btn.style.background = 'rgba(0,0,0,0.65)'));
    btn.addEventListener('mouseleave', () => (btn.style.background = 'rgba(0,0,0,0.45)'));
    btn.addEventListener('click', async () => {
      try {
        // __TAURI_INTERNALS__ 在所有 webview 注入（无需 withGlobalTauri）；
        // 远程页面能否调用由 ACL capability（deepseek.json）控制
        await window.__TAURI_INTERNALS__.invoke('deepseek_webview_close');
      } catch (err) {
        console.error('[DeepSeek] close invoke failed:', err);
      }
    });
    document.body.appendChild(btn);
  }

  // ── 登录页不注入主题（保留完整登录表单），但保留关闭按钮 ──
  const path = window.location.pathname;
  const isLoginPage = path.includes('sign_in') || path.includes('login') || path.includes('register');

  // ═══════════════════════════════════════════════════════════
  // CSS 注入
  // ═══════════════════════════════════════════════════════════
  const STYLE_ID = 'eleve-deepseek-inject';

  /** 主题 CSS：由 Rust 侧通过全局变量传入（见 lib.rs init_script） */
  const THEME_CSS = window.__ELEVE_DEEPSEEK_THEME__ || '';
  /** 背板色：由 Rust 侧传入，填充 --ev-backboard 变量 */
  const BACKBOARD = window.__ELEVE_DEEPSEEK_BG__ || 'rgb(10,22,40)';

  /**
   * JS 直接强制圆角（v4）：html + body 双重圆角，inline style + !important
   * 优先级最高、不依赖 style 标签（防站点 CSS/SPA 动态样式干扰）。
   * 🔴 四角颜色必须 = Eleve 背板色（BACKBOARD，与 WebView background_color
   * 同源、与主窗口背景一致）→ 四角与周围 UI 融合，WebView 边缘才呈现圆角。
   * （改成页面背景色 = 方向错误：四角与页面融为一体，方角矩形依旧可见）
   */
  function applyRoundedCorners() {
    const root = document.documentElement;
    const body = document.body;
    if (body) {
      body.style.setProperty('border-radius', '12px', 'important');
      body.style.setProperty('overflow', 'clip', 'important');
    }
    root.style.setProperty('border-radius', '12px', 'important');
    root.style.setProperty('overflow', 'clip', 'important');
    root.style.setProperty('background', BACKBOARD, 'important');
  }

  function injectCSS() {
    if (document.getElementById(STYLE_ID)) return;
    // document-start 时 head 可能尚不存在，等 DOM 就绪
    const host = document.head || document.documentElement;
    if (!host) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* ── 背板色变量（html 画布底色 = 四角颜色 = Eleve 背板色，与主窗口融合） ── */
      :root { --ev-backboard: ${BACKBOARD}; }
      /* ── 圆角核心（deepseek-theme.css：html+body 圆角 + clip） ── */
      ${THEME_CSS}
    `;
    (document.head || document.documentElement).appendChild(style);
    // JS 强制注入（双保险）
    applyRoundedCorners();
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
    // 关闭按钮优先（登录页也必须能关）
    createCloseButton();
    if (isLoginPage) return;
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

  // ── 站点 CSS 完全加载后刷新圆角/背景色（DOMContentLoaded 时 SPA 样式可能未就绪） ──
  window.addEventListener('load', () => {
    createCloseButton();
    applyRoundedCorners();
  });

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
