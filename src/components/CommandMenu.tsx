import { useState, useRef, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { CommandMenuIcon } from './Icons';

/**
 * Spotlight 风格命令菜单 — 输入区左侧按钮，点击弹出分组下拉菜单
 *
 * Props:
 *   commands: [{name, description, category, aliases, args_hint}]
 *   onCommand: (cmdName, args) => void
 */

interface CommandDef {
  name: string;
  description: string;
  category?: string;
  aliases: string[];
  args_hint?: string;
}

interface CommandMenuProps {
  commands?: CommandDef[];
  onCommand?: (cmdName: string, args: string) => void;
}

export default function CommandMenu({ commands = [], onCommand }: CommandMenuProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const grouped = useMemo(() => {
    const q = filter.toLowerCase();
    const filtered = q
      ? commands.filter((c) =>
          c.name.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.aliases.some((a) => a.toLowerCase().includes(q))
        )
      : commands;

    const map: Record<string, CommandDef[]> = {};
    for (const c of filtered) {
      const cat = c.category || '其他';
      if (!map[cat]) map[cat] = [];
      map[cat].push(c);
    }
    return map;
  }, [commands, filter]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFilter('');
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = (cmd: CommandDef) => {
    onCommand?.(cmd.name, '');
    setOpen(false);
    setFilter('');
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        setOpen(false);
        setFilter('');
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        className="p-1.5 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        title="命令菜单"
        onClick={() => { setOpen((v) => !v); if (!open) setTimeout(() => inputRef.current?.focus(), 50); }}
      >
        <CommandMenuIcon size={18} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-64 bg-popover border border-border rounded-lg shadow-lg overflow-hidden z-50">
          <div className="p-2 border-b border-border">
            <input
              ref={inputRef}
              type="text"
              className="w-full px-2 py-1 text-xs bg-background border border-input rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="搜索命令…"
              value={filter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)}
              autoComplete="off"
              spellCheck="false"
            />
          </div>
          <div className="max-h-60 overflow-y-auto">
            {Object.entries(grouped).length === 0 && (
              <div className="px-3 py-4 text-xs text-center text-muted-foreground/60">无匹配命令</div>
            )}
            {Object.entries(grouped).map(([cat, items]) => (
              <div key={cat}>
                <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">{cat}</div>
                {items.map((cmd) => (
                  <div
                    key={cmd.name}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer text-popover-foreground hover:bg-accent transition-colors"
                    onClick={() => handleSelect(cmd)}
                    title={cmd.description}
                  >
                    <span className="font-mono text-accent shrink-0">/{cmd.name}</span>
                    {cmd.aliases.length > 0 && (
                      <span className="text-[10px] text-muted-foreground/50 shrink-0">
                        {cmd.aliases.map((a) => `/${a}`).join(', ')}
                      </span>
                    )}
                    <span className="truncate text-muted-foreground/70 flex-1 text-right">{cmd.description}</span>
                    {cmd.args_hint && (
                      <span className="text-[10px] text-muted-foreground/40 shrink-0">{cmd.args_hint}</span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
