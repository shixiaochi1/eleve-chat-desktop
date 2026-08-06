/**
 * session-search.ts — 会话搜索匹配（对齐 Hermes apps/desktop/src/lib/session-search.ts）
 *
 * Hermes 匹配字段：id / _lineage_root_id / title / preview / cwd / git_branch / source terms。
 * ELEVE SessionInfo 无 git_branch 字段（后端 session.list 快照不含）→ 字段子集：
 * id / _lineage_root_id / title / preview / cwd / source。服务端 session.search RPC
 * （内容级全文搜索）在调用方做 200ms debounce 合并（对齐 Hermes sidebar index）。
 */
import { normalize } from './text';
import { call } from '../utils/bridge';
import type { Session, SessionSearchResponse, SessionSearchResult } from '@/types';

/** 本地字段匹配（对齐 Hermes sessionMatchesSearch） */
export function sessionMatchesSearch(session: Session, query: string): boolean {
  const needle = normalize(query);
  if (!needle) return true;

  const s = session as Session & { _lineage_root_id?: string | null; cwd?: string | null; source?: string | null };
  return [
    s.id,
    s._lineage_root_id ?? '',
    s.title ?? '',
    s.preview ?? '',
    s.cwd ?? '',
    s.source ?? '',
  ].some((value) => value.toLowerCase().includes(needle));
}

/** 服务端全文搜索（对齐 Hermes searchSessions：全量会话可找，不只已加载页） */
export async function searchSessions(query: string, limit = 20): Promise<SessionSearchResult[]> {
  try {
    const data = await call('search_sessions', { q: query, limit }) as SessionSearchResponse | null;
    return data?.results ?? [];
  } catch {
    return [];
  }
}

/** 服务端命中 → 会话占位（对齐 Hermes searchResultToSession；未被列表加载的会话） */
export function searchResultToSession(r: SessionSearchResult): Session {
  return {
    id: r.session_id,
    title: null,
    preview: r.snippet,
    model: r.model,
    source: r.source,
    started_at: r.session_started ?? 0,
    last_active: r.session_started ?? 0,
    message_count: 0,
    input_tokens: 0,
    output_tokens: 0,
    tool_call_count: 0,
    is_active: false,
    ended_at: null,
    _lineage_root_id: r.lineage_root ?? null,
  };
}
