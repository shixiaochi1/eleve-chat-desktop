import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import * as api from '../utils/api';

// ── 系统会话来源（对齐 SessionsPanel HIDDEN_SOURCES）──
const HIDDEN_SOURCES = new Set(['tool', 'cron']);
import {
  Search,
  MessageCircle,
  Terminal,
  Navigation,
  Settings,
  Info,
  Hash,
  ArrowRight,
  Plus,
  FileText,
} from 'lucide-react';

/**
 * CommandCenter — 全局 CMD+K 指令面板
 *
 * 三层搜索:
 *   1. Sessions — 按标题搜索并切换会话
 *   2. Commands — 搜索并执行 / 命令
 *   3. Navigation — 跳转到设置 / 关于等面板
 *
 * Props:
 *   open: boolean
 *   onClose: () => void
 *   sessions: Array<{id, title}>
 *   sessionTitles: Record<string, string>
 *   sessionId: string — 当前会话 ID
 *   onSwitchSession: (id) => void
 *   onNewSession: () => void
 *   onCommand: (cmdName, args) => void
 *   onNavigate: (panel) => void  — 导航到面板 (settings, about, etc.)
 */

interface SessionItem {
  id: string;
  title?: string;
}

interface FlatResult {
  type: string;
  text?: string;
  id?: string;
  title?: string;
  isCurrent?: boolean;
  icon?: string;
  name?: string;
  description?: string;
  category?: string;
  label?: string;
}

interface CommandCenterProps {
  open?: boolean;
  onClose?: () => void;
  sessions?: SessionItem[];
  sessionTitles?: Record<string, string>;
  sessionId?: string;
  onSwitchSession?: (id: string) => void;
  onNewSession?: () => void;
  onCommand?: (cmdName: string, args: string) => void;
  onNavigate?: (panel: string) => void;
}

