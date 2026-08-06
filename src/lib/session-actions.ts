/**
 * session-actions.ts — 会话操作共享层（对齐 Hermes session-actions-menu 的 action 面）
 *
 * 单一权威：ProjectTreePanel 行菜单 / SessionsPanel 面板菜单共用同一套操作函数
 * （同 API 调用、同通知语义）。会话的持久操作（delete/rename/archive/export）
 * 走后端 RPC；pin 是本地 UI 状态（SessionsPanel 管理，行菜单读同一 localStorage）。
 */

import { call } from '../utils/bridge';
import { deleteSession } from '../utils/api';
import { notifySuccess, notifyError, notifyInfo } from '../utils/notifications';

/** 删除会话（对齐 Hermes delete 危险项；后端删除后通知列表刷新） */
export async function deleteSessionAction(id: string, onDeleted?: (id: string) => void): Promise<void> {
  try {
    await deleteSession(id);
    onDeleted?.(id);
  } catch { /* 后端失败静默（与 SessionsPanel 一致） */ }
}

/** 重命名会话（对齐 Hermes renameSessionPreferringRpc；失败本地保留） */
export async function renameSessionAction(
  id: string,
  newTitle: string,
  onRenamed?: (id: string, title: string) => void,
): Promise<void> {
  try {
    await call('rename_session', { session_id: id, title: newTitle });
    notifySuccess('已重命名');
  } catch {
    notifyInfo('重命名已保存（本地）');
  }
  // 不可变更新（onRenamed = App 层 setTitle 接线）
  onRenamed?.(id, newTitle);
}

/** 归档/取消归档会话（对齐 Hermes archive；返回新状态） */
export async function toggleArchiveSession(id: string, isArchived: boolean): Promise<boolean> {
  try {
    isArchived
      ? await call('unarchive_session', { session_id: id })
      : await call('archive_session', { session_id: id });
    notifySuccess(isArchived ? '已取消归档' : '已归档');
    return !isArchived;
  } catch {
    notifyInfo(isArchived ? '取消归档失败' : '归档失败，请重试');
    return isArchived;
  }
}

/** 导出会话为 JSON 下载（对齐 Hermes exportSession） */
export async function exportSessionAction(id: string, title: string): Promise<void> {
  try {
    const data = await call('export_session', { session_id: id });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(title || id).replace(/[^a-zA-Z0-9\u4e00-\u9fff-_ ]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notifySuccess('已导出会话');
  } catch (err: unknown) {
    notifyError((err as Error).message || err, '导出失败');
  }
}

/** 复制会话 ID（对齐 Hermes copyId） */
export async function copySessionId(id: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(id);
    notifySuccess('已复制 ID');
  } catch {
    notifyError('复制失败', '无法复制');
  }
}
