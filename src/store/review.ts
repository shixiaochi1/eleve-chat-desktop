/**
 * review — 右栏 git 工作区审查域状态（🔴 2026-09-05 对齐 Hermes store/review.ts）
 * 立项文档：docs/review域立项_2026-09-05.md
 *
 * 铁律落点：
 * - 数据源唯一：git 本身（每次变更操作后 afterMutation 全量重同步，无乐观更新）
 * - 并发守卫：refresh 单调 seq + 返回前 cwd 双校验（对齐 reviewRefreshSeq/repoCwd）
 * - 刷新边界：打开 / workspace tick / 变更操作后 / focus（事件驱动，不轮询）
 * - revert 不可逆 → 永远走确认对话框（{path|null} 区分单个/全部）
 * - ship 动作单 busy 串行化（对齐 runShip）
 *
 * 存储模式对齐 ELEVE store/preview-status.ts：useSyncExternalStore 模块单例。
 */

import { useSyncExternalStore } from 'react';
import { call } from '@/utils/bridge';
import { getCurrentSessionCwd } from '@/lib/session-cwd';

/** 单个变更文件（对齐 HermesReviewFile，global.d.ts:1356） */
export interface ReviewFile {
  path: string;
  added: number;
  removed: number;
  /** M/A/D/R/C/U/?（porcelain v2 状态字母） */
  status: string;
  staged: boolean;
}

interface ReviewState {
  files: ReviewFile[];
  loading: boolean;
  /** false = 活动会话 cwd 不是本地 git 仓库（渲染"非仓库"空态而非空列表） */
  isRepo: boolean;
  selectedPath: string | null;
  diff: string | null;
  diffLoading: boolean;
  treeMode: 'list' | 'tree';
  /** undefined = 关闭；{ path: null } = 全部；{ path } = 单文件 */
  revertTarget: { path: null | string } | undefined;
  shipBusy: boolean;
  commitMsgBusy: boolean;
}

interface ReviewSnapshot extends ReviewState {
  /** 面板揭示请求计数（对齐 preview store 的 paneOpenRequest：外部事件源 → App 消费） */
  revealRequest: number;
}

const TREE_MODE_KEY = 'eleve.reviewTreeMode.v1';

function readTreeMode(): 'list' | 'tree' {
  try {
    return localStorage.getItem(TREE_MODE_KEY) === 'list' ? 'list' : 'tree';
  } catch {
    return 'tree';
  }
}

let state: ReviewState = {
  files: [],
  loading: false,
  isRepo: true,
  selectedPath: null,
  diff: null,
  diffLoading: false,
  treeMode: readTreeMode(),
  revertTarget: undefined,
  shipBusy: false,
  commitMsgBusy: false,
};

let revealRequest = 0;
const listeners = new Set<() => void>();
/** 面板揭示请求订阅（App 消费：揭示请求 → 开右栏切审查 tab），与状态订阅共行 */
const revealListeners = new Set<() => void>();

const EMPTY_FILES: ReviewFile[] = [];
let snapshot: ReviewSnapshot = { ...state, revealRequest };

function emit(): void {
  snapshot = { ...state, revealRequest };
  listeners.forEach((l) => l());
  revealListeners.forEach((l) => l());
}

function update(patch: Partial<ReviewState>): void {
  state = { ...state, ...patch };
  emit();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): ReviewSnapshot {
  return snapshot;
}

/** React 订阅（ReviewPane 消费） */
export function useReview(): ReviewSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ── repo scope（对齐 Hermes reviewRepoCwd：scope 恒 null = 跟随活动会话 cwd）──

function repoCwd(): string | null {
  return getCurrentSessionCwd() || null;
}

// ── Reads ────────────────────────────────────────────────────────

let refreshSeq = 0;

