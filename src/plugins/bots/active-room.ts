/**
 * 🔴 2026-10-25：当前**真正可见**的群聊房间（Bots 主区挂载 + 选中态）。
 *
 * 与 `selectedRoomId` 的区别：后者是持久化的“上次看的房间”，用户切到
 * 单视图/宫格/其他插件时仍然有值。远端审批的 Desktop Modal 只有在房间
 * **不可见**时才应抢占焦点；房间卡可见时以房间卡为主，避免同一 decision
 * 同时出现两张卡。
 */
import { useSyncExternalStore } from 'react';

let activeRoomId: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function setActiveRoomId(roomId: string | null): void {
  if (activeRoomId === roomId) return;
  activeRoomId = roomId;
  emit();
}

export function getActiveRoomId(): string | null {
  return activeRoomId;
}

export function useActiveRoomId(): string | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getActiveRoomId,
    () => null,
  );
}
