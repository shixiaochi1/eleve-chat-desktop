/**
 * Display settings store — config.yaml display.show_reasoning（后端 per-profile 权威源）
 *
 * 与 tool-view.ts 同模式，但数据源是后端 config.yaml
 * 而非 localStorage：开关写入/读取都走 config.set.raw / config.get，
 * 设置>聊天 保存后调 setShowReasoning 即时同步，无需刷新页面。
 *
 * 默认 true — 对齐 Hermes cli.py display.show_reasoning = True
 * （"Live reasoning display default ON"）+ ELEVE 后端 serde 默认。
 *
 * 🔴 2026-09-01 收敛：手写 listeners/emit/subscribe 样板 → lib/store-factory
 * createAtomStore（导出 API 签名不变，消费方零改动）。loaded 标志并入值结构。
 */
import { call } from '../utils/bridge';
import { createAtomStore } from '../lib/store-factory';

const store = createAtomStore<{ showReasoning: boolean; loaded: boolean }>({
  showReasoning: true,
  loaded: false,
});

export function getShowReasoning(): boolean {
  return store.get().showReasoning;
}

/** 本地即时更新（设置面板保存后调用；config 落盘由保存方负责） */
export function setShowReasoning(next: boolean): void {
  const { loaded, showReasoning } = store.get();
  if (loaded && showReasoning === next) return;
  store.set({ showReasoning: next, loaded: true });
}

/** 从后端 config 拉取（portReady / profile 切换后调用；失败回落默认 true） */
export async function loadDisplaySettings(): Promise<void> {
  let showReasoning = true;
  try {
    const cfg = await call('get_config', {});
    const v = (cfg?.display ?? {}).show_reasoning;
    showReasoning = typeof v === 'boolean' ? v : true;
  } catch {
    showReasoning = true;
  }
  store.set({ showReasoning, loaded: true });
}

export function useShowReasoning(): boolean {
  return store.useSelector((s) => s.showReasoning);
}
