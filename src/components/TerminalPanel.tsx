/**
 * TerminalPanel — 多 tab 终端面板
 *
 * 对齐 Hermes apps/desktop/src/app/right-sidebar/terminal/workspace.tsx + rail.tsx
 * - Tab 栏：显示所有 TerminalEntry（user + agent）
 * - User tab：Agent 终端活动日志（terminal tool-call 回放 + 本地命令交互）
 * - Agent tab：后台进程只读镜像（process.list 轮询增量写 output_tail）
 * - 关闭 tab → closeTerminal() → 焦点滑到邻居
 *
 * Tier 3 修复：
 * - 4-1：每 tab 独立 xterm 实例（key=tab.id 重建），agent 镜像与 user 日志互不串扰
 * - 4-5：ensureAgentTerminal surface 接线 + 进程镜像内容链路（listProcesses 轮询）
 * - 4-3：流式 tool 结果补写（writtenPrompt/writtenResult 双标记）
 */
import { useEffect, useRef, useCallback, useState, useMemo, useSyncExternalStore } from 'react';
import { Terminal as TerminalIcon, Trash2, Send, X, Plus } from 'lucide-react';
import useTerminal from '../hooks/useTerminal';
import type { ChatMessage, ChatMessagePart } from '@/types';
import { listProcesses } from '../utils/api';
import {
  subscribeTerminals,
  getTerminalsSnapshot,
  getActiveTerminalIdSnapshot,
  selectTerminal,
  closeTerminal,
  createTerminal,
  ensureTerminal,
  ensureAgentTerminal,
  type TerminalEntry,
} from '@/store/terminals';

// Import xterm CSS
import '@xterm/xterm/css/xterm.css';

import { useMessages } from '@/store/messages';
import { setActiveTerminalId } from '@/store/terminal-buffer';

interface TerminalPanelProps {
  onSend?: (text: string) => void;
  isStreaming?: boolean;
  sessionId?: string;
}

export default function TerminalPanel({ onSend, isStreaming = false, sessionId }: TerminalPanelProps) {
  const tabs = useSyncExternalStore(subscribeTerminals, getTerminalsSnapshot);
  const activeId = useSyncExternalStore(subscribeTerminals, getActiveTerminalIdSnapshot);
  const activeTab = useMemo(() => tabs.find(t => t.id === activeId) ?? null, [tabs, activeId]);

  // Ensure at least one tab on mount
  useEffect(() => { ensureTerminal(); }, []);

  // 对齐 Hermes: tab 切换时同步 setActiveTerminalId → read_terminal 工具读取当前活跃 tab
  useEffect(() => { setActiveTerminalId(activeId); }, [activeId]);

  // 4-5：把 Agent 后台进程 surface 为只读 tab（对齐 Hermes workspace.tsx 的
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
              onClick={(e) => { e.stopPropagation(); closeTerminal(tab.id); }}
            >
              <X size={10} />
            </span>
          </button>
        ))}
        {/* New tab button */}
        <button
          className="p-1 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors shrink-0"
          onClick={() => createTerminal()}
          title="新建终端"
        >
          <Plus size={12} />
        </button>
      </div>

      {/* 4-1：每 tab 独立 xterm 实例（key=tab.id 强制重建） */}
      {activeTab?.kind === 'agent'
        ? <AgentTerminalView key={activeTab.id} entry={activeTab} sessionId={sessionId} />
        : activeTab
          ? <UserTerminalView key={activeTab.id} entry={activeTab} onSend={onSend} isStreaming={isStreaming} sessionId={sessionId} />
          : null}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// User tab — Agent 终端活动日志 + 本地命令交互
// ────────────────────────────────────────────────────────────────

