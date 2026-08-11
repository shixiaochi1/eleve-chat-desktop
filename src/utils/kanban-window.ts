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
import { WebviewWindow, getAllWebviewWindows } from '@tauri-apps/api/webviewWindow';
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
    // 查找已存在的看板窗口（对齐 Hermes 打开/聚焦语义，不 toggle 关闭）：
    // getByLabel 优先，getAllWebviewWindows 兜底——Tauri v2 中 webview 注册表
    // 与 getByLabel 查询可能不同步（创建中/残留），单查 getByLabel 会漏掉
    // 已存在窗口 → new WebviewWindow 报 "a webview with label 'kanban' already
    // exists"（2026-08-11 实证）。找到 → show+focus，不重复创建。
    let existing: WebviewWindow | null = null;
    try {
      existing = await WebviewWindow.getByLabel(KANBAN_WINDOW_LABEL);
    } catch {
      // getByLabel 也可能抛出 label 不存在的错误
    }
    if (!existing) {
      try {
        const all = await getAllWebviewWindows();
        existing = all.find((w) => w.label === KANBAN_WINDOW_LABEL) ?? null;
      } catch {
        // 查询失败继续尝试创建
      }
    }

    if (existing) {
      console.log('[kanban-window] found existing, focusing...');
      try {
        await existing.show();
        await existing.setFocus();
        await existing.unminimize();
      } catch (focusErr) {
        console.warn('[kanban-window] focus failed:', focusErr);
      }
      return;
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

    // 🔴 2026-08-11 多 webview 数据目录隔离（tauri#11144 + API 文档）：Windows 上
    // additionalBrowserArgs 等设置不同的 webview 必须用不同 data directory，
    // 否则第二个 webview 创建失败（0x8007139F 实证）。主窗口在 tauri.conf.json
    // 配了 --disable-background-* args，看板窗口 JS 侧无法传同 args → 用
    // dataDirectory 独立数据目录隔离（相对 appDataDir()/kanban）。
    // 08:29 dev 终端实证：failed to create webview: 0x8007139F。
    const webviewWindow = new WebviewWindow(KANBAN_WINDOW_LABEL, {
      url: kanbanUrl,
      title: '看板 — Eleve',
      width: KANBAN_DEFAULT_WIDTH,
      height: Math.min(mainHeight, KANBAN_DEFAULT_HEIGHT),
      minWidth: 600,
      minHeight: 400,
      center: true,
      resizable: true,
      decorations: true,
      alwaysOnTop: false,
      skipTaskbar: false,
      dragDropEnabled: false,
      visible: false,
      // 独立 webview 数据目录（隔离 additional args 差异，防 0x8007139F）
      dataDirectory: 'kanban',
    });

    webviewWindow.once('tauri://created', () => {
      console.log('[kanban-window] created OK (hidden)');
      // 延迟等待页面加载 + IPC 注入，然后做连通性测试
      setTimeout(async () => {
        try {
          const all = await getAllWebviewWindows();
          const alive = all.find((w) => w.label === KANBAN_WINDOW_LABEL);
          console.log('[kanban-window] 1s-alive check:', alive ? 'ALIVE' : 'GONE');
          if (!alive) return;
          // IPC 连通性测试：setTitle 是主进程操作，成功 = IPC 通道可用
          try {
            await alive.setTitle('看板 — Eleve');
            console.log('[kanban-window] IPC test OK — showing window');
            await alive.show();
            await alive.setFocus();
            // 诊断：打印实际位置（确认落在可见屏幕）
            try {
              const p = await alive.outerPosition();
              const s = await alive.innerSize();
              console.log('[kanban-window] position:', JSON.stringify(p), 'size:', JSON.stringify(s));
            } catch { /* 位置查询失败忽略 */ }
          } catch (ipcErr) {
            // 🔴 IPC 不通（webview 初始化失败/崩溃）→ 保持隐藏，报错到主窗口 console
            console.error('[kanban-window] IPC FAILED — window kept hidden:', ipcErr);
          }
        } catch (err3) {
          console.warn('[kanban-window] alive check failed:', err3);
        }
      }, 1500);
    });
    // 诊断：窗口是否被关闭请求（区分"被 close" vs "崩溃"）
    webviewWindow.onCloseRequested(() => {
      console.log('[kanban-window] close requested!');
    });
    webviewWindow.once('tauri://error', async (e: unknown) => {
      const payload = (e as { payload?: string })?.payload;
      console.error('[kanban-window] error:', payload);
      // 创建失败（并发点击/残留 label）→ 兜底查找已存在窗口并聚焦
      if (typeof payload === 'string' && payload.includes('already exists')) {
        try {
          const all = await getAllWebviewWindows();
          const w = all.find((x) => x.label === KANBAN_WINDOW_LABEL);
          if (w) {
            await w.show();
            await w.setFocus();
          }
        } catch (err2) {
          console.warn('[kanban-window] fallback focus failed:', err2);
        }
      }
    });
  } catch (err) {
    console.error('[kanban-window] openKanbanWindow failed:', err);
  }
}
