import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { WebWindowIcon, LoadingIcon } from './Icons';
import { getWsClient } from '@/services/ws-client';

/**
 * 网页窗口 — 浏览器自动化连接控制（对齐 Hermes browser.manage）
 *
 * 按钮 + 下拉面板：显示 CDP 连接状态，一键连接/断开浏览器。
 * 已接通后端 browser.manage（status/connect/disconnect，真实实现）。
 * 微交互：连接时按钮亮起 + 右上角绿点脉冲；操作中按钮转圈；状态卡片实时刷新。
 */
export default function WebWindowButton() {
  const [connected, setConnected] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 挂载时查询连接状态
  useEffect(() => {
    getWsClient()
      .browserManage('status')
      .then((res) => {
        setConnected(!!res?.connected);
        setUrl((res?.url as string) || null);
      })
      .catch(() => {});
  }, []);

  const handleToggle = useCallback(async () => {
    setBusy(true);
    try {
      await getWsClient().browserManage(connected ? 'disconnect' : 'connect');
      // 操作后重新查询状态，拿到准确的 connected + url
      const status = await getWsClient().browserManage('status');
      setConnected(!!status?.connected);
      setUrl((status?.url as string) || null);
    } catch (err) {
      console.warn('[WebWindowButton] browser.manage failed:', err);
    } finally {
      setBusy(false);
    }
  }, [connected]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'group relative inline-flex size-(--composer-control-size) shrink-0 cursor-pointer items-center justify-center rounded-md outline-none transition-all duration-150',
            connected
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
          title={connected ? '网页窗口：已连接（点击管理）' : '网页窗口：未连接（点击连接）'}
          aria-label="网页窗口"
        >
          <WebWindowIcon className="shrink-0" />
          {/* 连接状态指示点 — 连接时绿色脉冲 */}
          {connected && (
            <span className="absolute right-1 top-1 size-1.5 rounded-full bg-success animate-pulse" />
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="start" className="w-64">
        <DropdownMenuLabel className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground/70">
          网页窗口
        </DropdownMenuLabel>
        <div className="px-2.5 pb-2">
          {/* 状态卡片 */}
          <div className="flex items-center gap-2 rounded-lg border border-border/40 px-2.5 py-2">
            <span
              className={cn(
                'size-2 shrink-0 rounded-full',
                connected ? 'animate-pulse bg-success' : 'bg-muted-foreground/30'
              )}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-xs font-medium">{connected ? '已连接' : '未连接'}</span>
              {connected && url && (
                <span className="truncate text-[10px] text-muted-foreground/70" title={url}>
                  {url}
                </span>
              )}
              {!connected && (
                <span className="text-[10px] leading-snug text-muted-foreground/60">
                  连接浏览器后可自动化操作网页
                </span>
              )}
            </div>
          </div>
          {/* 操作按钮 */}
          <button
            onClick={() => { void handleToggle(); }}
            disabled={busy}
            className={cn(
              'mt-2 flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md text-xs font-medium outline-none transition-all duration-150',
              connected
                ? 'text-destructive hover:bg-destructive/10'
                : 'bg-primary text-primary-foreground hover:bg-primary/90',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {busy ? (
              <LoadingIcon size={13} className="animate-spin" />
            ) : connected ? (
              '断开连接'
            ) : (
              '连接浏览器'
            )}
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
