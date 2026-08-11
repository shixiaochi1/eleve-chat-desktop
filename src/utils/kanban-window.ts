/**
 * kanban-window.ts — 看板独立窗口管理
 *
 * 点击看板图标时，在主窗口右侧弹出一个独立的看板窗口。
 * 特性：
 *   - 独立窗口，不影响主窗口聊天/操作
 *   - 初始定位在主窗口右侧
 *   - 可拖动、可缩放
 *   - 重复点击只聚焦，不重复创建
 */
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';

// 🔴 2026-08-11 修复：原定义 KANBAN_WINDOW_LABEL_PREFIX 从未被引用，
// 而 getByLabel/new WebviewWindow 引用的 KANBAN_WINDOW_LABEL 未定义 →
// 点看板按钮抛 ReferenceError（kanban-window.ts:68）→ 窗口从未创建
// （"闪一下就不见了，再点没反应"）。改名对齐实际引用。
const KANBAN_WINDOW_LABEL = 'kanban';
const KANBAN_DEFAULT_WIDTH = 960;
const KANBAN_DEFAULT_HEIGHT = 680;

/**
 * 打开看板独立窗口
 * 使用固定 label，关闭后延迟再创建
 */
export async function openKanbanWindow(): Promise<void> {
  try {
    // 先尝试 getByLabel 查找
    let existing: WebviewWindow | null = null;
    try {
      existing = await WebviewWindow.getByLabel(KANBAN_WINDOW_LABEL);
    } catch {
      // getByLabel 也可能抛出 label 不存在的错误
    }

    if (existing) {
      console.log('[kanban-window] found existing, closing...');
      try {
        await existing.close();
        // 等待 Tauri 清理资源
        await new Promise(r => setTimeout(r, 1000));
      } catch (closeErr) {
        console.warn('[kanban-window] close failed:', closeErr);
        // close 失败也继续尝试创建
      }
    }

    // 获取主窗口位置和大小，计算看板窗口位置
    let kanbanX = 100;
    let kanbanY = 100;
    let mainHeight = KANBAN_DEFAULT_HEIGHT;

    try {
      const mainWindow = getCurrentWindow();
      const pos = await mainWindow.outerPosition();
      const size = await mainWindow.innerSize();

      kanbanX = pos.x - KANBAN_DEFAULT_WIDTH - 16;
      kanbanY = pos.y;
      mainHeight = size.height;

      if (kanbanX < 0) {
        kanbanX = Math.max(16, pos.x - 50);
      }
    } catch (e) {
      console.warn('[kanban-window] failed to get main window info:', e);
    }

    const baseUrl = window.location.origin + window.location.pathname;
    const kanbanUrl = baseUrl + '?panel=kanban';

    console.log('[kanban-window] creating:', KANBAN_WINDOW_LABEL, 'x:', kanbanX, 'y:', kanbanY, 'url:', kanbanUrl);

    const webviewWindow = new WebviewWindow(KANBAN_WINDOW_LABEL, {
      url: kanbanUrl,
      title: '看板 — Eleve',
      width: KANBAN_DEFAULT_WIDTH,
      height: Math.min(mainHeight, KANBAN_DEFAULT_HEIGHT),
      minWidth: 600,
      minHeight: 400,
      x: kanbanX,
      y: kanbanY,
      resizable: true,
      decorations: true,
      center: false,
      alwaysOnTop: false,
      skipTaskbar: false,
      dragDropEnabled: false,
    });

    webviewWindow.once('tauri://created', () => {
      console.log('[kanban-window] created OK');
    });
    webviewWindow.once('tauri://error', (e: unknown) => {
      console.error('[kanban-window] error:', (e as { payload?: unknown })?.payload);
    });
  } catch (err) {
    console.error('[kanban-window] openKanbanWindow failed:', err);
  }
}