function UserTerminalView({ entry, onSend, isStreaming = false, sessionId }: {
  entry: TerminalEntry;
  onSend?: (text: string) => void;
  isStreaming?: boolean;
  sessionId?: string;
}) {
  const messages = useMessages();
  const term = useTerminal({ lazy: true, id: entry.id });
  const [ready, setReady] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [executing, setExecuting] = useState(false);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // 4-3：拆分标记 — 命令提示符与结果分开记账，流式结果到达后可补写
  const writtenPromptIdsRef = useRef(new Set<string>());
  const writtenResultIdsRef = useRef(new Set<string>());
  const initWrittenRef = useRef(false);

  // Extract terminal tool-call parts from assistant messages
  const terminalEntries = useMemo(() => {
    const entries: Array<{ callId: string; argsStr: string; resultStr?: string }> = [];
    messages.forEach((m: ChatMessage) => {
      if (m.role !== 'assistant' || !m.parts) return;
      m.parts.forEach((part: ChatMessagePart) => {
        if (part.type === 'tool-call' && part.toolName === 'terminal' && part.argsText) {
          entries.push({
            callId: part.toolCallId,
            argsStr: part.argsText,
            resultStr: part.result != null
              ? (typeof part.result === 'string' ? part.result : JSON.stringify(part.result))
              : undefined,
          });
        }
      });
    });
    return entries;
  }, [messages]);

  const responseMap = useMemo(() => {
    const map: Record<string, string> = {};
    messages.forEach((m: ChatMessage) => {
      if (m.role !== 'assistant' || !m.parts) return;
      const hasTerminal = m.parts.some(p => p.type === 'tool-call' && p.toolName === 'terminal');
      if (!hasTerminal) return;
      const textParts = m.parts
        .filter((p): p is Extract<ChatMessagePart, { type: 'text' }> => p.type === 'text')
        .map(p => p.text).join('');
      if (!textParts) return;
      m.parts.forEach((part: ChatMessagePart) => {
        if (part.type === 'tool-call' && part.toolName === 'terminal') {
          map[part.toolCallId] = textParts;
        }
      });
    });
    return map;
  }, [messages]);

  // Initialize terminal on mount
  useEffect(() => {
    term.init();
    initWrittenRef.current = true;
    setTimeout(() => setReady(true), 50);
    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
    };
  }, [term]);

  // Fit terminal when container is visible and on resize
  useEffect(() => {
    if (!ready || !term.containerRef.current) return;
    const doFit = () => {
      if (term.containerRef.current?.offsetParent !== null) term.fit();
    };
    setTimeout(doFit, 100);
    if (term.containerRef.current) {
      const ro = new ResizeObserver(() => doFit());
      ro.observe(term.containerRef.current);
      resizeObserverRef.current = ro;
    }
    window.addEventListener('resize', doFit);
    return () => { window.removeEventListener('resize', doFit); };
  }, [ready, term]);

  // Write new terminal tool entries to xterm
  // 4-3 修复：命令提示符一旦出现立即显示；结果（responseMap/part.result）到达后补写，
  // 不再预标记 writtenCallIds 导致流式结果永不落盘
  useEffect(() => {
    if (!ready || !term.write) return;
    terminalEntries.forEach((entryItem) => {
      const callId = entryItem.callId;
      if (!callId) return;
      if (!writtenPromptIdsRef.current.has(callId)) {
        writtenPromptIdsRef.current.add(callId);
        term.write(`\r\n\x1b[1;33m$ ${entryItem.argsStr}\x1b[0m\r\n`);
      }
      const resp = responseMap[callId] || entryItem.resultStr;
      if (resp && !writtenResultIdsRef.current.has(callId)) {
        writtenResultIdsRef.current.add(callId);
        const truncated = resp.length > 2000 ? resp.slice(0, 2000) + '\n... (truncated)' : resp;
        term.write(`\x1b[90m${truncated}\x1b[0m\r\n`);
      }
    });
  }, [terminalEntries, responseMap, ready, term]);

  // Scroll to bottom on new output
  useEffect(() => {
    if (!ready || !term.terminalRef.current) return;
    const termEl = term.terminalRef.current as { textarea?: HTMLTextAreaElement; scrollToBottom?: () => void; element?: HTMLElement };
    try { termEl.scrollToBottom?.(); } catch { /* ignore */ }
  }, [terminalEntries, ready, term]);

  // Focus on mount
  useEffect(() => {
    if (ready) setTimeout(() => { term.focus(); inputRef.current?.focus(); }, 200);
  }, [ready, term]);

  const handleClear = useCallback(() => {
    term.clear();
    writtenPromptIdsRef.current = new Set();
    writtenResultIdsRef.current = new Set();
    term.write('\x1b[32m╔══════════════════════════════════════════╗\x1b[0m\r\n');
    term.write('\x1b[32m║  \x1b[1;37mAgent 终端助手\x1b[0m\x1b[32m                        ║\x1b[0m\r\n');
    term.write('\x1b[32m║  命令由 Agent 远程执行并返回结果              ║\x1b[0m\r\n');
    term.write('\x1b[32m╚══════════════════════════════════════════╝\x1b[0m\r\n');
  }, [term]);

  const handleSendCommand = useCallback(async () => {
    const cmd = inputValue.trim();
    if (!cmd || isStreaming || executing) return;
    setInputValue('');
    setExecuting(true);
    if (term.write) term.write(`\r\n\x1b[1;33m$ ${cmd}\x1b[0m\r\n`);
    // 🔴 修复（右侧抽屉断线2）：旧逻辑有 sessionId 时走 command.dispatch name='terminal'，
    // 后端无 /terminal 斜杠命令 → 实测恒报 "Unknown command /terminal" → 终端永远执行不了命令。
    // 统一走 onSend(cmd)：handleSend 自带斜杠命令拦截（/new 等 → handleCommand），
    // 普通命令作为用户消息发给 Agent，由 Agent 用 terminal 工具执行，结果经 tool-call 回放写回本终端。
    try {
      onSend?.(cmd);
    } finally {
      setExecuting(false);
    }
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [inputValue, isStreaming, executing, onSend, term]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendCommand(); }
    },
    [handleSendCommand]
  );

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/10 shrink-0">
        <div className="flex items-center gap-1.5">
          <TerminalIcon size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">{entry.title || '终端'}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-primary">Agent</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            className="p-1 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            onClick={handleClear}
            title="清屏"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Agent terminal notice */}
      <div className="px-3 py-1 text-[10px] text-muted-foreground/60 bg-muted/10 border-b border-border/50 shrink-0">
        终端功能通过 Agent 命令使用 — 在下方输入命令，Agent 将远程执行
      </div>

      {/* Terminal container (xterm.js) */}
      <div className="flex-1 min-h-0 p-1" ref={term.containerRef} />

      {/* Command input bar — only for user tabs */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-t border-border bg-background shrink-0">
        <span className="text-[11px] font-mono text-primary shrink-0" title="通过 Agent 远程执行">
          Agent $
        </span>
        <input
          ref={inputRef}
          className="flex-1 px-2 py-1 text-xs font-mono bg-muted/20 border border-input rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
          type="text"
          value={inputValue}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={executing ? '执行中...' : '输入命令（例如: ls -la）…'}
          disabled={isStreaming || executing}
        />
        <button
          className="p-1.5 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-40"
          onClick={handleSendCommand}
          disabled={!inputValue.trim() || isStreaming || executing}
          title="发送命令给 Agent 执行"
        >
          <Send size={12} />
        </button>
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────
// Agent tab — 后台进程只读镜像（4-5 链路补全）
//   process.list 轮询 → output_tail 增量写入独立 xterm
// ────────────────────────────────────────────────────────────────

function AgentTerminalView({ entry, sessionId }: { entry: TerminalEntry; sessionId?: string }) {
  const term = useTerminal({ lazy: true, id: entry.id });
  const [ready, setReady] = useState(false);
  // 已写入的 output_tail 长度（增量写入）
  const writtenTailLenRef = useRef(0);
  // 命令标题/状态头已 seed
  const seededRef = useRef(false);
  // 退出状态行已写（防每轮轮询重复）
  const exitedWrittenRef = useRef(false);

  // Initialize terminal on mount
  useEffect(() => {
    term.init();
    setTimeout(() => setReady(true), 50);
  }, [term]);

  // 4-5：镜像内容 — 轮询 process.list，增量写 output_tail
  useEffect(() => {
    if (!ready || !entry.procId || !sessionId) return;
    let cancelled = false;
    const sync = async () => {
      if (cancelled) return;
      try {
        const res = await listProcesses(sessionId);
        const proc = (res.processes || []).find(p => String(p.session_id) === entry.procId);
        if (!proc) return;
        if (!seededRef.current) {
          seededRef.current = true;
          writtenTailLenRef.current = 0;
          term.write(`\r\n\x1b[1;33m$ ${entry.title}\x1b[0m\r\n`);
        }
        const tail = String(proc.output_tail || '');
        if (tail.length > writtenTailLenRef.current) {
          term.write(tail.slice(writtenTailLenRef.current));
          writtenTailLenRef.current = tail.length;
        }
        if (proc.status === 'exited' && !exitedWrittenRef.current) {
          exitedWrittenRef.current = true;
          term.write(`\r\n\x1b[90m[进程已退出 exit_code=${proc.exit_code ?? '?'}${proc.completion_reason ? ` · ${proc.completion_reason}` : ''}]\x1b[0m\r\n`);
        }
      } catch { /* 会话可能不存在，静默 */ }
    };
    sync();
    const i = setInterval(sync, 5000);
    return () => { cancelled = true; clearInterval(i); };
  }, [ready, entry, sessionId, term]);

  const handleClear = useCallback(() => {
    term.clear();
    seededRef.current = false;
    writtenTailLenRef.current = 0;
    exitedWrittenRef.current = false;
    // 清屏后下一次轮询会重新 seed 命令标题 + 全量 tail
  }, [term]);

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/10 shrink-0">
        <div className="flex items-center gap-1.5">
          <TerminalIcon size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">{entry.title || '终端'}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-info/20 text-info">只读</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            className="p-1 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            onClick={handleClear}
            title="清屏"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Agent terminal notice */}
      <div className="px-3 py-1 text-[10px] text-muted-foreground/60 bg-muted/10 border-b border-border/50 shrink-0">
        只读终端 — Agent 后台进程输出镜像（进程不会被关闭）
      </div>

      {/* Terminal container (xterm.js) */}
      <div className="flex-1 min-h-0 p-1" ref={term.containerRef} />
    </>
  );
}
