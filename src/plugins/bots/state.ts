/**
 * 🔴 2026-09-05 round-42：Bots 插件内共享 UI 状态（模块级 store）。
 *
 * 布局 1:1 对齐 Hermes Desktop（roster-pane.tsx / canonical-chat.ts）：
 * Bots 是左栏 pane（SESSIONS | BOTS tab strip），点群聊行 → 主区打开房间
 * 视图。侧栏（BotsPane）与主区（BotsRoomMainView）分属两个贡献组件——
 * "选中哪个群聊"跨组件共享，用插件模块级 store 承载（不进 host 门、
 * 不进 App 状态——插件内聚，对齐 Hermes 插件内自治）。
 */
import { useSyncExternalStore } from 'react';

// 🔴 2026-09-06 round-68：选中房间持久化（localStorage）——点群聊按钮
// 进入群聊界面时自动恢复"上次看的房间"（用户期望：进来即见最近群聊
// 消息，而非空态）；刷新/重启后选中态不丢。解散房残留在主区加载时
// 校验兜底（不在列表 → 回退最新创建房间）。
const SELECTED_ROOM_KEY = 'eleve.bots.selectedRoomId';

function loadInitialSelectedRoom(): string | null {
  try {
    return localStorage.getItem(SELECTED_ROOM_KEY);
  } catch {
    return null;
  }
}

let selectedRoomId: string | null = loadInitialSelectedRoom();
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function selectRoom(roomId: string | null): void {
  if (selectedRoomId === roomId) return;
  selectedRoomId = roomId;
  try {
    if (roomId) localStorage.setItem(SELECTED_ROOM_KEY, roomId);
    else localStorage.removeItem(SELECTED_ROOM_KEY);
  } catch {
    /* 存储不可用时选中态退化为内存态（会话内仍一致） */
  }
  emit();
}

export function getSelectedRoomId(): string | null {
  return selectedRoomId;
}

export function useSelectedRoomId(): string | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSelectedRoomId,
    () => null,
  );
}
