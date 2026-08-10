import { useState, useEffect, useCallback } from 'react';
import { getWsClient } from '@/services/ws-client';
import { Switch } from './ui/switch';

/**
 * MoA 开关 — 滑块开关样式（工具栏 DeepSeek 按钮右侧）
 *
 * 🔴 2026-08-11：MoA 开启时每轮回复前会先跑参考模型调用 + 聚合器（阻塞式），
 *    若槽位配置了慢的 reasoning 模型，回复前会干等数十秒。此开关提供一键开/关。
 *    读写链路：config.get / config.set 点路径（JSON pointer，与 FastModeButton 同模式）。
 */
const CONFIG_KEY = 'moa.pr…bled';

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

  const toggle = useCallback((next: boolean) => {
    setOn(next);
    getWsClient().configSet(CONFIG_KEY, next).catch((err) => {
      console.warn('[MoaToggleButton] config.set failed:', err);
    });
  }, []);

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors bg-secondary/60 hover:bg-accent/50"
      title={on ? 'MoA 多模型协作：开（点击关闭）' : 'MoA 多模型协作：关（点击开启）'}
    >
      <span className={on ? 'text-primary font-medium' : 'text-muted-foreground'}>MoA</span>
      <Switch checked={on} onCheckedChange={toggle} aria-label="MoA 开关" />
    </div>
  );
}