/** 全量重同步：文件列表 + 选中文件的 diff（过期响应按 seq/cwd 双校验丢弃） */
export async function refreshReview(): Promise<void> {
  const seq = ++refreshSeq;
  const cwd = repoCwd();

  if (!cwd) {
    update({ files: [], isRepo: false, loading: false });
    return;
  }

  update({ isRepo: true, loading: true });
  try {
    const res = await call('git_review_list', { path: cwd }) as { is_repo?: boolean; files?: ReviewFile[] };
    if (seq !== refreshSeq || repoCwd() !== cwd) return;
    const files = res?.files ?? [];
    update({ files, isRepo: res?.is_repo !== false });

    // 选中文件被删（staged away/reverted）→ 清选区防悬挂；否则懒取 diff
    const selected = state.selectedPath;
    const selectedFile = selected ? files.find((f) => f.path === selected) : null;
    if (selected && !selectedFile) {
      clearReviewSelection();
    } else if (selectedFile && state.diff === null) {
      void selectReviewFile(selectedFile);
    }
  } catch {
    if (seq === refreshSeq) update({ files: EMPTY_FILES });
  } finally {
    if (seq === refreshSeq) update({ loading: false });
  }
}

/** 选中文件并拉取其 diff（staged 标志决定 diff 源：cached vs worktree） */
export async function selectReviewFile(file: ReviewFile): Promise<void> {
  update({ selectedPath: file.path });
  const cwd = repoCwd();
  if (!cwd) {
    update({ diff: null });
    return;
  }
  update({ diffLoading: true });
  try {
    const res = await call('git_review_diff', { path: cwd, file: file.path, staged: file.staged }) as { diff?: string };
    if (state.selectedPath === file.path) update({ diff: res?.diff ?? '' });
  } catch {
    if (state.selectedPath === file.path) update({ diff: '' });
  } finally {
    if (state.selectedPath === file.path) update({ diffLoading: false });
  }
}

export function clearReviewSelection(): void {
  update({ selectedPath: null, diff: null, diffLoading: false });
}

/** 树/列表布局切换（localStorage 持久化，对齐 $reviewTreeMode） */
export function toggleTreeMode(): void {
  const next = state.treeMode === 'tree' ? 'list' : 'tree';
  try {
    localStorage.setItem(TREE_MODE_KEY, next);
  } catch {
    /* 存储不可用 → 本次会话内存态生效 */
  }
  update({ treeMode: next });
}

// ── Open / reveal（对齐 Hermes openReview / revealReview）──

export function openReview(): void {
  update({ files: [], loading: true });
  void refreshReview();
}

/** 面板揭示请求（App 消费：开右栏 + 切审查 tab）+ 拉数据 */
export function revealReview(): void {
  revealRequest += 1;
  emit();
  openReview();
}

/** 工具上报路径 ↔ git 仓库相对路径匹配（绝对 vs 相对，尾部对齐；对齐 matchReviewFile） */
function matchReviewFile(files: readonly ReviewFile[], path: string): ReviewFile | undefined {
  const target = path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!target) return undefined;
  return files.find((file) => {
    const candidate = file.path.replace(/\\/g, '/');
    return candidate === target || target.endsWith(`/${candidate}`) || candidate.endsWith(`/${target}`);
  });
}

/**
 * 打开审查面板并定位到单文件 diff（对齐 Hermes openReviewForPath）。
 * 路径来自工具调用，可能是绝对路径而 git 报仓库相对——尾部匹配。
 */
export async function openReviewForPath(path: string): Promise<void> {
  revealReview();
  await refreshReview();
  const file = matchReviewFile(state.files, path);
  if (file) await selectReviewFile(file);
}

// ── Mutations（变更后 afterMutation 全量重同步 + 重取打开的 diff）──

async function afterMutation(): Promise<void> {
  await refreshReview();
  const selected = state.selectedPath;
  const file = selected ? state.files.find((f) => f.path === selected) : null;
  if (file) void selectReviewFile(file);
}

export async function stageReviewFile(path: null | string): Promise<void> {
  const cwd = repoCwd();
  if (!cwd) return;
  await call('git_review_stage', { path: cwd, file: path });
  await afterMutation();
}

