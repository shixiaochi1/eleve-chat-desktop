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

let selectedRoomId: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function selectRoom(roomId: string | null): void {
  if (selectedRoomId === roomId) return;
  selectedRoomId = roomId;
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
