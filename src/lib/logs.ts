/**
 * logs — 后端日志 tail 拉取（对齐 Hermes hermes.ts getLogs）
 *
 * Hermes getLogs({ file?, lines?, level?, component?, search? }) → LogsResponse
 * （Electron bridge → python web_server 日志端点）。ELEVE 等价物 = 已有 HTTP
 * 端点 GET /api/logs（handlers/logs.rs：file=agent|gateway|error，tail 高效读取
 * 或全量过滤，lines 默认 100 max 500）。零后端改动，前端直接消费。
 */

import { getApiBase } from '@/utils/api'

export interface LogsParams {
  file?: 'agent' | 'gateway' | 'error'
  lines?: number
  level?: string
  component?: string
  search?: string
}

export interface LogsResponse {
  file: string
  lines: string[]
  total?: number
}

export const LOG_FILES: Array<{ id: 'agent' | 'gateway' | 'error'; label: string }> = [
  { id: 'agent', label: 'Agent' },
  { id: 'gateway', label: 'Gateway' },
  { id: 'error', label: 'Error' },
]

export async function fetchLogs(params: LogsParams = {}): Promise<LogsResponse> {
  const query = new URLSearchParams()

  if (params.file) {
    query.set('file', params.file)
  }
  if (typeof params.lines === 'number') {
    query.set('lines', String(params.lines))
  }
  if (params.level && params.level !== 'ALL') {
    query.set('level', params.level)
  }
  if (params.component && params.component !== 'all') {
    query.set('component', params.component)
  }
  if (params.search) {
    query.set('search', params.search)
  }

  const resp = await fetch(`${getApiBase()}/api/logs${query.toString() ? `?${query.toString()}` : ''}`)
  if (!resp.ok) {
    throw new Error(`GET /api/logs: ${resp.status}`)
  }
  return (await resp.json()) as LogsResponse
}
