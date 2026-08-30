import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { notifyError, notifySuccess } from '@/utils/notifications';
import { openBrowserTab } from '@/store/preview';
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
 * 🔴 2026-08-31 内嵌体验（对齐 Hermes openBrowserTab Ctrl+Shift+L 语义）：
 * **左键主点击 = 一键完成**——未连接时自动 connect（不再要求先开菜单点
 * "连接"），成功后直接弹出内嵌 Browser tab（openBrowserTab，页面在前端
 * 界面内打开）。已连接时主点击 = 前置内嵌 Browser。
 * **右键 = 管理菜单**（自定义 CDP 地址 / 断开 / 进度详情——原下拉内容）。
 *
 * 后端调试 Chromium 是有头独立窗口（对齐 Hermes launch_chrome_debug，无
 * --headless）——它只是自动化后端；用户主界面是内嵌 Browser tab。
 *
 * 历史对齐修复：
 * - remote 门控：远程网关下禁用（对齐 Hermes /browser "only available when
 *   connected to a local gateway" — 远程时 browser.manage 会作用到远端主机）
 * - URL 自定义输入：对齐 /browser connect <url>（空 = 后端默认 127.0.0.1:9222）
 * - 进度回显：后端 connect 真实探测/自动启动的 messages 逐行显示
 */
export default function WebWindowButton({ sessionId }: WebWindowButtonProps) {
  const [connected, setConnected] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [remote, setRemote] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // 挂载/菜单打开时查询连接状态 + 连接模式（remote 门控）
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

  const applyManageResult = useCallback(
    (res: { connected?: boolean; url?: unknown; messages?: unknown } | null) => {
      setConnected(!!res?.connected);
      setUrl((res?.url as string) || null);
      if (Array.isArray(res?.messages)) setMessages(res.messages as string[]);
      return !!res?.connected;
    },
    [],
  );

  const connect = useCallback(
    async (customUrl?: string): Promise<boolean> => {
      const res = await getWsClient().browserManage('connect', customUrl, sessionId);
      const ok = applyManageResult(res);
      if (ok) {
        // 🔴 内嵌浏览器直接弹出（对齐 Hermes 预览面板内嵌体验）
        openBrowserTab();
        notifySuccess('浏览器已连接');
      }
      return ok;
    },
    [applyManageResult, sessionId],
  );

  /**
   * 主点击（左键）——一键主动作：
   * 已连接 → 前置内嵌 Browser；未连接 → 自动连接 + 内嵌弹出。
   * 失败时打开管理菜单展示进度/错误详情。
   */
  const handleActivate = useCallback(async () => {
    if (remote || busy) return;
    if (connected) {
      openBrowserTab();
      return;
    }
    setBusy(true);
    setMessages([]);
    try {
      const ok = await connect(urlInput.trim() || undefined);
      if (!ok) setMenuOpen(true); // 失败 → 菜单里看进度详情/自定义地址
    } catch (err) {
      notifyError(err, '浏览器连接失败');
      setMenuOpen(true);
    } finally {
      setBusy(false);
    }
  }, [remote, busy, connected, connect, urlInput]);

  /** 管理菜单里的连接/断开（自定义 URL Enter 场景走这里） */
  const handleToggle = useCallback(async () => {
    setBusy(true);
    setMessages([]);
    try {
      const ws = getWsClient();
      if (connected) {
        const res = await ws.browserManage('disconnect', undefined, sessionId);
        applyManageResult(res);
      } else {
        const connectUrl = urlInput.trim() || undefined;
        await connect(connectUrl);
      }
    } catch (err) {
      console.warn('[WebWindowButton] browser.manage failed:', err);
      setMessages([err instanceof Error ? err.message : String(err)]);
    } finally {
      setBusy(false);
    }
  }, [connected, sessionId, urlInput, connect, applyManageResult]);

  return (
    <div className="relative inline-flex">
      {/* 主按钮：左键 = 自动连接 / 前置内嵌 Browser；右键 = 管理菜单 */}
      <button
        className={cn(
          'group relative inline-flex size-(--composer-control-size) shrink-0 cursor-pointer items-center justify-center rounded-md outline-none transition-all duration-150',
          connected
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          (remote || busy) && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground',
        )}
        title={
          remote
            ? '网页窗口：远程网关不可用（浏览器管理仅限本地网关）'
            : connected
              ? '网页窗口：已连接（点击打开内嵌浏览器，右键管理）'
              : busy
                ? '网页窗口：连接中…'
                : '网页窗口：点击自动连接并打开内嵌浏览器（右键管理）'
        }
        aria-label="网页窗口"
        disabled={remote || busy}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void handleActivate();
        }}
        onContextMenu={(e) => {
          if (remote) return;
          e.preventDefault();
          e.stopPropagation();
          refreshStatus();
          setMenuOpen(true);
        }}
      >
        <WebWindowIcon className="shrink-0" />
        {/* 连接状态指示点 — 连接时绿色脉冲 */}
        {connected && (
          <span className="absolute right-1 top-1 size-1.5 rounded-full bg-success animate-pulse" />
        )}
        {/* 连接中指示 */}
        {busy && <LoadingIcon size={12} className="absolute animate-spin" />}
      </button>

      {/* 管理菜单（右键唤出；透明锚点盖住按钮定位） */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <span className="pointer-events-none absolute inset-0" aria-hidden />
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
                    点击左侧按钮自动连接并打开内嵌浏览器
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
    </div>
  );
}
