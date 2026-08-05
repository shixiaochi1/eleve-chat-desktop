/**
 * TerminalPanel — 多 tab 终端面板
 *
 * 对齐 Hermes apps/desktop/src/app/right-sidebar/terminal/（workspace + rail + persistent）
 * - Tab 栏：所有 TerminalEntry（user + agent），关闭 → dispose PTY + 焦点滑邻居
 * - User tab：真实交互式 PTY（src-tauri portable-pty，对齐 Hermes Electron 主进程 PTY）
 *   · 生命周期与视图解耦（pty-manager 模块级权威源）：切 tab/切面板 shell 不死
 *   · reviveBuffer：xterm 序列化快照（VS Code parity，重挂载恢复屏幕 + 重启后新 shell 垫底）
 *   · shell 退出 → 关 tab（Hermes onExit 语义）
 * - Agent tab：后台进程只读镜像（agent.terminal.output 事件流 + 快照对账兜底）
 *
 * 渲染策略：所有 tab 常驻挂载（非活跃 CSS hidden）— 切 tab 不销毁 xterm/PTY，
 * 激活时 re-fit（对齐 Hermes PersistentTerminal "shell 存活于隐藏" 语义）。
 */
import { useEffect, useRef, useCallback, useState, useMemo, useSyncExternalStore } from 'react';
import { Terminal as TerminalIcon, X, Plus } from 'lucide-react';
import { dragHasPaths, collectDroppedPaths, quoteShellPath } from '@/lib/paths-dnd';
import useTerminal from '../hooks/useTerminal';
import { listProcesses } from '../utils/api';
import { isDesktop } from '@/utils/bridge';
import { cn } from '@/lib/utils';
import {
  subscribeTerminals,
  getTerminalsSnapshot,
  getActiveTerminalIdSnapshot,
  selectTerminal,
  closeTerminal,
  createTerminal,
  ensureAgentTerminal,
  reportTerminalShell,
  updateTerminalReviveBuffer,
  type TerminalEntry,
} from '@/store/terminals';
import {
  ensurePtyForTab,
  attachPtyWriter,
  writePtyInput,
  resizePty,
  disposePtyForTab,
  onPtyExit,
} from '@/lib/pty-manager';
import {
  registerAgentTerminalWriter,
  seedAgentTerminalCommand,
  syncAgentTerminalSnapshot,
} from '@/lib/agent-terminal-stream';

// Import xterm CSS
import '@xterm/xterm/css/xterm.css';

import { setActiveTerminalId } from '@/store/terminal-buffer';

// ── SerializeAddon（revive 快照）：模块级懒加载 + WeakMap 按 xterm 实例挂一份 ──
const serializeAddons = new WeakMap<object, { serialize: (opts?: { scrollback?: number }) => string }>();
let serializeCtorPromise: Promise<new () => { serialize: (opts?: { scrollback?: number }) => string }> | null = null;

async function getSerializeAddon(term: object): Promise<{ serialize: (opts?: { scrollback?: number }) => string } | null> {
  const existing = serializeAddons.get(term);
  if (existing) return existing;
  try {
    if (!serializeCtorPromise) {
      serializeCtorPromise = import('@xterm/addon-serialize').then((m) => m.SerializeAddon as never);
    }
    const Ctor = await serializeCtorPromise;
    const addon = new Ctor();
    (term as { loadAddon: (a: unknown) => void }).loadAddon(addon);
    serializeAddons.set(term, addon);
    return addon;
  } catch {
    return null;
  }
}

interface TerminalPanelProps {
  sessionId?: string;
  /** 当前会话工作目录 — 新建终端 tab 的初始 cwd（对齐 Hermes createTerminal($currentCwd)） */
  cwd?: string;
}

