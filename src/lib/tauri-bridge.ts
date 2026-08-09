/**
 * Tauri 桌面桥接初始化
 * 
 * 将 Tauri invoke 命令包装为 window.eleveDesktop 对象，
 * 供前端组件直接调用（对齐 Hermes Electron IPC 模式）。
 */

export function initTauriBridge() {
  // 仅在 Tauri 环境下初始化
  if (typeof window === 'undefined') return;
  if (!(window as any).__TAURI_INTERNALS__ && !(window as any).__TAURI__) return;

  // 避免重复初始化
  if ((window as any).eleveDesktop) return;

  (window as any).eleveDesktop = {
    writeClipboard: async (text: string): Promise<void> => {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('write_clipboard', { text });
    },
    readClipboard: async (): Promise<string> => {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke('read_clipboard') as string;
    },
  };
}
