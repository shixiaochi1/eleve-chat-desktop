/**
 * Display settings store — config.yaml `display.*`（后端 per-profile 权威源）
 * + 会话级覆盖（`/reasoning show|hide|full|clamp` 经 session.info 下发）。
 *
 * 与 tool-view.ts 同模式，但数据源是后端 config.yaml 而非 localStorage：
 * 开关写入/读取都走 config.update_config / get_config，设置>聊天 保存后调
 * setShowReasoning 即时同步，无需刷新页面。
 *
 * 默认 true — 对齐 Hermes cli.py display.show_reasoning = True
 * （"Live reasoning display default ON"）+ ELEVE 后端 serde 默认。
 *
 * 🔴 2026-10-31 会话级覆盖（按 sessionId 归属）：
 *   - `/reasoning hide` 写的是**会话** show_reasoning（ConfigOverrides →
 *     SessionConfig），此前前端只读 config.yaml 全局值 → 命令在桌面端无效；
 *   - 单视图与宫格共用 ReasoningBlock，覆盖必须按会话区分，否则宫格卡片会
 *     串用焦点会话的值（或反之）。
 *   - session.info 的 null = 未覆盖 → 回退全局 display。
 *
 * 🔴 2026-09-01 收敛：手写 listeners/emit/subscribe 样板 → lib/store-factory
 * createAtomStore（导出 API 签名不变，消费方零改动）。loaded 标志并入值结构。
 */
import { call } from '../utils/bridge';
import { createAtomStore } from '../lib/store-factory';

/** 单个会话的显示覆盖（字段缺席 = 继承全局） */
interface SessionDisplayOverride {
  show?: boolean;
  full?: boolean;
}

interface DisplaySettingsState {
  /** 全局 display.show_reasoning（config.yaml） */
  showReasoning: boolean;
  /** 全局 display.reasoning_full（false = 截断到 reasoning_max_lines） */
  reasoningFull: boolean;
  /** 全局 display.reasoning_max_lines */
  reasoningMaxLines: number;
  /** 会话级覆盖：sessionId → { show, full } */
  sessions: Record<string, SessionDisplayOverride>;
  loaded: boolean;
}

const store = createAtomStore<DisplaySettingsState>({
  showReasoning: true,
  // ELEVE 现状是全文展示；clamp 需全局 reasoning_full=false 或 /reasoning clamp 显式开启
  reasoningFull: true,
  reasoningMaxLines: 10,
  sessions: {},
  loaded: false,
});

const sidKey = (sessionId: string | null | undefined): string => (sessionId || '').trim();

/** 生效的显示开关（会话覆盖 > 全局） */
export function getShowReasoning(sessionId?: string | null): boolean {
  const s = store.get();
  const key = sidKey(sessionId);
  const ov = key ? s.sessions[key] : undefined;
  return ov?.show ?? s.showReasoning;
}

/** 本地即时更新全局开关（设置面板保存后调用；config 落盘由保存方负责） */
export function setShowReasoning(next: boolean): void {
  const s = store.get();
  if (s.loaded && s.showReasoning === next) return;
  store.set({ ...s, showReasoning: next, loaded: true });
}

/**
 * 会话级覆盖（session.info 的 show_reasoning / reasoning_full；null = 未覆盖）。
 * 无 sessionId 的调用直接忽略（草稿会话没有可归属的覆盖）。
 */
export function setSessionDisplayOverrides(
  sessionId: string | null | undefined,
  show: boolean | null,
  full: boolean | null,
): void {
  const key = sidKey(sessionId);
  if (!key) return;
  const s = store.get();
  const prev = s.sessions[key];
  const next: SessionDisplayOverride = { ...prev };
  if (show === null) delete next.show;
  else next.show = show;
  if (full === null) delete next.full;
  else next.full = full;

  const same = (prev?.show ?? null) === (next.show ?? null)
    && (prev?.full ?? null) === (next.full ?? null);
  if (same) return;

  const sessions = { ...s.sessions };
  if (next.show === undefined && next.full === undefined) delete sessions[key];
  else sessions[key] = next;
  store.set({ ...s, sessions });
}

/** 从后端 config 拉取（portReady / profile 切换后调用；失败回落默认 true） */
export async function loadDisplaySettings(): Promise<void> {
  const cur = store.get();
  let showReasoning = true;
  let reasoningFull = true;
  let reasoningMaxLines = cur.reasoningMaxLines;
  try {
    const cfg = await call('get_config', {});
    const display = cfg?.display ?? {};
    showReasoning = typeof display.show_reasoning === 'boolean' ? display.show_reasoning : true;
    reasoningFull = typeof display.reasoning_full === 'boolean' ? display.reasoning_full : true;
    const lines = display.reasoning_max_lines;
    if (typeof lines === 'number' && Number.isFinite(lines) && lines > 0) {
      reasoningMaxLines = Math.floor(lines);
    }
  } catch {
    showReasoning = true;
  }
  store.set({ ...store.get(), showReasoning, reasoningFull, reasoningMaxLines, loaded: true });
}

export function useShowReasoning(sessionId?: string | null): boolean {
  const key = sidKey(sessionId);
  return store.useSelector((s) => (key ? s.sessions[key]?.show : undefined) ?? s.showReasoning);
}

/** 生效的「完整显示」标志（会话覆盖 > 全局；false = 截断到 maxLines） */
export function useReasoningFull(sessionId?: string | null): boolean {
  const key = sidKey(sessionId);
  return store.useSelector((s) => (key ? s.sessions[key]?.full : undefined) ?? s.reasoningFull);
}

/** 推理截断行数（display.reasoning_max_lines，默认 10） */
export function useReasoningMaxLines(): number {
  return store.useSelector((s) => s.reasoningMaxLines);
}
