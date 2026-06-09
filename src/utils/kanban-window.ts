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

const KANBAN_WINDOW_LABEL = 'kanban';
const KANBAN_DEFAULT_WIDTH = 960;
const KANBAN_DEFAULT_HEIGHT = 680;

/**
 * 打开看板独立窗口
 * 如果已存在则聚焦，否则在主窗口右侧创建新窗口
 */
export async function openKanbanWindow(): Promise<void> {
  // 检查是否已有看板窗口
  const existing = await WebviewWindow.getByLabel(KANBAN_WINDOW_LABEL);
  if (existing) {
    try {
      await existing.close();
      return;
    } catch {
      // 窗口可能已关闭，继续创建新的
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

    // 看板窗口放在主窗口左侧，间隔 16px
    kanbanX = pos.x - KANBAN_DEFAULT_WIDTH - 16;
    kanbanY = pos.y;
    mainHeight = size.height;

    // 如果左侧空间不够（x < 0），贴到主窗口左边缘偏移 50px
    if (kanbanX < 0) {
      kanbanX = Math.max(16, pos.x - 50);
    }
  } catch {
    // 获取主窗口信息失败，使用默认位置
  }

  // 构建 URL：指向同一个前端应用，带 ?panel=kanban 参数
  const baseUrl = window.location.origin + window.location.pathname;
  const kanbanUrl = baseUrl + '?panel=kanban';

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
    decorations: true,   // 原生标题栏：可拖动+缩放+关闭
    center: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    dragDropEnabled: false,  // 关闭 Tauri 文件拖放，让 HTML5 drag-and-drop 正常工作
  });

  // 监听窗口创建错误
  webviewWindow.once('tauri://error', (e: unknown) => {
    console.error('[kanban-window] 创建看板窗口失败:', (e as { payload?: unknown }).payload);
  });
}
