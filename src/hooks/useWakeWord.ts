/**
 * useWakeWord — 唤醒词开关状态管理（对齐 Hermes store/wake-word.ts toggleWakeWord）。
 *
 * 后端是唯一权威源（监听器在后端 + 单 owner mic lease）；本 hook 是渲染层
 * 对该真相的缓存，从 wake.* RPC 响应刷新。对齐 Hermes：
 * - 显式点击 = 同意 → persist:true 翻 `wake_word.enabled` 配置（跨重启保留）
 * - 后端拒绝（{started:false, reason}）→ 保持 off + notice 展示原因
 * - pending 防双击
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { getWsClient } from '@/services/ws-client';

export interface WakeWordState {
  /** 监听中（armed + 本 surface 持有） */
  listening: boolean;
  /** 配置真相（wake_word.enabled）——拒绝后仍保持挂载 */
  enabled: boolean;
  /** toggle RPC 在飞（防双击） */
  pending: boolean;
  /** 最后失败原因（tooltip 展示） */
  notice: string;
  /** 人类可读唤醒短语（如 "小莉"） */
  phrase: string;
}

const INITIAL: WakeWordState = {
  listening: false,
  enabled: false,
  pending: false,
  notice: '',
  phrase: '小莉',
};

export function useWakeWord() {
  const [state, setState] = useState<WakeWordState>(INITIAL);
  // ref 镜像防闭包过期（对齐 useVoice onTranscriptRef 模式）
  const stateRef = useRef(state);
  stateRef.current = state;

  /** 刷新状态（wake.status） */
  const refresh = useCallback(async () => {
    try {
      const res = await getWsClient().sendRpc('wake.status', { surface: 'desktop' }) as Partial<WakeWordState> & {
        owned_by_caller?: boolean;
        owner_surface?: string | null;
      };
      setState((s) => ({
        ...s,
        listening: !!res.listening,
        enabled: !!res.enabled,
        phrase: (res.phrase as string) || s.phrase || '小莉',
      }));
    } catch {
      // status 查询失败静默——toggle 时 RPC 会再报
    }
  }, []);

  /** 挂载时查询初始状态（对齐 Hermes gateway 连接后 armWakeWord） */
  useEffect(() => {
    void refresh();
    // 不轮询：toggle 响应 + wake.detected 已足够驱动状态
  }, [refresh]);

  /** toggle：listening → wake.stop(persist) ；否则 wake.start(persist) */
  const toggle = useCallback(async () => {
    const cur = stateRef.current;
    if (cur.pending) return;
    setState((s) => ({ ...s, pending: true, notice: '' }));
    try {
      if (cur.listening) {
        const res = await getWsClient().sendRpc('wake.stop', { persist: true, surface: 'desktop' }) as { stopped?: boolean; reason?: string };
        if (!res.stopped) {
          setState((s) => ({ ...s, notice: res.reason || '停止失败', pending: false }));
          return;
        }
        setState((s) => ({ ...s, listening: false, enabled: false, pending: false }));
      } else {
        const res = await getWsClient().sendRpc('wake.start', { persist: true, surface: 'desktop' }) as {
          started?: boolean;
          reason?: string;
          hint?: string;
        };
        if (!res.started) {
          setState((s) => ({ ...s, notice: res.hint || res.reason || '无法启动', pending: false }));
          return;
        }
        setState((s) => ({ ...s, listening: true, enabled: true, pending: false }));
      }
    } catch (e) {
      setState((s) => ({ ...s, notice: e instanceof Error ? e.message : String(e), pending: false }));
    }
  }, []);

  return { ...state, toggle, refresh };
}
