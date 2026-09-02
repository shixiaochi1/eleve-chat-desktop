/**
 * session-window.ts — 会话独立窗口（对齐 Hermes openSession target='window'）
 *
 * 多窗口模式（WebviewWindow + ?panel= URL 路由）：
 * 新建一个独立窗口渲染指定会话（?panel=session&session_id=<id>&profile=<p>），
 * 不干扰主窗口；重复为同一会话打开 → 聚焦已存在窗口。
 */
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';

const SESSION_WINDOW_PREFIX = 'session-window:';
const DEFAULT_WIDTH = 900;
const DEFAULT_HEIGHT = 680;

/**
 * 打开会话独立窗口；同一会话已存在窗口 → 聚焦
 */
export async function openSessionWindow(sessionId: string, profile?: string): Promise<void> {
  if (!sessionId) return;
  const label = `${SESSION_WINDOW_PREFIX}${sessionId}`;

  // 已存在 → 聚焦并激活（对齐 kanban 模式：重复点击只聚焦，不重复创建）
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    try {
      await existing.setFocus();
      return;
    } catch {
      // 窗口可能已关闭，继续创建新的
    }
  }

  // 计算位置：主窗口右侧（kanban 是左侧；会话窗口放右侧更自然）
  let x = 100;
  let y = 100;
  let mainHeight = DEFAULT_HEIGHT;
  try {
    const mainWindow = getCurrentWindow();
    const pos = await mainWindow.outerPosition();
    const size = await mainWindow.innerSize();
    x = pos.x + size.width + 16;
    y = pos.y;
    mainHeight = size.height;
  } catch {
    // 获取主窗口信息失败，使用默认位置
  }

  const baseUrl = window.location.origin + window.location.pathname;
  const params = new URLSearchParams({ panel: 'session', session_id: sessionId });
  if (profile) params.set('profile', profile);
  const sessionUrl = `${baseUrl}?${params.toString()}`;

  const webviewWindow = new WebviewWindow(label, {
    url: sessionUrl,
    title: '会话 — Eleve',
    width: DEFAULT_WIDTH,
    height: Math.min(mainHeight, DEFAULT_HEIGHT),
    minWidth: 480,
    minHeight: 360,
    x,
    y,
    resizable: true,
    decorations: true,
    center: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    dragDropEnabled: false, // 关闭 Tauri 文件拖放，让 HTML5 drag-and-drop 正常工作
  });

  webviewWindow.once('tauri://error', (e: unknown) => {
    console.error('[session-window] 创建会话窗口失败:', (e as { payload?: unknown }).payload);
  });
}
