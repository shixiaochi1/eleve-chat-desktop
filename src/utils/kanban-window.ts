/**
 * kanban-window.ts — 看板独立窗口管理
 *
 * 🔴 2026-08-11 根治重构（老大需求）：
 *   - 点看板按钮 = toggle：弹出 / 隐藏
 *   - 点窗口关闭按钮 = 真实关闭（销毁）
 *   - 销毁后再点按钮 → Rust 侧 WebviewWindowBuilder 重建（带 additional_browser_args，
 *     与主窗口同 WebView2 Environment）→ 不再 0x8007139F
 *
 * 历史（为什么之前好好的突然坏）：
 *   - c345d49: 用 dataDirectory:'kanban' 隔离 → 运行时创建成功（当时正常）
 *   - 2398313: 改预注册 tauri.conf.json，删掉 dataDirectory，宣称"无需隔离" →
 *     预注册窗口被真实关闭销毁后，JS 重建无 args 隔离 → 0x8007139F（15:42 实证）
 *   - 本版本：移除预注册，统一走 Rust toggle_kanban_window command（带 args 重建）
 */
import { invoke } from '@tauri-apps/api/core';

const KANBAN_WINDOW_LABEL = 'kanban';

/**
 * 切换看板窗口（弹出/隐藏）
 */
export async function openKanbanWindow(): Promise<void> {
  try {
    const state = await invoke<string>('toggle_kanban_window');
    console.log('[kanban-window] toggle result:', state);
  } catch (err) {
    console.error('[kanban-window] toggle failed:', err);
  }
}

/** 供诊断/其他模块查询当前看板窗口 label */
export function getKanbanWindowLabel(): string {
  return KANBAN_WINDOW_LABEL;
}
