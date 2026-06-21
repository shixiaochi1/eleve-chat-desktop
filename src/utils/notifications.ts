/**
 * Toast 通知系统 — 对齐 Eleve store/notifications.ts
 *
 * 用法:
 *   import { notify, notifyError, notifySuccess, notifyWarning, dismissNotification } from '../utils/notifications';
 *   notify({ kind: 'info', message: '保存成功' });
 *   notifyError(err, '发送失败');
 */

import { useState, useEffect } from 'react';

// ── 类型 ──

export type NotificationKind = 'error' | 'warning' | 'info' | 'success';

export interface NotificationAction {
  label: string;
  onClick: () => void;
}

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title?: string;
  message: string;
  detail?: string;
  action?: NotificationAction;
  onDismiss?: () => void;
  createdAt: number;
}

export interface NotifyInput {
  kind?: NotificationKind;
  title?: string;
  message: string;
  detail?: string;
  action?: NotificationAction;
  onDismiss?: () => void;
  durationMs?: number;
}

// ── 内部状态 ──

let notificationCounter = 0;
const timers = new Map<string, number>();
let listeners: Array<(notifications: AppNotification[]) => void> = [];
let _notifications: AppNotification[] = [];

function emit() {
  for (const fn of listeners) fn(_notifications);
}

export function subscribe(fn: (notifications: AppNotification[]) => void): () => void {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}

export function getNotifications(): AppNotification[] {
  return _notifications;
}

// ── 错误摘要 ── 对齐 Eleve ERROR_SUMMARIES

interface ErrorSummaryRule {
  test: (msg: string) => boolean;
  summarize: (msg: string) => string;
}

const ERROR_SUMMARIES: ErrorSummaryRule[] = [
  {
    test: (msg) => /incorrect api key provided/i.test(msg) || /['"]code['"]\s*:\s*['"]invalid_api_key['"]/i.test(msg),
    summarize: (msg) => {
      const status = msg.match(/(?:error code|status(?:Code)?)[^\d]*(\d{3})/i)?.[1];
      return `API 密钥被拒绝${status ? ` (${status} invalid_api_key)` : ''}。请在设置中检查密钥。`;
    },
  },
  {
    test: (msg) => /connection refused/i.test(msg) || /ECONNREFUSED/i.test(msg),
    summarize: () => '无法连接后端服务，请检查 Eleve 是否已启动。',
  },
  {
    test: (msg) => /network error/i.test(msg) || /fetch.*failed/i.test(msg),
    summarize: () => '网络连接失败，请检查网络设置。',
  },
  {
    test: (msg) => /rate limit/i.test(msg) || /429/.test(msg),
    summarize: () => '请求过于频繁，已被限流。请稍后再试。',
  },
  {
    test: (msg) => /insufficient_quota/i.test(msg) || /billing/i.test(msg) || /402/.test(msg),
    summarize: () => 'API 额度不足或账单问题，请检查账户余额。',
  },
  {
    test: (msg) => /model_not_found/i.test(msg) || /model.*not.*available/i.test(msg),
    summarize: (msg) => {
      const model = msg.match(/model[:\s]*([^\s,]+)/i)?.[1];
      return model ? `模型 ${model} 不可用，请切换模型。` : '当前模型不可用，请切换模型。';
    },
  },
  {
    test: (msg) => /context.*length/i.test(msg) || /max.*token/i.test(msg) || /too many tokens/i.test(msg),
    summarize: () => '上下文过长，已超出模型限制。请缩短对话或新建会话。',
  },
];

function cleanErrorText(value: string): string {
  return value.replace(/^Error:\s*/, '').trim();
}

function summarizeErrorMessage(message: string, fallback: string): string {
  const rule = ERROR_SUMMARIES.find((r) => r.test(message));
  if (rule) return rule.summarize(message);
  return message.length > 120 ? fallback : message || fallback;
}

function readableError(error: unknown, fallback: string): { message: string; detail?: string } {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;
  const unwrapped = raw.match(/Error invoking remote method '[^']+': Error: (.+)$/)?.[1] ?? raw;
  const cleaned = cleanErrorText(unwrapped);
  const detail = cleaned.match(/"detail"\s*:\s*"([^"]+)"/)?.[1] ?? cleaned;
  const summary = summarizeErrorMessage(detail, fallback);
  return { message: summary, detail: detail === summary ? undefined : detail };
}

// ── 默认持续时间 ──

function defaultDuration(kind: NotificationKind): number {
  if (kind === 'error' || kind === 'warning') return 0; // 手动关闭
  return 5000; // info/success 5s 自动消失
}

// ── 公开 API ──

/**
 * 发送通知
 */
export function notify(input: NotifyInput): string {
  const kind = input.kind ?? 'info';
  const id = `${Date.now()}-${notificationCounter++}`;

  const notification: AppNotification = {
    id,
    kind,
    title: input.title,
    message: input.message,
    detail: input.detail,
    action: input.action,
    onDismiss: input.onDismiss,
    createdAt: Date.now(),
  };

  window.clearTimeout(timers.get(id));
  timers.delete(id);

  _notifications = [notification, ..._notifications.filter((n) => n.id !== id)].slice(0, 4);
  emit();

  const duration = input.durationMs ?? defaultDuration(kind);
  if (duration > 0) {
    timers.set(id, window.setTimeout(() => dismissNotification(id), duration));
  }

  return id;
}

/**
 * 错误通知 — 自动摘要
 */
export function notifyError(error: unknown, fallback: string): string {
  const readable = readableError(error, fallback);
  return notify({
    kind: 'error',
    title: fallback,
    message: readable.message,
    detail: readable.detail,
  });
}

/** 快捷: info 通知 */
export function notifyInfo(message: string, title?: string): string {
  return notify({ kind: 'info', title, message });
}

/** 快捷: success 通知 */
export function notifySuccess(message: string, title?: string): string {
  return notify({ kind: 'success', title, message });
}

/** 快捷: warning 通知 */
export function notifyWarning(message: string, title?: string): string {
  return notify({ kind: 'warning', title, message });
}

/**
 * 关闭通知
 */
export function dismissNotification(id: string): void {
  window.clearTimeout(timers.get(id));
  timers.delete(id);
  const dismissed = _notifications.find((n) => n.id === id);
  _notifications = _notifications.filter((n) => n.id !== id);
  emit();
  dismissed?.onDismiss?.();
}

/** 清空所有通知 */
export function clearNotifications(): void {
  for (const timer of timers.values()) window.clearTimeout(timer);
  timers.clear();
  const all = _notifications;
  _notifications = [];
  emit();
  for (const item of all) item.onDismiss?.();
}

// ── React Hook ──

/**
 * useNotifications — 组件内订阅通知状态
 */
export function useNotifications(): AppNotification[] {
  const [notifications, setNotifications] = useState<AppNotification[]>(_notifications);
  useEffect(() => {
    setNotifications(_notifications);
    return subscribe(setNotifications);
  }, []);
  return notifications;
}
