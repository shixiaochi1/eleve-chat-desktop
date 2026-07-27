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

  function injectCSS() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* ── 隐藏侧边栏（会话历史面板） ── */
      [class*="sidebar"],
      [class*="Sidebar"],
      [class*="session-list"],
      [class*="SessionList"],
      [class*="conversation-list"],
      [class*="history-panel"],
      [class*="left-panel"],
      [class*="LeftPanel"],
      [class*="aside"],
      nav[aria-label*="conversation"],
      nav[aria-label*="history"],
      nav[aria-label*="sidebar"] {
        display: none !important;
        width: 0 !important;
        min-width: 0 !important;
        max-width: 0 !important;
        overflow: hidden !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }

      /* ── 隐藏顶栏（Logo + 模型选择器 + 搜索） ── */
      header,
      [class*="header"],
      [class*="Header"],
      [class*="topbar"],
      [class*="TopBar"],
      [class*="top-bar"],
      [class*="navbar"],
      [class*="NavBar"],
      [class*="nav-bar"] {
        display: none !important;
        height: 0 !important;
        min-height: 0 !important;
        max-height: 0 !important;
        overflow: hidden !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }

      /* ── 聊天区全宽 ── */
      [class*="chat-container"],
      [class*="ChatContainer"],
      [class*="chat-main"],
      [class*="ChatMain"],
      [class*="main-content"],
      [class*="MainContent"],
      [class*="chat-area"],
      [class*="ChatArea"],
      main {
        width: 100% !important;
        max-width: 100% !important;
        margin-left: 0 !important;
        padding-left: 0 !important;
      }

      /* ── 侧边栏折叠按钮也隐藏 ── */
      [class*="collapse-btn"],
      [class*="CollapseBtn"],
      [class*="sidebar-toggle"],
      [class*="SidebarToggle"],
      [aria-label*="sidebar"],
      [aria-label*="menu"] {
        display: none !important;
      }

      /* ── 去除页面自身滚动条（由 Eleve 容器控制） ── */
      html, body {
        overflow: hidden !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════
  // JS 注入 — MutationObserver 兜底
  // ═══════════════════════════════════════════════════════════

  /** 需要隐藏的元素的匹配规则 */
  const HIDE_PATTERNS = [
    // 侧边栏
    /sidebar/i, /session.?list/i, /conversation.?list/i,
    /history.?panel/i, /left.?panel/i,
    // 顶栏
    /topbar/i, /top.?bar/i, /navbar/i, /nav.?bar/i,
  ];

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
