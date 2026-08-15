/**
 * TodoPanel — 任务状态折叠条（DSH ui-conversation skeleton/TodoPanel 完整复刻）
 *
 * 🔴 2026-08-16 老大需求：完整复刻 DSH 前端"任务状态折叠框"。
 * 基准：packages/client/ui-conversation/src/client/skeleton/TodoPanel.tsx + .module.css
 * ——可折叠（collapsed 默认 true）、header 摘要 "done n · active n · pending n"
 * （零计数段省略，U+2002 宽空格分隔）、展开列表 3 色状态 glyph
 * （completed 绿带勾圆 / in_progress 蓝渐变环 CSS 旋转 / pending 灰色虚线圆）、
 * 空列表不渲染（return null）、data-testid="todo-panel"。
 *
 * 布局契约（对齐现有 GoalBar 卡片形态，同 DSH input dock 顺序：todo 最上）：
 * - 普通文档流（非 overlay）：消息区 → 本框 → GoalBar → 输入框；
 * - 数据源 = todo.status WS RPC（轮询 3s，同 GoalBar 节奏）；
 * - 会话切换即清空重拉。
 */
import { useCallback, useEffect, useId, useState } from 'react';
import { ChevronDown, ChevronUp, ListChecks } from 'lucide-react';
import { call } from '../utils/bridge';
import type { TodoItem } from '../lib/todo-types';
import css from './TodoPanel.module.css';

const POLL_MS = 3000;

/** completed：绿底勾圆（DSH CompletedGlyph 原样） */
function CompletedGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className={css.glyphCompleted}>
      <circle cx="7" cy="7" r="6.4" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M10.9631 5.71411L7.70154 8.97571C7.48011 9.19714 7.27736 9.40099 7.09229 9.54993C6.89742 9.70669 6.66314 9.85279 6.3634 9.90027C6.2049 9.92534 6.04339 9.92534 5.88489 9.90027C5.58515 9.85279 5.35087 9.70669 5.15601 9.54993C4.97093 9.40099 4.76818 9.19714 4.54675 8.97571L3.03516 7.46411L3.96313 6.53613L5.47473 8.04773C5.7169 8.28989 5.86196 8.43389 5.97888 8.52795C6.08597 8.61409 6.10875 8.60701 6.08997 8.604C6.11259 8.60758 6.13571 8.60758 6.15833 8.604C6.13954 8.60701 6.16232 8.61409 6.26941 8.52795C6.38633 8.43389 6.53139 8.28989 6.77356 8.04773L10.0352 4.78613L10.9631 5.71411Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** in_progress：业务蓝渐变环，CSS 旋转动画（DSH ProgressGlyph 原样） */
function ProgressGlyph() {
  const gradientId = useId();
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className={css.glyphProgress}>
      <defs>
        <linearGradient id={gradientId} x1="2.5" y1="12" x2="10.5" y2="3.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="7" cy="7" r="6.4" stroke={`url(#${gradientId})`} strokeWidth="1.2" />
    </svg>
  );
}

/** pending：灰色虚线未开始圆环（DSH PendingGlyph 原样，dash 2.4 2.4） */
function PendingGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className={css.glyphPending}>
      <circle cx="7" cy="7" r="6.4" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.4 2.4" />
    </svg>
  );
}

function StatusGlyph({ status }: { status: TodoItem['status'] }) {
  switch (status) {
    case 'completed':
      return <CompletedGlyph />;
    case 'in_progress':
      return <ProgressGlyph />;
    case 'pending':
      return <PendingGlyph />;
    default:
      // cancelled 等后端合法状态 → pending 样式（DSH 只画三态）
      return <PendingGlyph />;
  }
}

/** header 摘要：各状态计数 "·" 连接；零计数段省略（DSH progressLabel） */
function progressLabel(todos: readonly TodoItem[]): string {
  const done = todos.filter((item) => item.status === 'completed').length;
  const active = todos.filter((item) => item.status === 'in_progress').length;
  const pending = todos.length - done - active;
  return [
    ...(done > 0 ? [`已完成 ${done}`] : []),
    ...(active > 0 ? [`进行中 ${active}`] : []),
    ...(pending > 0 ? [`待办 ${pending}`] : []),
  ].join('\u2002·\u2002');
}

export default function TodoPanel({ sessionId }: { sessionId?: string | null }) {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [collapsed, setCollapsed] = useState(true);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await call('todo_status', { session_id: sessionId });
      setTodos(res?.todos ?? []);
    } catch {
      // 静默（会话 DB 未就绪等）
    }
  }, [sessionId]);

  // 轮询 + 切会话即时刷新
  useEffect(() => {
    setTodos([]);
    setCollapsed(true);
    if (!sessionId) return;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [sessionId, refresh]);

  // DSH: 空列表不渲染
  if (todos.length === 0) return null;

  return (
    <section className={css.root} data-testid="todo-panel" aria-label="任务计划">
      <div className={css.body}>
        <button
          type="button"
          className={css.header}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
        >
          <span className={css.lead} aria-hidden>
            <ListChecks size={14} />
          </span>
          <span className={css.title}>任务计划</span>
          <span className={css.progress}>{progressLabel(todos)}</span>
          <span className={css.chevron} aria-hidden>
            {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </button>
        {!collapsed && (
          <ul className={css.list}>
            {todos.map((item) => (
              <li key={item.id || item.content} className={css.item} data-status={item.status}>
                <span className={css.glyph} aria-hidden>
                  <StatusGlyph status={item.status} />
                </span>
                <span className={css.content}>{item.content}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}