import { useSyncExternalStore } from 'react';

/**
 * settings-dirty — 设置面板「未保存改动」标记（模块级 store）
 *
 * 背景：13 个设置分区里 6 个是**显式保存**（工作区 / 记忆 / 安全防护 / 语音 /
 * 高级 / 连接），其余是即时保存。此前关闭面板（X / ESC / 点遮罩）会静默丢弃
 * 未保存改动，界面也没有任何"脏"提示。
 *
 * 约定（显式保存页各自维持）：
 * - 用户改字段 → setSettingsDirty(true)
 * - 加载完成 / 保存成功 → setSettingsDirty(false)
 * - 页面卸载（切分区或关面板）→ 清标记，避免污染下一次进入
 *
 * 消费方：
 * - App.handleCloseOverlay 关闭设置浮层前读 isSettingsDirty() 决定是否确认
 * - SettingsNav 标题旁显示未保存圆点
 */

let dirty = false;
const listeners = new Set<() => void>();

export function isSettingsDirty(): boolean {
  return dirty;
}

export function setSettingsDirty(next: boolean): void {
  if (dirty === next) return;
  dirty = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): boolean {
  return dirty;
}

/** 订阅脏标记（标题圆点等 UI 用） */
export function useSettingsDirty(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
