/**
 * 思考档位 / 快速模式的写入通道（单一实现，供模型菜单子菜单与会话模型切换复用）。
 *
 * 作用域对齐 Hermes：
 * - 有会话 → 会话级（`config.set {key:"reasoning"|"fast", session_id}`）；
 * - 无会话（草稿）→ 全局默认（`agent.reasoning_effort` / `agent.service_tier`）。
 */
import { getWsClient } from '@/services/ws-client';

/** 思考档位（值含 'none' = 关闭） */
export async function writeReasoningEffort(
  sessionId: string | null | undefined,
  value: string,
): Promise<void> {
  const ws = getWsClient();
  if (sessionId) {
    await ws.configSet('reasoning', value, sessionId);
  } else {
    await ws.configSet('agent.reasoning_effort', value);
  }
}

/** 快速模式（会话级 → 后端 set_fast_mode → extra_body 逐请求下发） */
export async function writeFastMode(
  sessionId: string | null | undefined,
  on: boolean,
): Promise<void> {
  const ws = getWsClient();
  if (sessionId) {
    // 后端把 fast/priority/on 都视为开；统一写 "priority"（Hermes 内部 wire 语义）
    await ws.configSet('fast', on ? 'priority' : 'normal', sessionId);
  } else {
    // 全局默认：开 = "priority"（对齐 Hermes fast ↔ priority；"fast" 是非法 wire 值），
    // 关 = null（清空，避免把 "normal" 透传给厂商）
    await ws.configSet('agent.service_tier', on ? 'priority' : null);
  }
}
