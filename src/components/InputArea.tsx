import { useRef, useCallback, useEffect, useState } from 'react';
import { fetchCommands } from '../utils/api';
import CommandMenu from './CommandMenu';
import { SendIcon, StopIcon } from './Icons';
import { cn } from '@/lib/utils';

interface CommandDef {
  name: string;
  description: string;
  aliases: string[];
}

interface InputAreaProps {
  onSend?: (text: string) => void;
  onCommand?: (cmdName: string, args: string) => void;
  onAbort?: () => void;
  isStreaming?: boolean;
  portReady?: boolean;
  portVersion?: string;
}

/**
 * 输入区 — textarea 自动调整高度 + Enter 发送 + / 命令补全
 */
export default function InputArea({ onSend, onCommand, onAbort, isStreaming, portReady, portVersion }: InputAreaProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [commands, setCommands] = useState<CommandDef[]>([]);
  const [showPopup, setShowPopup] = useState(false);
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const popupRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (portReady) {
      fetchCommands().then(setCommands).catch(() => {});
    }
  }, [portReady, portVersion]);

  const filtered = filter
    ? commands.filter(c =>
        c.name.startsWith(filter) || c.aliases.some(a => a.startsWith(filter))
      )
    : commands;

  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  const handleSend = useCallback(() => {
    const text = inputRef.current?.value || '';
    if (!text.trim()) return;
    onSend?.(text);
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.style.height = 'auto';
    }
    setShowPopup(false);
    setFilter('');
  }, [onSend]);

  const handleCommandExec = useCallback((cmdName: string, args = '') => {
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.style.height = 'auto';
    }
    setShowPopup(false);
    setFilter('');
    onCommand?.(cmdName, args);
  }, [onCommand]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showPopup && filtered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => (i + 1) % filtered.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const cmd = filtered[selectedIndex];
        if (cmd) {
          const currentValue = inputRef.current?.value || '';
          const argsPart = currentValue.replace(/^\/\S*\s*/, ' ').trim();
          const newValue = `/${cmd.name}` + (argsPart ? ' ' + argsPart : '');
          
          if (inputRef.current) {
            inputRef.current.value = newValue;
          }
          
          if (e.key === 'Enter') {
            handleCommandExec(cmd.name, argsPart);
          }
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowPopup(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [showPopup, filtered, selectedIndex, handleSend, handleCommandExec]);

  const handleInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';

    const val = el.value;
    if (val.startsWith('/')) {
      const cmdPart = val.replace(/^\//, '').split(/\s/)[0].toLowerCase();
      setFilter(cmdPart);
      setShowPopup(true);
    } else {
      setShowPopup(false);
      setFilter('');
    }
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setShowPopup(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (!isStreaming) inputRef.current?.focus();
  }, [isStreaming]);

  return (
    <div className="p-3">
      <div className="flex items-center gap-2">
        <CommandMenu commands={commands} onCommand={handleCommandExec} />
        <textarea
          ref={inputRef}
          id="input"
          className="desktop-input-chrome flex-1 rounded-md border px-3 py-2 text-sm outline-none resize-none min-h-[36px] max-h-[150px] leading-normal"
          placeholder={isStreaming ? '输入消息排队等待… (Enter 发送)' : '向 Eleve 发送消息… (Enter 发送, / 命令)'}
          rows={1}
          autoComplete="off"
          spellCheck="false"
          onKeyDown={handleKeyDown}
          onInput={handleInput}
        />
        <button
          className={cn(
            'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md text-sm font-medium',
            'transition-all outline-none h-9 w-9',
            isStreaming
              ? 'bg-destructive text-white hover:bg-destructive/90'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          )}
          id="send-btn"
          title={isStreaming ? '停止生成' : '发送'}
          aria-label={isStreaming ? 'Stop generation' : 'Send message'}
          onClick={isStreaming ? onAbort : handleSend}
        >
          {isStreaming ? <StopIcon size={14} /> : <SendIcon size={18} />}
        </button>
      </div>

      {showPopup && filtered.length > 0 && (
        <div
          className="absolute bottom-full left-0 mb-1 border border-border rounded-lg bg-popover shadow-lg p-1 max-h-60 overflow-y-auto min-w-[200px] z-50"
          ref={popupRef}
        >
          {filtered.map((cmd, i) => (
            <div
              key={cmd.name}
              className={cn(
                'px-3 py-1.5 text-sm cursor-pointer rounded-md flex items-center gap-2',
                i === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
              )}
              onMouseEnter={() => setSelectedIndex(i)}
              onMouseDown={(e: React.MouseEvent) => {
                e.preventDefault();
                const args = inputRef.current?.value.replace(/^\/\S+\s*/, '') || '';
                handleCommandExec(cmd.name, args);
              }}
            >
              <span className="font-mono text-xs font-medium text-primary">/{cmd.name}</span>
              {cmd.aliases.length > 0 && (
                <span className="text-xs text-muted-foreground">({cmd.aliases.join(', ')})</span>
              )}
              <span className="text-xs text-muted-foreground ml-auto truncate">{cmd.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