export async function unstageReviewFile(path: null | string): Promise<void> {
  const cwd = repoCwd();
  if (!cwd) return;
  await call('git_review_unstage', { path: cwd, file: path });
  await afterMutation();
}

export async function revertReviewFile(path: null | string): Promise<void> {
  const cwd = repoCwd();
  if (!cwd) return;
  await call('git_review_revert', { path: cwd, file: path });
  await afterMutation();
}

// ── Revert 确认（对齐 $reviewRevertTarget：undefined=关，null path=全部）──

export function requestRevert(path: null | string): void {
  update({ revertTarget: { path } });
}

export function cancelRevert(): void {
  update({ revertTarget: undefined });
}

/** 确认对话框先关，revert 后台执行——失败落 toast 而非内联 */
export async function confirmRevert(): Promise<void> {
  const target = state.revertTarget;
  update({ revertTarget: undefined });
  if (target) await revertReviewFile(target.path);
}

// ── Ship flow（commit / AI message；push 并入 commit，对齐 Hermes commitChanges）──

async function runShip<T>(action: () => Promise<T>): Promise<T> {
  update({ shipBusy: true });
  try {
    return await action();
  } finally {
    update({ shipBusy: false });
  }
}

export async function commitChanges(message: string, opts: { push?: boolean } = {}): Promise<{ pushed: boolean; push_error: string | null }> {
  const cwd = repoCwd();
  const trimmed = message.trim();
  if (!cwd || !trimmed) return { pushed: false, push_error: null };
  return runShip(async () => {
    // push 失败不回滚 commit（后端契约）：结果如实上浮，调用方呈现 toast
    const res = await call('git_review_commit', { path: cwd, message: trimmed, push: Boolean(opts.push) }) as {
      pushed?: boolean;
      push_error?: string | null;
    };
    await refreshReview();
    return { pushed: Boolean(res?.pushed), push_error: res?.push_error ?? null };
  });
}

// 单调代币：Stop/新按键 bump，过期生成结果直接丢弃（模型调用不可服务端中止）
let commitGenSeq = 0;

export function cancelCommitMessage(): void {
  commitGenSeq += 1;
  update({ commitMsgBusy: false });
}

/**
 * AI 起草 commit message：走 ELEVE 已有 llm.oneshot（辅助链 + 内置 API KEY，
 * 对齐 Hermes requestOneShot template commit_message）。`previous` 作避免重复
 * 的输入回传——重按 = 真重新生成。失败抛出由调用方 toast。
 */
export async function generateCommitMessage(previous = ''): Promise<string> {
  const cwd = repoCwd();
  if (!cwd) return '';
  const gen = ++commitGenSeq;
  const live = () => gen === commitGenSeq;
  update({ commitMsgBusy: true });
  try {
    const ctx = await call('git_review_commit_context', { path: cwd }) as { diff?: string; recent?: string };
    const diff = ctx?.diff ?? '';
    if (!live() || !diff.trim()) return '';
    const instructions = [
      'You are drafting a git commit message for the following staged/unstaged changes.',
      'Write ONE concise line in conventional style (type(scope): summary), max 72 chars.',
      'No body, no quotes, no backticks, output the message line only.',
    ].join('\n');
    const input = [
      previous.trim() ? `Avoid repeating or paraphrasing this previous attempt: ${previous.trim()}` : '',
      `Recent commits for style reference:\n${ctx?.recent ?? ''}`,
      `Diff:\n${diff}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const res = await call('llm_oneshot', { instructions, input, temperature: 0.8 }) as { text?: string };
    return live() ? (res?.text ?? '').trim() : '';
  } finally {
    if (live()) update({ commitMsgBusy: false });
  }
}

// ── 面板揭示请求订阅（对齐 store/preview.ts paneOpenRequest 模式；App 消费）──

/** React 订阅（App：揭示请求 → 开右栏切审查 tab） */
export function useReviewRevealRequest(): number {
  return useSyncExternalStore(
    (cb) => {
      revealListeners.add(cb);
      return () => {
        revealListeners.delete(cb);
      };
    },
    () => revealRequest,
    () => revealRequest,
  );
}
