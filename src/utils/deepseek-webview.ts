/**
 * DeepSeek 子 WebView 生命周期管理
 *
 * 架构：
 *   - 创建：通过 Rust command `create_deepseek_webview`（带 initialization_script 注入）
 *   - 显隐/定位：通过 JS API `Webview`（show/hide/setPosition/setSize/setFocus）
 *   - 位置同步：ResizeObserver 监听锚点 + window resize 兜底
 *
 * 状态机：未创建 → 创建(visible) ⇄ 隐藏(hidden)
 */

import { Webview } from '@tauri-apps/api/webview';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';

const LABEL = 'deepseek-embed';

// ── 模块级状态 ──
let webview: Webview | null = null;
let visible = false;
let anchorEl: HTMLElement | null = null;
let resizeObserver: ResizeObserver | null = null;
let windowResizeHandler: (() => void) | null = null;

/**
 * 读取 WebView 背后区域的背景色（RGB）
 *
 * 颜色匹配法：WebView2 子窗口是独立 HWND，不支持逐像素透明。
 * 把 WebView 原生底色 + html 画布底色都设为 Eleve 背板色，
 * body 圆角裁掉的四角露出背板色 → 视觉无缝融合。
 *
 * 背板色来源：Eleve 的 --ui-bg-backboard 变量（color-mix 派生），
 * 用探针元素解析成实际 rgb 值。
 */
function getBackboardRGB(): { r: number; g: number; b: number } {
  const parse = (color: string): { r: number; g: number; b: number } | null => {
    const m = color.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/);
    if (!m) return null;
    const r = Number(m[1]), g = Number(m[2]), b = Number(m[3]);
    const a = m[4] !== undefined ? Number(m[4]) : 1;
    if (a <= 0) return null; // 全透明无效
    return { r, g, b };
  };

  // 探针法：把 CSS 变量（可能是 color-mix）解析成实际 rgb
  const probeVar = (varName: string): { r: number; g: number; b: number } | null => {
    const probe = document.createElement('div');
    probe.style.display = 'none';
    probe.style.background = `var(${varName})`;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return parse(resolved);
  };

  // 优先 Eleve 背板变量，逐级降级
  for (const v of ['--ui-bg-backboard', '--ui-bg-chrome', '--ui-bg-sidebar']) {
    const rgb = probeVar(v);
    if (rgb) return rgb;
  }
  // 兜底：body 背景
  const bodyRGB = parse(getComputedStyle(document.body).backgroundColor);
  if (bodyRGB) return bodyRGB;
  // 最终兜底：ocean 主题深蓝背板
  return { r: 10, g: 22, b: 40 };
}

/**
 * 获取锚点元素的窗口绝对坐标（逻辑像素）
 *
 * Eleve 用 DOM 自定义标题栏（非系统标题栏），视口原点 = 窗口原点，
 * 所以 getBoundingClientRect() 的坐标可以直接用于 WebView 定位。
 */
function getAnchorRect(el: HTMLElement): { x: number; y: number; w: number; h: number } {
  const rect = el.getBoundingClientRect();
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}

/** 同步 WebView 位置到锚点 */
async function syncPosition() {
  if (!webview || !visible || !anchorEl) return;
  try {
    const { x, y, w, h } = getAnchorRect(anchorEl);
    await webview.setPosition(new LogicalPosition(x, y));
    await webview.setSize(new LogicalSize(w, h));
  } catch {
    // WebView 可能已被销毁，静默处理
  }
}

/** 启动位置同步监听 */
function startSync() {
  if (!anchorEl) return;

  // ResizeObserver：锚点尺寸变化（面板拖动、窗口缩放）
  if (!resizeObserver) {
    resizeObserver = new ResizeObserver(() => {
      if (visible) syncPosition();
    });
  }
  resizeObserver.observe(anchorEl);

  // window resize 兜底（Observer 可能不捕获窗口级变化）
  if (!windowResizeHandler) {
    windowResizeHandler = () => {
      if (visible) syncPosition();
    };
    window.addEventListener('resize', windowResizeHandler);
  }
}

/** 停止位置同步监听 */
function stopSync() {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (windowResizeHandler) {
    window.removeEventListener('resize', windowResizeHandler);
    windowResizeHandler = null;
  }
}

/**
 * 切换 DeepSeek WebView 显隐
 *
 * @param anchor 锚点元素（.chat-card），WebView 精确覆盖此区域
 * @returns 新的可见状态
 */
export async function toggleDeepSeek(anchor: HTMLElement): Promise<boolean> {
  anchorEl = anchor;

  if (visible) {
    // ── 隐藏 ──
    visible = false;
    stopSync();
    if (webview) {
      try {
        await webview.hide();
      } catch { /* 已销毁 */ }
    }
    return false;
  }

  // ── 显示 ──
  const { x, y, w, h } = getAnchorRect(anchor);

  if (!webview) {
    // 首次创建：走 Rust command（带注入脚本 + 背板色）
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const { r, g, b } = getBackboardRGB();
      await invoke('create_deepseek_webview', { x, y, width: w, height: h, bgR: r, bgG: g, bgB: b });
      // 获取 JS 端 Webview 实例（Rust 侧已创建，用 getByLabel 获取）
      webview = await Webview.getByLabel(LABEL);
    } catch (err) {
      console.error('[DeepSeek] create failed:', err);
      return false;
    }
  } else {
    // 复用：show + 重新定位
    try {
      await webview.show();
      await webview.setPosition(new LogicalPosition(x, y));
      await webview.setSize(new LogicalSize(w, h));
      await webview.setFocus();
    } catch {
      // WebView 可能已被销毁，重建
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const { r, g, b } = getBackboardRGB();
        await invoke('create_deepseek_webview', { x, y, width: w, height: h, bgR: r, bgG: g, bgB: b });
        webview = await Webview.getByLabel(LABEL);
      } catch (err) {
        console.error('[DeepSeek] recreate failed:', err);
        return false;
      }
    }
  }

  visible = true;
  startSync();
  return true;
}

/**
 * 强制隐藏（面板切换 / grid 模式切换时调用）
 */
export async function hideDeepSeek(): Promise<void> {
  if (!visible) return;
  visible = false;
  stopSync();
  if (webview) {
    try {
      await webview.hide();
    } catch { /* 已销毁 */ }
  }
}

/**
 * 查询当前可见状态
 */
export function isDeepSeekVisible(): boolean {
  return visible;
}
