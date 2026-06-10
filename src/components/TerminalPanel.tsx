/**
 * TerminalPanel — Agent 终端工具状态面板
 *
 * 不再使用 demoMode 伪终端回显。从 messages 中提取 Agent 的 terminal 工具调用，
 * 在 xterm.js 中显示命令历史，下方输入框可发送 /terminal 命令给 Agent。
 */
import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { Terminal as TerminalIcon, Trash2, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import useTerminal from '../hooks/useTerminal';
import type { ChatMessage, ChatMessagePart } from '@/types';
import { call } from '../utils/bridge';

// Import xterm CSS
import '@xterm/xterm/css/xterm.css';

import { useMessages } from '@/store/messages';

interface TerminalPanelProps {
  onSend?: (text: string) => void;
  isStreaming?: boolean;
  sessionId?: string;
}

export default function TerminalPanel({ onSend, isStreaming = false, sessionId }: TerminalPanelProps) {
  const messages = useMessages();
  const term = useTerminal({ lazy: true });
  const [ready, setReady] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [executing, setExecuting] = useState(false);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const writtenCallIdsRef = useRef(new Set<string>());
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

  // Also collect text responses from the same assistant messages that contain terminal calls
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
    // Mark welcome message as already written (init writes it)
    initWrittenRef.current = true;
    // Fit after init
    setTimeout(() => {
      setReady(true);
    }, 50);
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
      if (term.containerRef.current?.offsetParent !== null) {
        term.fit();
      }
    };

    // Initial fit
    setTimeout(doFit, 100);

    // ResizeObserver for container resizes
    if (term.containerRef.current) {
      const ro = new ResizeObserver(() => doFit());
      ro.observe(term.containerRef.current);
      resizeObserverRef.current = ro;
    }

    // Also fit on window resize
    window.addEventListener('resize', doFit);
    return () => {
      window.removeEventListener('resize', doFit);
    };
  }, [ready, term]);

  // Write new terminal tool entries to xterm when they appear
  useEffect(() => {
    if (!ready || !term.write) return;

    terminalEntries.forEach((entry) => {
      const callId = entry.callId;
      if (!callId) return;
      if (writtenCallIdsRef.current.has(callId)) return;
      writtenCallIdsRef.current.add(callId);

      // Write command
      term.write(`\r\n\x1b[1;33m$ ${entry.argsStr}\x1b[0m\r\n`);

      // Write result if available
      const resp = responseMap[callId] || entry.resultStr;
      if (resp) {
        // Truncate very long responses
        const truncated = resp.length > 2000 ? resp.slice(0, 2000) + '\n... (truncated)' : resp;
        term.write(`\x1b[90m${truncated}\x1b[0m\r\n`);
      }
    });
  }, [terminalEntries, responseMap, ready, term]);

  // Scroll to bottom when new output arrives
  useEffect(() => {
    if (!ready || !term.terminalRef.current) return;
    const termEl = term.terminalRef.current as { textarea?: HTMLTextAreaElement; scrollToBottom?: () => void; element?: HTMLElement };
    const textarea = termEl.textarea || termEl.element?.querySelector('textarea');
    if (textarea) {
      try {
        termEl.scrollToBottom?.();
      } catch { /* ignore */ }
    }
  }, [terminalEntries, ready, term]);

  // Focus terminal on mount
  useEffect(() => {
    if (ready) {
      setTimeout(() => {
        term.focus();
        inputRef.current?.focus();
      }, 200);
    }
  }, [ready, term]);

  const handleClear = useCallback(() => {
    term.clear();
    writtenCallIdsRef.current = new Set();
    // Rewrite welcome
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

    // Write command to local terminal
    if (term.write) {
      term.write(`\r\n\x1b[1;33m$ ${cmd}\x1b[0m\r\n`);
    }

    // 直接执行模式：通过 execute_command API
    if (sessionId) {
      try {
        // 解析命令：支持 /command args 和裸命令
        const isSlash = cmd.startsWith('/');
        const commandName = isSlash ? cmd.slice(1).split(/\s+/)[0] : 'terminal';
        const commandArgs = isSlash ? cmd.slice(1).substring(commandName.length).trim() : cmd;

        const resp = await call('execute_command', {
          command: commandName,
          args: commandArgs,
          session_id: sessionId,
        }) as { result?: string; session_id?: string };

        if (term.write && resp.result) {
          const output = resp.result.length > 5000
            ? resp.result.slice(0, 5000) + '\n... (truncated)'
            : resp.result;
          term.write(`\x1b[90m${output}\x1b[0m\r\n`);
        }
      } catch (err: unknown) {
        if (term.write) {
          term.write(`\x1b[31m执行失败: ${(err as Error).message}\x1b[0m\r\n`);
        }
      } finally {
        setExecuting(false);
      }
    } else {
      // 无 sessionId 时回退到 onSend（走聊天消息）
      setExecuting(false);
      if (term.write) {
        term.write('\x1b[90m等待 Agent 执行...\x1b[0m\r\n');
      }
      const fullCmd = cmd.startsWith('/') ? cmd : `/terminal ${cmd}`;
      onSend?.(fullCmd);
    }

    // Focus back to input
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [inputValue, isStreaming, executing, onSend, term, sessionId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendCommand();
      }
    },
    [handleSendCommand]
  );

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/10 shrink-0">
        <div className="flex items-center gap-1.5">
          <TerminalIcon size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">终端</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent">Agent</span>
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

      {/* Command input bar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-t border-border bg-background shrink-0">
        <span className="text-[11px] font-mono text-accent shrink-0" title="通过 Agent 远程执行">
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
    </div>
  );
}