export default function CommandCenter({
  open,
  onClose,
  sessions = [],
  sessionTitles = {},
  sessionId,
  onSwitchSession,
  onNewSession,
  onCommand,
  onNavigate,
}: CommandCenterProps) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // ── Reset state on open ──
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // ── Build flat result list ──
  const flatResults: FlatResult[] = useMemo(() => {
    const q = query.toLowerCase().trim();
    const results: FlatResult[] = [];

    // 1. Sessions（过滤系统会话）
    const visibleSessions = sessions.filter((s: any) => {
      const src = s.source as string | undefined;
      return !src || !HIDDEN_SOURCES.has(src);
    });
    const matchedSessions = q
      ? visibleSessions.filter((s) => {
          const title = sessionTitles[s.id] || s.title || s.id || '';
          return title.toLowerCase().includes(q);
        })
      : visibleSessions.slice(0, 5); // show at most 5 recent

    if (matchedSessions.length > 0) {
      results.push({ type: 'label', text: 'Sessions' });
      matchedSessions.slice(0, 8).forEach((s) => {
        const title = sessionTitles[s.id] || s.title || s.id?.slice(0, 8) || 'New Session';
        const isCurrent = s.id === sessionId;
        results.push({
          type: 'session',
          id: s.id,
          title,
          isCurrent,
          icon: 'message',
        });
      });
    }

    // 2. Commands
    interface CommandDef {
      name: string;
      description: string;
      aliases: string[];
      category: string;
    }

    const commands: CommandDef[] = [
      { name: 'new', description: 'Start a new session', aliases: ['n', 'clear'], category: 'Session' },
      { name: 'reset', description: 'Reset current session context', aliases: [], category: 'Session' },
      { name: 'help', description: 'Show help information', aliases: ['h', '?'], category: 'Help' },
      { name: 'retry', description: 'Retry the last assistant response', aliases: ['redo'], category: 'Actions' },
      { name: 'continue', description: 'Continue the last response', aliases: ['cont'], category: 'Actions' },
      { name: 'save', description: 'Save current conversation', aliases: ['export'], category: 'Session' },
      { name: 'inject', description: 'Inject context into the conversation', aliases: [], category: 'Advanced' },
      { name: 'feedback', description: 'Send feedback', aliases: ['bug'], category: 'Other' },
      { name: 'think', description: 'Toggle thinking mode', aliases: ['reason'], category: 'Settings' },
    ];

    const matchedCommands = q
      ? commands.filter((c) =>
          c.name.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.aliases.some((a) => a.toLowerCase().includes(q))
        )
      : commands;

    if (matchedCommands.length > 0) {
      results.push({ type: 'label', text: 'Commands' });
      matchedCommands.forEach((c) => {
        results.push({
          type: 'command',
          name: c.name,
          description: c.description,
          category: c.category,
          icon: 'terminal',
        });
      });
    }

    // 3. Navigation
    interface NavItemDef {
      id: string;
      label: string;
      icon: string;
      description: string;
    }

    const navItems: NavItemDef[] = [
      { id: 'settings', label: 'Settings', icon: 'settings', description: 'Configure application settings' },
      { id: 'about', label: 'About', icon: 'info', description: 'About Eleve Chat' },
      { id: 'gateway', label: 'Gateway', icon: 'globe', description: 'Gateway connection settings' },
      { id: 'debug', label: 'Debug', icon: 'terminal', description: 'Debug information and logs' },
      { id: 'skills', label: 'Skills', icon: 'puzzle', description: 'Manage skills and plugins' },
    ];

    const matchedNav = q
      ? navItems.filter((n) =>
          n.label.toLowerCase().includes(q) || n.description.toLowerCase().includes(q)
        )
      : navItems;

    if (matchedNav.length > 0) {
      results.push({ type: 'label', text: 'Navigation' });
      matchedNav.forEach((n) => {
        results.push({
          type: 'nav',
          id: n.id,
          label: n.label,
          description: n.description,
          icon: n.icon,
        });
      });
    }

    return results;
  }, [query, sessions, sessionTitles, sessionId]);

  // ── Get selectable items (skip labels) ──
  const selectableIndices = useMemo(() => {
    return flatResults
      .map((r, i) => (r.type !== 'label' ? i : -1))
      .filter((i) => i >= 0);
  }, [flatResults]);

  // ── Selected index bounds ──
  useEffect(() => {
    if (selectableIndices.length > 0 && selectedIdx >= selectableIndices.length) {
      setSelectedIdx(0);
    }
  }, [selectableIndices, selectedIdx]);

  // ── Execute selection ──
  const executeSelected = useCallback(() => {
    if (selectableIndices.length === 0) return;
    const idx = selectableIndices[selectedIdx];
    const item = flatResults[idx];
    if (!item) return;

    switch (item.type) {
      case 'session':
        if (item.id !== sessionId) onSwitchSession?.(item.id!);
        onClose?.();
        break;
      case 'command':
        onCommand?.(item.name!, '');
        onClose?.();
        break;
      case 'nav':
        onNavigate?.(item.id!);
        onClose?.();
        break;
    }
  }, [selectableIndices, selectedIdx, flatResults, sessionId, onSwitchSession, onClose, onCommand, onNavigate]);

  // ── Keyboard handler ──
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose?.();
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIdx((prev) => Math.min(prev + 1, selectableIndices.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIdx((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          executeSelected();
          break;
        case 'k':
        case 'K':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            onClose?.();
          }
          break;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose, selectableIndices, executeSelected]);

  // ── Scroll selected into view ──
  useEffect(() => {
    if (!open || !listRef.current) return;
    const items = listRef.current.querySelectorAll('.cc-item');
    const target = items[selectedIdx] as HTMLElement | undefined;
    if (target) target.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh] bg-black/50 backdrop-blur-sm" onMouseDown={(e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="w-full max-w-lg bg-popover text-popover-foreground rounded-xl shadow-2xl border border-border overflow-hidden" onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}>
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search size={18} className="text-muted-foreground/50 shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none"
            type="text"
            placeholder="Search sessions, commands, or navigate…"
            value={query}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setQuery(e.target.value); setSelectedIdx(0); }}
            autoComplete="off"
            spellCheck="false"
          />
          <kbd className="px-1.5 py-0.5 text-[10px] bg-muted text-muted-foreground rounded border border-border">ESC</kbd>
        </div>

        {/* Results list */}
        <div className="max-h-[50vh] overflow-y-auto" ref={listRef}>
          {flatResults.length === 0 && (
            <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
              <Search size={24} className="text-muted-foreground/30" />
              <span className="text-sm">No results found</span>
            </div>
          )}

          {flatResults.map((item, i) => {
            if (item.type === 'label') {
              return (
                <div key={`label-${i}`} className="flex items-center justify-between px-4 py-1.5 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                  <span>{item.text}</span>
                  <span className="text-muted-foreground/30">
                    {flatResults.slice(i + 1).filter((r) => r.type !== 'label').length}
                  </span>
                </div>
              );
            }

            const selectableIndex = selectableIndices.indexOf(i);
            const isSelected = selectableIndex === selectedIdx;

            return (
              <div
                key={`${item.type}-${item.id || item.name || item.label || ''}-${i}`}
                className={cn(
                  'flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors',
                  isSelected ? 'bg-accent text-accent-foreground' : 'text-popover-foreground hover:bg-accent/50'
                )}
                onClick={() => {
                  const idx = selectableIndices.indexOf(i);
                  if (idx >= 0) {
                    setSelectedIdx(idx);
                    executeSelected();
                  }
                }}
                onMouseEnter={() => {
                  const idx = selectableIndices.indexOf(i);
                  if (idx >= 0) setSelectedIdx(idx);
                }}
              >
                <span className="w-5 flex items-center justify-center shrink-0 text-muted-foreground/70">
                  {item.type === 'session' && <MessageCircle size={16} />}
                  {item.type === 'command' && <Terminal size={16} />}
                  {item.type === 'nav' && (item.icon === 'settings' ? <Settings size={16} /> : item.icon === 'info' ? <Info size={16} /> : <Hash size={16} />)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm truncate">
                    {item.type === 'session' && item.title}
                    {item.type === 'command' && <><span className="text-muted-foreground/50">/</span>{item.name}</>}
                    {item.type === 'nav' && item.label}
                  </span>
                  <span className="block text-[11px] text-muted-foreground/60 truncate">
                    {item.type === 'session' && (item.isCurrent ? 'Current session' : 'Switch to session')}
                    {item.type === 'command' && item.description}
                    {item.type === 'nav' && item.description}
                  </span>
                </span>
                <span className="shrink-0 text-muted-foreground/40">
                  <ArrowRight size={14} />
                </span>
              </div>
            );
          })}

          {/* New session shortcut */}
          {query === '' && (
            <div className="flex items-center gap-3 px-4 py-2 cursor-pointer text-popover-foreground hover:bg-accent/50 transition-colors border-t border-border" onClick={() => { onNewSession?.(); onClose?.(); }}>
              <Plus size={16} className="text-muted-foreground/70" />
              <span className="text-sm flex-1">New Session</span>
              <kbd className="px-1.5 py-0.5 text-[10px] bg-muted text-muted-foreground rounded border border-border">Ctrl+N</kbd>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
