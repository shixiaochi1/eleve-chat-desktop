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
import type { CSSProperties } from 'react';
import { Terminal as TerminalIcon, X, Plus } from 'lucide-react';
import { dragHasPaths, collectDroppedPaths } from '@/lib/paths-dnd';
import { requestComposerInsert } from '@/lib/composer-events';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import {
  isAddSelectionShortcut,
  terminalSelectionLabel,
  quotePathForShell,
  parseOscCwd,
  isMacPlatform,
} from '@/lib/terminal-extras';
import useTerminal from '../hooks/useTerminal';
import { listProcesses } from '../utils/api';
import { isDesktop } from '@/utils/bridge';
import { cn } from '@/lib/utils';
import { subscribeTerminalInjection, getTerminalInjectionSnapshot, clearTerminalInjection } from '@/lib/terminal-injection';
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
  updateTerminalRestoreCwd,
  closeOtherTerminals,
  closeAllTerminals,
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
  // 🔴 2026-08-11 对齐 Hermes：process.list 空 session_id = 全量——所有会话的
  // 后台进程都 surface（原实现只查当前 sessionId → 其它会话/宫格卡片会话的
  // Agent tab 不出现 = 功能遗失）。Hermes $backgroundStatusBySession 按 runtime
  // session 键控聚合全量，workspace.tsx 遍历全量 ensure + seed + sync 三连
  // （seed 幂等：tab 创建即显示 `$ command` 命令头，不依赖 tab 被打开）。
  useEffect(() => {
    let cancelled = false;
    const surface = async () => {
      try {
        const res = await listProcesses('');
        for (const p of res.processes || []) {
          if (cancelled) return;
          const title = p.command.length > 30 ? `${p.command.slice(0, 30)}…` : p.command;
          ensureAgentTerminal(String(p.session_id), title || 'agent');
          seedAgentTerminalCommand(String(p.session_id), title || 'agent');
        }
      } catch { /* 会话可能不存在，静默 */ }
    };
    surface();
    const i = setInterval(surface, 5000);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  // 关闭 tab：先 dispose PTY（agent tab 无 PTY 则 no-op），再走 store 焦点滑动
  const handleCloseTab = useCallback((id: string) => {
    void disposePtyForTab(id);
    closeTerminal(id);
  }, []);

  // 会话↔终端联动（对齐 Hermes $currentCwd.listen：进入 cwd 已有 user tab 指向的
  // 会话 → 重新选中该 tab；只选中，不创建/不关闭/不显示面板）。
  // ELEVE 的 cwd 是 React state（sessionCwd），在此 effect 消费。
  useEffect(() => {
    if (!cwd) return;
    const norm = (p?: string) => {
      const t = (p ?? '').trim();
      return t.length > 1 ? t.replace(/[\\/]+$/, '') || t : t;
    };
    const target = norm(cwd);
    const list = getTerminalsSnapshot();
    const active = list.find((t) => t.id === getActiveTerminalIdSnapshot());
    if (active?.kind === 'user' && norm(active.restoreCwd || active.cwd) === target) return;
    const match = list.find((t) => t.kind === 'user' && norm(t.restoreCwd || t.cwd) === target);
    if (match) selectTerminal(match.id);
  }, [cwd]);

  return (
    // 🔴 2026-08-18 老大需求：终端卡片整体走卡片色（bg-card = --dt-card =
    // 右侧面板 --ui-card-bg 同源）——原 bg-background 使整卡呈现背板色，
    // 与右侧抽屉卡片割裂；标题栏同步从背板色调改卡片色。
    <div className="flex flex-col flex-1 min-h-0 bg-card">
      {/* Tab bar — 右键菜单（关闭/关闭其他/关闭全部，对齐 Hermes TerminalRail） */}
      <div className="flex items-center gap-0 px-1 py-0.5 border-b border-border bg-card shrink-0 overflow-x-auto">
        {tabs.map((tab) => (
          <ContextMenu key={tab.id}>
            <ContextMenuTrigger asChild>
              <button
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
            </ContextMenuTrigger>
            <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
              <ContextMenuItem onSelect={() => handleCloseTab(tab.id)}>关闭</ContextMenuItem>
              <ContextMenuItem disabled={tabs.length <= 1} onSelect={() => closeOtherTerminals(tab.id)}>关闭其他</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={closeAllTerminals}>关闭全部</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
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

      {/* 所有 tab 常驻挂载，非活跃 invisible + pointer-events-none（对齐 Hermes
          INSTANCE_CLASS absolute+visibility：display:none 会让 xterm host 0×0，
          重显示时布局/渲染乱；absolute 堆叠保持布局尺寸，切 tab 不销毁 xterm/PTY） */}
      <div className="relative flex-1 min-h-0">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn('absolute inset-0 flex flex-col', tab.id !== activeId && 'invisible pointer-events-none')}
          >
            {tab.kind === 'agent'
              ? <AgentTerminalView active={tab.id === activeId} entry={tab} />
              : <UserTerminalView active={tab.id === activeId} entry={tab} />}
          </div>
        ))}
      </div>
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

/**
 * 清理 revive 快照：去除尾部 idle prompt，防止每次重启多一行 prompt
 * 对齐 Hermes cleanReviveSnapshot（use-terminal-session.ts L200-224）
 */

// 剥除 ANSI 转义序列，仅留可见文本
function stripEscapeSequences(data: string): string {
  let index = 0;
  let text = '';
  while (index < data.length) {
    const sequence = readEscapeSequence(data, index);
    if (sequence) {
      index += sequence.length;
    } else {
      text += data[index];
      index += 1;
    }
  }
  return text;
}

// 只保留 ANSI 转义序列，丢弃可见文本（应用控制码而不写 spacer）
function keepEscapeSequences(data: string): string {
  let index = 0;
  let out = '';
  while (index < data.length) {
    if (data.charCodeAt(index) === 0x1b) {
      const sequence = readEscapeSequence(data, index);
      if (sequence) {
        out += sequence;
        index += sequence.length;
        continue;
      }
    }
    index += 1;
  }
  return out;
}

// 识别一个 ANSI 转义序列（CSI/OSC/三字节字符集/短 ESC 形式）
function readEscapeSequence(data: string, index: number): string | null {
  if (data.charCodeAt(index) !== 0x1b || index + 1 >= data.length) return null;
  const kind = data[index + 1];
  if (kind === '[') {
    for (let i = index + 2; i < data.length; i += 1) {
      const code = data.charCodeAt(i);
      if (code >= 0x40 && code <= 0x7e) return data.slice(index, i + 1);
    }
  }
  if (kind === ']') {
    for (let i = index + 2; i < data.length; i += 1) {
      if (data.charCodeAt(i) === 0x07) return data.slice(index, i + 1);
      if (data.charCodeAt(i) === 0x1b && data[i + 1] === '\\') return data.slice(index, i + 2);
    }
  }
  // 字符集等三字节 ESC 形式（ESC ( B）。只认 ESC+( 会把选择符当可打印文本，
  // 提前解除 prompt-gap 剥离器（Hermes 注释原文）
  if (['(', ')', '*', '+', '-', '.', '/'].includes(kind) && index + 2 < data.length) {
    return data.slice(index, index + 3);
  }
  return data.slice(index, Math.min(index + 2, data.length));
}

// 行内容去 ANSI + 全部空白 + zsh `%` 标记 —— '' 表示 spacer/prompt-gap/标记行
const visibleText = (line: string) => stripEscapeSequences(line).replace(/[\s%]/g, '');

/**
 * 对齐 Hermes cleanReviveSnapshot：剥尾部 idle prompt（双形态：
 * spaced 多行 prompt 剥到最后一个空行；单行 prompt 剥最后一行）
 */
function cleanReviveSnapshot(serialized: string): string {
  const lines = serialized.split(/\r?\n/);
  while (lines.length && !visibleText(lines[lines.length - 1])) {
    lines.pop();
  }
  if (lines.length === 0) return '';
  // findLastIndex 兼容（tsconfig lib < es2023）
  let lastBlank = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!visibleText(lines[i])) { lastBlank = i; break; }
  }
  const spacedPrompt = lastBlank >= 0 && lines.length - 1 - lastBlank <= 3;
  lines.length = spacedPrompt ? lastBlank : lines.length - 1;
  return lines.join('\r\n');
}

