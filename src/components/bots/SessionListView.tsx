/**
 * SessionListView — 「当前 Agent 的会话」列表（P2-8 第二步）。
 *
 * 形态（对齐 Hermes）：**项目 = 分组头**，不是独立卡片区。
 *   ▸ 项目A (3)            ＋
 *       · 会话标题          3 分钟前
 *   ▸ Home (2)
 *       · 会话标题          昨天
 *
 * 🔴 点击语义（与旧项目卡片的关键差异）：
 * - 分组头 = **只折叠/展开**（持久化），不切消息区、不改 cwd；
 * - `＋` = 以项目根为 cwd 新建会话；
 * - 会话行 = 只切会话（`onSwitchSession`），文件面板跟会话 cwd 由右栏域模型负责。
 *
 * 本组件只做渲染与折叠态；分组规则在 `lib/session-groups.ts`（纯函数 + 单测）。
 */
import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';
import * as storage from '../../utils/storage';
import { formatRelativeTime } from '../../lib/relative-time';
import {
  groupSessionsByProject,
  countGroupedSessions,
  type ProjectGroupProject,
  type ProjectGroupSession,
} from '../../lib/session-groups';

export interface SessionListViewProps {
  /** 当前 Agent 的会话（App 的 sess.sessions） */
  sessions: (ProjectGroupSession & { title?: string | null })[];
  /** 当前 Agent 的项目（与项目树同源） */
  projects: ProjectGroupProject[];
  /** 当前会话 id（高亮） */
  currentSessionId?: string | null;
  /** 切会话（只切会话，不建、不改 cwd） */
  onSwitchSession?: (id: string) => void;
  /** 以项目根新建会话；`null` = Home（沿用当前默认落点） */
  onNewSessionInProject?: (cwd: string | null) => void;
  className?: string;
}

const COLLAPSE_KEY = 'eleve.sessionList.collapsedGroups.v1';

function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export default function SessionListView({
  sessions,
  projects,
  currentSessionId,
  onSwitchSession,
  onNewSessionInProject,
  className,
}: SessionListViewProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(loadCollapsed);

  const groups = useMemo(
    () => groupSessionsByProject(sessions, projects),
    [sessions, projects],
  );
  const total = countGroupedSessions(groups);

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((cur) => {
      const next = { ...cur, [key]: !cur[key] };
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        /* 存储禁用 → 仅本次生效 */
      }
      return next;
    });
  }, []);

  return (
    <div className={cn('flex flex-col min-h-0', className)}>
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          会话
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground/50">{total}</span>
      </div>

      <div className="min-h-0 overflow-y-auto px-1 pb-1">
        {groups.map((g) => {
          const collapsed = collapsedGroups[g.key] === true;
          return (
            <div key={g.key} className="mb-0.5">
              {/* 分组头：只折叠/展开（旧项目卡片"点一下就切消息区/改 cwd"的副作用已移除） */}
              <div className="group flex items-center gap-1 rounded px-1.5 py-1 hover:bg-accent/40">
                <button
                  type="button"
                  onClick={() => toggleGroup(g.key)}
                  className="flex min-w-0 flex-1 items-center gap-1 text-left"
                  aria-expanded={!collapsed}
                  title={collapsed ? `展开「${g.label}」` : `收起「${g.label}」`}
                >
                  {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                  <span className="truncate text-xs text-foreground">{g.label}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/50">
                    {g.sessions.length}
                  </span>
                </button>
                {onNewSessionInProject && (
                  <button
                    type="button"
                    onClick={() => onNewSessionInProject(g.isHome ? null : g.root)}
                    className="shrink-0 rounded p-0.5 text-muted-foreground/50 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                    title={g.isHome ? '新建会话' : `在「${g.label}」新建会话`}
                    aria-label={g.isHome ? '新建会话' : `在「${g.label}」新建会话`}
                  >
                    <Plus size={12} />
                  </button>
                )}
              </div>

              {!collapsed &&
                (g.sessions.length === 0 ? (
                  <div className="px-6 py-0.5 text-[11px] text-muted-foreground/40">暂无会话</div>
                ) : (
                  g.sessions.map((s) => {
                    const active = s.id === currentSessionId;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => onSwitchSession?.(s.id)}
                        className={cn(
                          'flex w-full items-center gap-1 rounded px-1.5 py-1 pl-5 text-left',
                          active ? 'bg-accent text-foreground' : 'hover:bg-accent/40',
                        )}
                        title={s.title || s.id}
                      >
                        <span className="min-w-0 flex-1 truncate text-xs">
                          {s.title || '未命名会话'}
                        </span>
                        {s.last_active ? (
                          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/50">
                            {formatRelativeTime(s.last_active)}
                          </span>
                        ) : null}
                      </button>
                    );
                  })
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
