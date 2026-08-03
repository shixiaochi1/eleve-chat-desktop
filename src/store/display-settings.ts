/**
 * Display settings store — config.yaml display.show_reasoning（后端 per-profile 权威源）
 *
 * 与 tool-view.ts 同模式（useSyncExternalStore），但数据源是后端 config.yaml
 * 而非 localStorage：开关写入/读取都走 config.set.raw / config.get，
 * 设置>聊天 保存后调 setShowReasoning 即时同步，无需刷新页面。
 *
 * 默认 true — 对齐 Hermes cli.py display.show_reasoning = True
 * （"Live reasoning display default ON"）+ ELEVE 后端 serde 默认。
 */
import { useSyncExternalStore } from 'react';
import { call } from '../utils/bridge';

let showReasoning = true;
let loaded = false;
const listeners = new Set<() => void>();

export function getShowReasoning(): boolean {
  return showReasoning;
}

/** 本地即时更新（设置面板保存后调用；config 落盘由保存方负责） */
export function setShowReasoning(next: boolean): void {
  if (loaded && showReasoning === next) return;
  showReasoning = next;
  loaded = true;
  listeners.forEach(l => l());
}

/** 从后端 config 拉取（portReady / profile 切换后调用；失败回落默认 true） */
export async function loadDisplaySettings(): Promise<void> {
  try {
    const cfg = await call('get_config', {});
    const v = (cfg?.display ?? {}).show_reasoning;
    showReasoning = typeof v === 'boolean' ? v : true;
  } catch {
    showReasoning = true;
  }
  loaded = true;
  listeners.forEach(l => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function useShowReasoning(): boolean {
  return useSyncExternalStore(subscribe, getShowReasoning, getShowReasoning);
}