/**
 * 对齐 Hermes isIdlePromptOnly：无真实 scrollback（空、或仅重复同一行 idle prompt）
 * 才判定 idle——真实会话（prompt+命令+输出）行必然多样，短历史不会被误判
 */
function isIdlePromptOnly(serialized: string): boolean {
  const lines = serialized.split(/\r?\n/).map(visibleText).filter(Boolean);
  return lines.length === 0 || lines.every((line) => line === lines[0]);
}

/**
 * 对齐 Hermes stripInitialPromptGap：剥离开头空白行但保留 ANSI 控制码前缀
 */
function stripInitialPromptGap(data: string): string {
  let index = 0;
  let prefix = '';
  while (index < data.length) {
    const sequence = readEscapeSequence(data, index);
    if (sequence) {
      prefix += sequence;
      index += sequence.length;
    } else if (data[index] === '\r' || data[index] === '\n') {
      index += 1;
    } else {
      return prefix + data.slice(index);
    }
  }
  return prefix;
}

/**
 * 应用正在关闭标志（对齐 Hermes appTearingDown）
 * 防止在应用退出时清理 PTY 状态，避免重启后丢失
 */
let appTearingDown = false;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    appTearingDown = true;
  });
  window.addEventListener('pagehide', () => {
    appTearingDown = true;
  });
}

