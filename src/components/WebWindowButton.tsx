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
import { loadConnection, isRemoteMode } from '@/lib/connection';

interface WebWindowButtonProps {
  /** 当前会话 ID — 传给 browser.manage，流式 browser.progress 事件进会话 */
  sessionId?: string | null;
}

/**
 * 网页窗口 — 浏览器自动化连接控制（对齐 Hermes browser.manage + /browser 命令）
 *
 * 🔴 2026-08-09 对齐修复：
 * - remote 门控：远程网关下禁用（对齐 Hermes /browser "only available when connected
 *   to a local gateway" — 远程时 browser.manage 会作用到远端主机）
 * - URL 自定义输入：对齐 /browser connect <url>（空 = 后端默认 127.0.0.1:9222）
 * - 进度回显：后端 connect 真实探测/自动启动的 messages 逐行显示（Hermes 语义：
 *   无会话订阅时 response.messages 打包回显；有 session_id 时流式 browser.progress）
 * - 连接状态微交互保持（连接亮起 + 绿点脉冲 + busy 转圈）
 */
export default function WebWindowButton({ sessionId }: WebWindowButtonProps) {
  const [connected, setConnected] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [remote, setRemote] = useState(false);

  // 挂载时查询连接状态 + 连接模式（remote 门控）
  const refreshStatus = useCallback(() => {
    const conn = loadConnection();
    setRemote(isRemoteMode(conn));
    getWsClient()
      .browserManage('status')
      .then((res) => {
        setConnected(!!res?.connected);
        setUrl((res?.url as string) || null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const handleToggle = useCallback(async () => {
    setBusy(true);
    setMessages([]);
    try {
      const ws = getWsClient();
      if (connected) {
        const res = await ws.browserManage('disconnect', undefined, sessionId);
        setConnected(!!res?.connected);
        setUrl(null);
        if (Array.isArray(res?.messages)) setMessages(res.messages as string[]);
      } else {
        const connectUrl = urlInput.trim() || undefined;
        const res = await ws.browserManage('connect', connectUrl, sessionId);
        setConnected(!!res?.connected);
        setUrl((res?.url as string) || null);
        if (Array.isArray(res?.messages)) setMessages(res.messages as string[]);
      }
    } catch (err) {
      console.warn('[WebWindowButton] browser.manage failed:', err);
      setMessages([err instanceof Error ? err.message : String(err)]);
    } finally {
      setBusy(false);
    }
  }, [connected, sessionId, urlInput]);

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) refreshStatus(); }}>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'group relative inline-flex size-(--composer-control-size) shrink-0 cursor-pointer items-center justify-center rounded-md outline-none transition-all duration-150',
            connected
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            remote && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground'
          )}
          title={
            remote
              ? '网页窗口：远程网关不可用（浏览器管理仅限本地网关）'
              : connected
                ? '网页窗口：已连接（点击管理）'
                : '网页窗口：未连接（点击连接）'
          }
          aria-label="网页窗口"
          disabled={remote}
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

        {/* 🔴 remote 门控提示（对齐 Hermes /browser 拒绝远程） */}
        {remote && (
          <div className="px-2.5 pb-2 text-[10px] leading-snug text-muted-foreground/70">
            远程连接不可用 — 浏览器管理仅在本地连接时可用
          </div>
        )}

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
              {!connected && !remote && (
                <span className="text-[10px] leading-snug text-muted-foreground/60">
                  连接浏览器后可自动化操作网页
                </span>
              )}
            </div>
          </div>

          {/* 🔴 CDP 地址输入（对齐 /browser connect <url>；空 = 后端默认 127.0.0.1:9222） */}
          {!connected && !remote && (
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleToggle();
                }
              }}
              placeholder="CDP 地址（默认 http://127.0.0.1:9222）"
              className="desktop-input-chrome mt-2 h-8 w-full rounded-md border px-2.5 text-[11px] outline-none"
              autoComplete="off"
              spellCheck="false"
            />
          )}

          {/* 🔴 进度回显（对齐 Hermes response.messages：探测/启动/失败原因逐行显示） */}
          {messages.length > 0 && (
            <div className="mt-1.5 flex max-h-24 flex-col gap-0.5 overflow-y-auto rounded-md bg-muted/40 px-2 py-1.5">
              {messages.map((m, i) => (
                <div key={i} className="text-[10px] leading-snug text-muted-foreground/80">
                  {m}
                </div>
              ))}
            </div>
          )}

          {/* 操作按钮 */}
          {!remote && (
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
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
