import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { FastIcon } from './Icons';
import { getWsClient } from '@/services/ws-client';

/**
 * 快速模式 — 开关按钮（对齐 Hermes fastMode = agent.service_tier fast/priority/on）
 *
 * 🔴 2026-08-10 断链修复：此前写 agent.fast_mode（后端 AgentConfig 无此字段，
 *    update_value 反序列化丢弃 → 点了零效果）+ 不读回（刷新 UI 状态丢失）。
 *    对齐 Hermes isFastTier：['fast','priority','on'] → 开；其他 → 关。
 *    与 AdvancedSettings「快速服务层」开关同键（agent.service_tier），天然联动。
 */
const CONFIG_KEY = 'agent.service_tier';

/** 对齐 Hermes isFastTier（agent_init.py _is_fast_tier 语义） */
const isFastTier = (v: unknown): boolean =>
  typeof v === 'string' && ['fast', 'priority', 'on'].includes(v.trim().toLowerCase());

export default function FastModeButton() {
  const [on, setOn] = useState(false);

  // 挂载读回（对齐 Hermes：agent.service_tier 持久化，重启/切 profile 后保持）
  useEffect(() => {
    getWsClient()
      .configGet(CONFIG_KEY)
      .then((res) => {
        // config.get 返回裸 pointer 值（兼容 {value} 包裹）
        const v = typeof res === 'string' ? res : (res as { value?: unknown })?.value;
        setOn(isFastTier(v));
      })
      .catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    const next = !on;
    setOn(next);
    // fast/normal（对齐 Hermes fastMode 开关写 service_tier；priority/on 由 config.yaml 手写保留）
    getWsClient().configSet(CONFIG_KEY, next ? 'fast' : 'normal').catch((err) => {
      console.warn('[FastModeButton] config.set failed:', err);
    });
  }, [on]);

  return (
    <button
      onClick={toggle}
      className={cn(
        'inline-flex size-(--composer-control-size) shrink-0 cursor-pointer items-center justify-center rounded-md outline-none transition-all duration-150',
        on
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
      title={on ? '快速模式：开（点击关闭）' : '快速模式：关（点击开启）'}
      aria-label="快速模式"
      aria-pressed={on}
    >
      <FastIcon className={cn(on && 'animate-pulse')} />
    </button>
  );
}