function UserTerminalView({ entry, active }: { entry: TerminalEntry; active: boolean }) {
  // ── 选区入聊天（对齐 Hermes selection.ts）──
  const [selection, setSelection] = useState('');
  const [selectionAnchor, setSelectionAnchor] = useState<CSSProperties | null>(null);
  const selectionLabelRef = useRef('');
  const shellNameRef = useRef('shell');
  /** 用户是否曾输入（对齐 Hermes hasSessionActivityRef：门控 revive 快照，
   *  idle tab 永不重存 → 防每次重启多一行 prompt 的膨胀） */
  const hasSessionActivityRef = useRef(false);
  /** 是否正在剥离初始 prompt gap（对齐 Hermes stripLeading） */
  const stripLeadingRef = useRef(true);

  const term = useTerminal({
    lazy: true,
    id: entry.id,
    // 选区变化 → 浮动按钮 + ⌘L（镜像已在 useTerminal 内部完成）
    onSelectionChange: (text, anchor) => {
      setSelection(text);
      setSelectionAnchor(anchor);
      selectionLabelRef.current = text.trim()
        ? terminalSelectionLabel(term.terminalRef.current, shellNameRef.current, text)
        : '';
    },
  });

  // ⌘/Ctrl+L 选区入聊天（对齐 Hermes 全局 capture keydown：有文本才吞，
  // 无文本放行到 shell 当清屏；TUI 重绘竞态 → 直接读 xterm 而非 state）
  const addSelectionToChat = useCallback(() => {
    const text = (term.terminalRef.current?.getSelection() || selection).trim();
    if (!text) return;
    // ELEVE 语义：code block 包裹插入输入框（对齐 PreviewConsolePanel 发送到输入区）
    requestComposerInsert(`\`\`\`\n${text}\n\`\`\`\n`);
    term.terminalRef.current?.clearSelection();
    setSelection('');
    setSelectionAnchor(null);
    selectionLabelRef.current = '';
  }, [term.terminalRef, selection]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const termInst = term.terminalRef.current;
      const hasText = Boolean((termInst?.getSelection() || '').trim());
      if (!isAddSelectionShortcut(event) || !hasText) return;
      event.preventDefault();
      event.stopPropagation();
      addSelectionToChat();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [addSelectionToChat, term.terminalRef]);

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
    let oscCleanupFns: Array<{ dispose: () => void }> = [];

    (async () => {
      try {
        // restoreCwd：上次会话观察到的 shell 实际 cwd（OSC 7/9;9）优先，
        // 重开 tab 落在用户最后 cd 的目录（对齐 Hermes start({ cwd: restoreCwd || cwd })）
        const { created, shell } = await ensurePtyForTab(entry.id, entry.cwd, entry.restoreCwd);
        if (disposed) return;
        if (created) {
          shellNameRef.current = shell;
          reportTerminalShell(entry.id, shell);
        }

        // revive：恢复上次快照屏幕（重启 → 新 shell 垫底，VS Code parity；
        // 重挂载 → 补齐 detach 期间不可见的屏幕状态），live 输出随后追加
        const reviveBuffer = getTerminalsSnapshot().find((t) => t.id === entry.id)?.reviveBuffer;
        if (reviveBuffer && !isIdlePromptOnly(reviveBuffer)) {
          term.write?.(reviveBuffer);
        }

        // 输入绑定（每次挂载都是新 xterm 实例，无需防重复）
        const xterm = term.terminalRef.current as
          | {
              onData: (cb: (data: string) => void) => { dispose: () => void };
              parser: { registerOscHandler: (code: number, cb: (payload: string) => boolean) => { dispose: () => void } };
              cols: number;
              rows: number;
            }
          | null;
        if (xterm) {
          inputDisposable = xterm.onData((data: string) => {
            hasSessionActivityRef.current = true;
            void writePtyInput(entry.id, data);
          });

          // OSC 7 / OSC 9;9 cwd 追踪（对齐 Hermes cwdOscHandlers：观察不消费，
          // 序列继续传播；restoreCwd 供重开 tab 恢复最后 cd 目录）
          const oscCleanups = ([7, 9] as const).map((code) =>
            xterm.parser.registerOscHandler(code, (payload) => {
              const parsed = parseOscCwd(code, payload);
              if (parsed) updateTerminalRestoreCwd(entry.id, parsed);
              return false; // let the sequence propagate; we only observe it
            }),
          );
          oscCleanupFns = oscCleanups;
        }

        detach = attachPtyWriter(entry.id, (data) => {
          // 🔴 armedWrite（对齐 Hermes use-terminal-session.ts armedWrite）：
          // 首次输出 strip 初始 prompt gap；纯 spacer（无可见内容：spacer/清屏/
          // zsh % 标记）只应用控制码、丢弃空白文本并保持武装 → prompt 始终落顶部
          if (stripLeadingRef.current) {
            const next = stripInitialPromptGap(data);
            const visible = stripEscapeSequences(next).replace(/[\s%]/g, '');
            if (!visible) {
              const controls = keepEscapeSequences(next);
              if (controls) term.write?.(controls);
              // 保持武装：spacer 不解除，下个输出继续剥
            } else {
              stripLeadingRef.current = false;
              term.write?.(next);
            }
          } else {
            term.write?.(data);
          }
          // 输出到达 → 节流快照（revive buffer）
          // 🔴 activity 门控（对齐 Hermes hasSessionActivityRef）：无用户输入的
          // idle tab 不重存——live buffer 是重放的快照 + 新 prompt，重存 = 每
          // 次重启多一行 prompt 的膨胀（Hermes #61572）
          if (snapshotTimerRef.current === null && hasSessionActivityRef.current) {
            snapshotTimerRef.current = window.setTimeout(async () => {
              snapshotTimerRef.current = null;
              const t = term.terminalRef.current;
              if (!t) return;
              const addon = await getSerializeAddon(t);
              if (addon) {
                try {
                  const snapshot = addon.serialize({ scrollback: SNAPSHOT_SCROLLBACK });
                  updateTerminalReviveBuffer(entry.id, cleanReviveSnapshot(snapshot));
                } catch { /* 序列化失败静默 */ }
              }
            }, SNAPSHOT_THROTTLE_MS);
          }
        });

        // shell 退出 → 关 tab（对齐 Hermes onExit: drop the tab like a real terminal）
        // 🔴 appTearingDown 保护：应用退出时不清理 tab，避免重启后丢失
        unsubExit = onPtyExit(entry.id, () => {
          if (appTearingDown) return;
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
      oscCleanupFns.forEach((h) => h.dispose());
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

  // 终端命令注入 flush（对齐 Hermes $terminalInjection subscribe：活跃 tab + session
  // open 才消费；写 PTY 输入 + 清空防重放；值在面板挂载前设置也能跑）
  useEffect(() => {
    if (!active || status !== 'open') return;
    return subscribeTerminalInjection(() => {
      const command = getTerminalInjectionSnapshot();
      if (!command) return;
      clearTerminalInjection();
      hasSessionActivityRef.current = true;
      void writePtyInput(entry.id, `${command}\r`);
      term.focus();
    });
  }, [active, status, entry.id, term.focus]);

  if (!isDesktop()) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground/70">
        交互式终端需要桌面环境
      </div>
    );
  }

  return (
    <>
      {/* Header — 🔴 2026-08-18 卡片色（原 bg-muted/10 叠背板呈背板色） */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-1.5">
          <TerminalIcon size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">{entry.title || '终端'}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/20 text-success">
            {status === 'open' ? '交互' : status === 'error' ? '错误' : '启动中'}
          </span>
        </div>
      </div>

      {/* Terminal container (xterm.js) — 文件树路径拖入（对齐 Hermes
          use-terminal-session drop：路径写入 shell 输入，按 shell 类型转义）+ 选区浮动按钮
          🔴 host 必须 h-full：父级 `relative flex-1` 非 flex 容器，flex-1 失效 →
          host 高度 0 → FitAddon rows=0 → 终端空白（对齐 Hermes HOST_CLASS=h-full） */}
      <div className="relative flex-1 min-h-0">
        <div
          className="h-full min-h-0 p-1"
          ref={term.containerRef}
          onDragOver={(e) => {
            if (dragHasPaths(e.dataTransfer)) e.preventDefault();
          }}
          onDrop={(e) => {
            if (!dragHasPaths(e.dataTransfer)) return;
            e.preventDefault();
            const paths = collectDroppedPaths(e.dataTransfer);
            if (paths.length > 0) {
              // 按 shell 类型转义（powershell '..'' / cmd ".."" / posix '..'\''..'），
              // 对齐 Hermes quotePathForShell；末尾空格让路径直接进入输入区
              hasSessionActivityRef.current = true;
              term.write?.(paths.map((p) => quotePathForShell(p, shellNameRef.current)).join(' ') + ' ');
            }
            term.focus();
          }}
        />

        {/* ⌘/Ctrl+L 选区入聊天浮动按钮（对齐 Hermes TerminalInstance selection popover） */}
        {selection.trim() && (
          <div
            className="absolute z-50 flex items-center gap-1"
            style={selectionAnchor ?? { right: 12, top: 8 }}
          >
            <button
              type="button"
              className="h-6 rounded-md px-2 text-[0.68rem] shadow-md backdrop-blur-md bg-accent text-accent-foreground border border-border/50 hover:bg-accent/90"
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); addSelectionToChat(); }}
              title={`发送到聊天（${isMacPlatform() ? '⌘' : 'Ctrl'}+L）· ${selectionLabelRef.current || 'selection'}`}
            >
              发送到聊天
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────
// Agent tab — 后台进程只读镜像（对齐 Hermes AgentTerminalInstance）
//   实时流：agent.terminal.output 事件 → agent-terminal-stream 直写 xterm
//   快照兜底：process.list 轮询只做 syncAgentTerminalSnapshot 对账
// ────────────────────────────────────────────────────────────────

function AgentTerminalView({ entry, active }: { entry: TerminalEntry; active: boolean }) {
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
  // 🔴 2026-08-11 全量：空 session_id 查全部进程（对齐 Hermes workspace.tsx
  // $backgroundStatusBySession 聚合；原实现只查当前会话 → 其它会话进程
  // Agent tab 内容空白 = 功能遗失）
  useEffect(() => {
    if (!ready || !entry.procId) return;
    let cancelled = false;
    const sync = async () => {
      if (cancelled) return;
      try {
        const res = await listProcesses('');
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
  }, [ready, entry.procId, term.write]);

  // 激活时 re-fit（hidden 容器中 fit 陈旧）
  useEffect(() => {
    if (!active || !ready) return;
    const t = setTimeout(() => term.fit(), 30);
    return () => clearTimeout(t);
  }, [active, ready, term.fit]);

  return (
    <>
      {/* Header（只读镜像无清屏 — backlog 回放语义下清屏会立即被快照重写）
          🔴 2026-08-18 卡片色（原 bg-muted/10 叠背板呈背板色） */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-1.5">
          <TerminalIcon size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">{entry.title || '终端'}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-info/20 text-info">只读</span>
        </div>
      </div>

      {/* Agent terminal notice — 🔴 2026-08-18 卡片色 */}
      <div className="px-3 py-1 text-[10px] text-muted-foreground/60 bg-card border-b border-border/50 shrink-0">
        只读终端 — Agent 后台进程输出实时镜像（进程不会被关闭）
      </div>

      {/* Terminal container (xterm.js) */}
      <div className="flex-1 min-h-0 p-1" ref={term.containerRef} />
    </>
  );
}
