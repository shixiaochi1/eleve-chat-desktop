import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { FastIcon } from './Icons';
import { getWsClient } from '@/services/ws-client';

/**
 * 快速模式 — 开关按钮（对齐 Hermes fastMode）
 *
 * 开启时按钮点亮（主色底 + 闪电图标脉冲），关闭时 ghost。
 * ⚠️ 后端现状：eleve-config 暂未找到 fast 模式的配置键，此处按 frontend-first
 *    先行实现——乐观更新 UI + 尝试 config.set(agent.fast_mode)，
 *    后端确认正式配置键后改一行 CONFIG_KEY 即可接通。
 */
const CONFIG_KEY = 'agent.fast_mode';

export default function FastModeButton() {
  const [on, setOn] = useState(false);

  const toggle = useCallback(() => {
    const next = !on;
    setOn(next);
    getWsClient().configSet(CONFIG_KEY, next).catch((err) => {
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
