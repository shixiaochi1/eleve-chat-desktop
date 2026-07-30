/**
 * useSlashAutocomplete — `/` 命令补全共享逻辑
 *
 * 单一权威源：单视图 InputArea 与宫格 AgentCardComposer 共用，零重复。
 * 只负责命令列表 + 过滤 + 选中索引 + 弹窗开关；输入框 DOM 值与键盘编排
 * 归各组件（两者键盘场景不同：InputArea 还有 @路径/btw，宫格没有）。
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchCommands } from '../utils/api';

export interface CommandDef {
  name: string;
  description: string;
  aliases: string[];
}

interface Options {
  /** portReady 后置 true 才拉取命令列表 */
  enabled: boolean;
  /** 变化时重新拉取（如 portVersion） */
  refreshKey?: string;
}

export function useSlashAutocomplete({ enabled, refreshKey }: Options) {
  const [commands, setCommands] = useState<CommandDef[]>([]);
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showPopup, setShowPopup] = useState(false);

  useEffect(() => {
    if (enabled) fetchCommands().then(setCommands).catch(() => {});
  }, [enabled, refreshKey]);

  const filtered = useMemo(
    () =>
      filter
        ? commands.filter(
            (c) => c.name.startsWith(filter) || c.aliases.some((a) => a.startsWith(filter)),
          )
        : commands,
    [commands, filter],
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  /** 从输入值同步弹窗状态。返回 true = 处于 slash 模式。 */
  const syncFromValue = useCallback((value: string): boolean => {
    if (value.startsWith('/')) {
      setFilter(value.replace(/^\//, '').split(/\s/)[0].toLowerCase());
      setShowPopup(true);
      return true;
    }
    setShowPopup(false);
    setFilter('');
    return false;
  }, []);

  /** 键盘上下移动选中项（循环）。 */
  const moveSelection = useCallback(
    (delta: number) => {
      setSelectedIndex((i) => {
        const n = filtered.length;
        if (n === 0) return 0;
        return (i + delta + n) % n;
      });
    },
    [filtered.length],
  );

  const close = useCallback(() => {
    setShowPopup(false);
    setFilter('');
  }, []);

  return {
    commands,
    filtered,
    selectedIndex,
    showPopup,
    setSelectedIndex,
    syncFromValue,
    moveSelection,
    close,
    /** 当前高亮命令（弹窗未开/空列表时为 null） */
    activeCommand: showPopup && filtered.length > 0 ? (filtered[selectedIndex] ?? null) : null,
  };
}