export default function TerminalPanel({ sessionId, cwd }: TerminalPanelProps) {
  const tabs = useSyncExternalStore(subscribeTerminals, getTerminalsSnapshot);
  const activeId = useSyncExternalStore(subscribeTerminals, getActiveTerminalIdSnapshot);

  // 确保至少一个 tab（携带会话 cwd — Hermes: 终端只继承创建时的 cwd）
  useEffect(() => {
    if (getTerminalsSnapshot().length === 0) createTerminal(cwd ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 对齐 Hermes: tab 切换时同步 setActiveTerminalId → read_terminal 工具读取当前活跃 tab
  useEffect(() => { setActiveTerminalId(activeId); }, [activeId]);

  // Agent 后台进程 surface 为只读 tab（对齐 Hermes workspace.tsx 的
  // $backgroundStatusBySession effect；surfacedProcs 去重，关闭后不复活）
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const surface = async () => {
      try {
        const res = await listProcesses(sessionId);
        for (const p of res.processes || []) {
          if (cancelled) return;
          const title = p.command.length > 30 ? `${p.command.slice(0, 30)}…` : p.command;
          ensureAgentTerminal(String(p.session_id), title || 'agent');
        }
      } catch { /* 会话可能不存在，静默 */ }
    };
    surface();
    const i = setInterval(surface, 5000);
    return () => { cancelled = true; clearInterval(i); };
  }, [sessionId]);

  // 关闭 tab：先 dispose PTY（agent tab 无 PTY 则 no-op），再走 store 焦点滑动
  const handleCloseTab = useCallback((id: string) => {
    void disposePtyForTab(id);
    closeTerminal(id);
  }, []);

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background">
      {/* Tab bar */}
      <div className="flex items-center gap-0 px-1 py-0.5 border-b border-border bg-muted/10 shrink-0 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded-sm whitespace-nowrap transition-colors ${
              tab.id === activeId
                ? 'bg-accent/20 text-primary font-medium'
                : 'text-muted-foreground hover:bg-muted/40'
            }`}
            onClick={() => selectTerminal(tab.id)}
          >
            <TerminalIcon size={11} className={tab.kind === 'agent' ? 'text-info' : ''} />
            <span>{tab.title}</span>
            {tab.kind === 'agent' && (
              <span className="text-[9px] px-0.5 rounded bg-info/20 text-info">agent</span>
            )}
            <span
              className="ml-0.5 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive cursor-pointer"
              onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id); }}
            >
              <X size={10} />
            </span>
          </button>
        ))}
        {/* New tab button */}
        <button
          className="p-1 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors shrink-0"
          onClick={() => createTerminal(cwd ?? '')}
          title="新建终端"
        >
          <Plus size={12} />
        </button>
      </div>

      {/* 所有 tab 常驻挂载，非活跃 hidden — 切 tab 不销毁 xterm/PTY */}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={cn('flex flex-col flex-1 min-h-0', tab.id !== activeId && 'hidden')}
        >
          {tab.kind === 'agent'
            ? <AgentTerminalView active={tab.id === activeId} entry={tab} sessionId={sessionId} />
            : <UserTerminalView active={tab.id === activeId} entry={tab} />}
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// User tab — 真实交互式 PTY（对齐 Hermes useTerminalSession）
// ────────────────────────────────────────────────────────────────

/** revive 快照节流（对齐 Hermes SNAPSHOT_THROTTLE_MS=750） */
const SNAPSHOT_THROTTLE_MS = 750;
/** 持久化的 scrollback 行数（对齐 Hermes PERSISTENT_SESSION_SCROLLBACK=200） */
const SNAPSHOT_SCROLLBACK = 200;

function UserTerminalView({ entry, active }: { entry: TerminalEntry; active: boolean }) {
  const term = useTerminal({ lazy: true, id: entry.id });
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<'starting' | 'open' | 'error'>('starting');
  const lastSizeRef = useRef<{ cols: number; rows: number }>({ cols: 0, rows: 0 });
  const snapshotTimerRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // init xterm
  useEffect(() => {
    term.init();
    const t = setTimeout(() => setReady(true), 50);
    return () => {
      clearTimeout(t);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
    };
  }, [term.init]);

  // PTY 生命周期：挂载 → ensure（无则启动新 shell）→ attach 输出流；
  // 卸载 = detach（shell 继续跑，重挂载由 reviveBuffer 恢复屏幕）。
  // 🔴 依赖只放稳定标量（entry.id/cwd）：store 每次 revive 更新都产生新 entry
  // 对象，放进依赖 = effect 循环重挂。
  useEffect(() => {
    if (!ready || !isDesktop()) return;
    let disposed = false;
    let detach: (() => void) | null = null;
    let unsubExit: (() => void) | null = null;
    let inputDisposable: { dispose: () => void } | null = null;

    (async () => {
      try {
        const { created, shell } = await ensurePtyForTab(entry.id, entry.cwd);
        if (disposed) return;
        if (created) reportTerminalShell(entry.id, shell);

        // revive：恢复上次快照屏幕（重启 → 新 shell 垫底，VS Code parity；
        // 重挂载 → 补齐 detach 期间不可见的屏幕状态），live 输出随后追加
        const reviveBuffer = getTerminalsSnapshot().find((t) => t.id === entry.id)?.reviveBuffer;
        if (reviveBuffer) term.write?.(reviveBuffer);

        // 输入绑定（每次挂载都是新 xterm 实例，无需防重复）
        const xterm = term.terminalRef.current as
          | { onData: (cb: (data: string) => void) => { dispose: () => void }; cols: number; rows: number }
          | null;
        if (xterm) {
          inputDisposable = xterm.onData((data: string) => {
            void writePtyInput(entry.id, data);
          });
        }

        detach = attachPtyWriter(entry.id, (data) => {
          term.write?.(data);
          // 输出到达 → 节流快照（revive buffer）
          if (snapshotTimerRef.current === null) {
            snapshotTimerRef.current = window.setTimeout(async () => {
              snapshotTimerRef.current = null;
              const t = term.terminalRef.current;
              if (!t) return;
              const addon = await getSerializeAddon(t);
              if (addon) {
                try {
                  updateTerminalReviveBuffer(entry.id, addon.serialize({ scrollback: SNAPSHOT_SCROLLBACK }));
                } catch { /* 序列化失败静默 */ }
              }
            }, SNAPSHOT_THROTTLE_MS);
          }
        });

        // shell 退出 → 关 tab（对齐 Hermes onExit: drop the tab like a real terminal）
        unsubExit = onPtyExit(entry.id, () => {
          void disposePtyForTab(entry.id);
          closeTerminal(entry.id);
        });

        setStatus('open');
      } catch (err) {
        if (!disposed) {
          setStatus('error');
          term.write?.(`\r\n\x1b[31m终端启动失败: ${String(err)}\x1b[0m\r\n`);
        }
      }
    })();

    return () => {
      disposed = true;
      detach?.();
      unsubExit?.();
      inputDisposable?.dispose();
      if (snapshotTimerRef.current !== null) {
        window.clearTimeout(snapshotTimerRef.current);
        snapshotTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, entry.id, entry.cwd]);

  // 尺寸同步：fit 后 cols/rows 变化 → pty_resize（去重 lastSize）
  const syncSize = useCallback(() => {
    const t = term.terminalRef.current as { cols?: number; rows?: number } | null;
    if (!t?.cols || !t?.rows) return;
    if (t.cols === lastSizeRef.current.cols && t.rows === lastSizeRef.current.rows) return;
    lastSizeRef.current = { cols: t.cols, rows: t.rows };
    void resizePty(entry.id, t.cols, t.rows);
  }, [entry.id, term.terminalRef]);

  // 容器可见时 fit（ResizeObserver + window resize）
  useEffect(() => {
    if (!ready) return;
    const doFit = () => {
      if (term.containerRef.current?.offsetParent !== null) {
        term.fit();
        syncSize();
      }
    };
    const t = setTimeout(doFit, 60);
    const ro = new ResizeObserver(doFit);
    if (term.containerRef.current) ro.observe(term.containerRef.current);
    resizeObserverRef.current = ro;
    window.addEventListener('resize', doFit);
    return () => {
      clearTimeout(t);
      ro.disconnect();
      window.removeEventListener('resize', doFit);
    };
  }, [ready, term.fit, term.containerRef, syncSize]);

  // 激活时 re-fit + focus（hidden 容器中的 fit 是陈旧的 — 对齐 Hermes initialActiveFit）
  useEffect(() => {
    if (!active || !ready) return;
    const t = setTimeout(() => {
      term.fit();
      syncSize();
      term.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [active, ready, term.fit, term.focus, syncSize]);

  if (!isDesktop()) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground/70">
        交互式终端需要桌面环境
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/10 shrink-0">
        <div className="flex items-center gap-1.5">
          <TerminalIcon size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">{entry.title || '终端'}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/20 text-success">
            {status === 'open' ? '交互' : status === 'error' ? '错误' : '启动中'}
          </span>
        </div>
      </div>

      {/* Terminal container (xterm.js) — 文件树路径拖入（对齐 Hermes
          use-terminal-session drop：路径写入 shell 输入） */}
      <div
        className="flex-1 min-h-0 p-1"
        ref={term.containerRef}
        onDragOver={(e) => {
          if (dragHasPaths(e.dataTransfer)) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!dragHasPaths(e.dataTransfer)) return;
          e.preventDefault();
          const paths = collectDroppedPaths(e.dataTransfer);
          if (paths.length > 0) {
            // 含空格路径引号包裹，防 shell 拆词；末尾空格让路径直接进入输入区
            term.write?.(paths.map((p) => quoteShellPath(p)).join(' ') + ' ');
          }
          term.focus();
        }}
      />
    </>
  );
}

// ────────────────────────────────────────────────────────────────
// Agent tab — 后台进程只读镜像（对齐 Hermes AgentTerminalInstance）
//   实时流：agent.terminal.output 事件 → agent-terminal-stream 直写 xterm
//   快照兜底：process.list 轮询只做 syncAgentTerminalSnapshot 对账
// ────────────────────────────────────────────────────────────────

function AgentTerminalView({ entry, sessionId, active }: { entry: TerminalEntry; sessionId?: string; active: boolean }) {
  const term = useTerminal({ lazy: true, id: entry.id });
  const [ready, setReady] = useState(false);
  // 退出状态行已写（防每轮轮询重复）
  const exitedWrittenRef = useRef(false);

  // Initialize terminal on mount
  useEffect(() => {
    term.init();
    const t = setTimeout(() => setReady(true), 50);
    return () => clearTimeout(t);
  }, [term.init]);

  // 实时流接入（对齐 Hermes registerAgentTerminalWriter）：
  // 挂载即回放 backlog（中途打开/关闭重开的历史恢复），后续 chunk 直写
  useEffect(() => {
    if (!ready || !entry.procId || !term.write) return;
    seedAgentTerminalCommand(entry.procId, entry.title);
    const write = term.write;
    return registerAgentTerminalWriter(entry.procId, (chunk) => write(chunk));
  }, [ready, entry.procId, entry.title, term.write]);

  // 快照兜底（对齐 Hermes syncAgentTerminalSnapshot 语义）：旧网关无事件 /
  // 事件竞态时由尾窗前缀对账补齐；滚动尾窗滑动 → 重置重写（不再手工偏移）
  useEffect(() => {
    if (!ready || !entry.procId || !sessionId) return;
    let cancelled = false;
    const sync = async () => {
      if (cancelled) return;
      try {
        const res = await listProcesses(sessionId);
        const proc = (res.processes || []).find((p) => String(p.session_id) === entry.procId);
        if (!proc) return;
        if (!cancelled) syncAgentTerminalSnapshot(entry.procId!, String(proc.output_tail || ''));
        if (proc.status === 'exited' && !exitedWrittenRef.current) {
          exitedWrittenRef.current = true;
          term.write(`\r\n\x1b[90m[进程已退出 exit_code=${proc.exit_code ?? '?'}${proc.completion_reason ? ` · ${proc.completion_reason}` : ''}]\x1b[0m\r\n`);
        }
      } catch { /* 会话可能不存在，静默 */ }
    };
    sync();
    const i = setInterval(sync, 5000);
    return () => { cancelled = true; clearInterval(i); };
  }, [ready, entry.procId, sessionId, term.write]);

  // 激活时 re-fit（hidden 容器中 fit 陈旧）
  useEffect(() => {
    if (!active || !ready) return;
    const t = setTimeout(() => term.fit(), 30);
    return () => clearTimeout(t);
  }, [active, ready, term.fit]);

  return (
    <>
      {/* Header（只读镜像无清屏 — backlog 回放语义下清屏会立即被快照重写） */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/10 shrink-0">
        <div className="flex items-center gap-1.5">
          <TerminalIcon size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">{entry.title || '终端'}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-info/20 text-info">只读</span>
        </div>
      </div>

      {/* Agent terminal notice */}
      <div className="px-3 py-1 text-[10px] text-muted-foreground/60 bg-muted/10 border-b border-border/50 shrink-0">
        只读终端 — Agent 后台进程输出实时镜像（进程不会被关闭）
      </div>

      {/* Terminal container (xterm.js) */}
      <div className="flex-1 min-h-0 p-1" ref={term.containerRef} />
    </>
  );
}
