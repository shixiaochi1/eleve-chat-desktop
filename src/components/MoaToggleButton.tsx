import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { MoAIcon } from './Icons';
import { getWsClient } from '@/services/ws-client';

/**
 * MoA 开关 — 输入框快捷按钮（读/写 config.yaml moa.presets.default.enabled）
 *
 * 🔴 2026-08-11：MoA 开启时每轮回复前会先跑参考模型调用 + 聚合器（阻塞式），
 *    若槽位配置了慢的 reasoning 模型，回复前会干等数十秒。此按钮提供一键开/关。
 *    读写链路：config.get / config.set 点路径（JSON pointer，与 FastModeButton 同模式）。
 */
const CONFIG_KEY = 'moa.presets.default.enabled';

/** 裸值 / {value} 包裹双形态取值（config.get 对布尔返回裸 JSON 布尔） */
const unwrap = (res: unknown): unknown =>
  typeof res === 'object' && res !== null && 'value' in res
    ? (res as { value?: unknown }).value
    : res;

export default function MoaToggleButton() {
  const [on, setOn] = useState(false);

  // 挂载读回（config.yaml 持久化，重启/切 profile 后保持）
  useEffect(() => {
    getWsClient()
      .configGet(CONFIG_KEY)
      .then((res) => {
        setOn(unwrap(res) === true);
      })
      .catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    const next = !on;
    setOn(next);
    getWsClient().configSet(CONFIG_KEY, next).catch((err) => {
      console.warn('[MoaToggleButton] config.set failed:', err);
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
      title={on ? 'MoA 多模型协作：开（点击关闭）' : 'MoA 多模型协作：关（点击开启）'}
      aria-label="MoA 开关"
      aria-pressed={on}
    >
      <MoAIcon className={cn(on && 'animate-pulse')} />
    </button>
  );
}
