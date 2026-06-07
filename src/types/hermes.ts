/**
 * Hermes-aligned type definitions — 1:1 from hermes-agent/apps/desktop/src/types/hermes.ts
 *
 * These types describe API responses and data structures shared between
 * Hermes and Eleve. Import from '@/types/hermes' in any component/hook.
 */

// ── Config ──

export interface ConfigFieldSchema {
  category?: string
  description?: string
  options?: unknown[]
  type?: 'boolean' | 'list' | 'number' | 'select' | 'string' | 'text'
}

export interface ConfigSchemaResponse {
  category_order?: string[]
  fields: Record<string, ConfigFieldSchema>
}

export interface HermesConfig {
  agent?: {
    reasoning_effort?: string
    personalities?: Record<string, unknown>
    service_tier?: string
  }
  display?: {
    personality?: string
    skin?: string
  }
  terminal?: {
    cwd?: string
  }
  stt?: {
    enabled?: boolean
  }
  voice?: {
    max_recording_seconds?: number
  }
}

// ── Environment / Credentials ──

export interface EnvVarInfo {
  advanced: boolean
  category: string
  channel_managed?: boolean
  description: string
  is_password: boolean
  is_set: boolean
  redacted_value: null | string
  tools: string[]
  url: null | string
}

// ── Model / Provider ──

export interface ModelOptionProvider {
  is_current?: boolean
  models?: string[]
  name: string
  slug: string
  total_models?: number
  warning?: string
  pricing?: Record<string, ModelPricing>
  free_tier?: boolean
  unavailable_models?: string[]
  capabilities?: Record<string, ModelCapabilities>
}

export interface ModelCapabilities {
  fast: boolean
  reasoning: boolean
}

export interface ModelOptionsResponse {
  model?: string
  provider?: string
  providers?: ModelOptionProvider[]
}

export interface ModelInfoResponse {
  auto_context_length?: number
  capabilities?: Record<string, unknown>
  config_context_length?: number
  effective_context_length?: number
  model: string
  provider: string
}

export interface ModelPricing {
  input: string
  output: string
  cache: string | null
  free: boolean
}

export interface ModelAssignmentRequest {
  base_url?: string
  model: string
  provider: string
  scope: 'main' | 'auxiliary'
  task?: string
}

export interface ModelAssignmentResponse {
  base_url?: string
  gateway_tools?: string[]
  model?: string
  ok: boolean
  provider?: string
  reset?: boolean
  scope?: string
  stale_aux?: StaleAuxAssignment[]
  tasks?: string[]
}

export interface StaleAuxAssignment {
  task: string
  provider: string
  model: string
}

// ── Platform / Gateway ──

export interface PlatformStatus {
  error_code?: string
  error_message?: string
  state: string
  updated_at: string
}

export interface StatusResponse {
  active_sessions: number
  config_path: string
  config_version: number
  env_path: string
  gateway_exit_reason: string | null
  gateway_health_url: string | null
  gateway_pid: number | null
  gateway_platforms: Record<string, PlatformStatus>
  gateway_running: boolean
  gateway_state: string | null
  gateway_updated_at: string | null
  hermes_home: string
  latest_config_version: number
  release_date: string
  version: string
}

export interface MessagingEnvVarInfo {
  advanced: boolean
  description: string
  is_password: boolean
  is_set: boolean
  key: string
  prompt: string
  redacted_value: null | string
  required: boolean
  url: null | string
}

export interface MessagingHomeChannel {
  chat_id: string
  name: string
  platform: string
  thread_id?: string
}

export interface MessagingPlatformInfo {
  configured: boolean
  description: string
  docs_url: string
  enabled: boolean
  env_vars: MessagingEnvVarInfo[]
  error_code?: null | string
  error_message?: null | string
  gateway_running: boolean
  home_channel?: MessagingHomeChannel | null
  id: string
  name: string
  state?: null | string
  updated_at?: null | string
}

export interface MessagingPlatformsResponse {
  platforms: MessagingPlatformInfo[]
}

// ── Session ──

export interface SessionInfo {
  archived?: boolean
  cwd?: null | string
  ended_at: null | number
  id: string
  _lineage_root_id?: null | string
  input_tokens: number
  is_active: boolean
  last_active: number
  message_count: number
  model: null | string
  output_tokens: number
  preview: null | string
  source: null | string
  started_at: number
  title: null | string
  tool_call_count: number
  profile?: string
  is_default_profile?: boolean
}

export interface SessionMessage {
  codex_reasoning_items?: unknown
  content: unknown
  context?: unknown
  name?: string
  reasoning?: null | string
  reasoning_content?: null | string
  reasoning_details?: unknown
  role: 'assistant' | 'system' | 'tool' | 'user'
  text?: unknown
  timestamp?: number
  tool_call_id?: null | string
  tool_calls?: unknown
  tool_name?: string
}

export interface PaginatedSessions {
  limit: number
  offset: number
  sessions: SessionInfo[]
  total: number
  profile_totals?: Record<string, number>
  errors?: Array<{ profile: string; error: string }>
}

export interface SessionCreateResponse {
  info?: SessionRuntimeInfo
  message_count?: number
  messages?: SessionMessage[]
  session_id: string
  stored_session_id?: string
}

export interface SessionRuntimeInfo {
  branch?: string
  config_warning?: string
  credential_warning?: string
  cwd?: string
  desktop_contract?: number
  fast?: boolean
  model?: string
  personality?: string
  provider?: string
  reasoning_effort?: string
  running?: boolean
  service_tier?: string
  skills?: Record<string, string[]> | string[]
  tools?: Record<string, string[]>
  usage?: Partial<UsageStats>
  version?: string
  yolo?: boolean
}

// ── Usage / Analytics ──

export interface UsageStats {
  calls: number
  context_max?: number
  context_percent?: number
  context_used?: number
  cost_usd?: number
  input: number
  output: number
  total: number
}

export interface AnalyticsDailyEntry {
  actual_cost: number
  api_calls: number
  cache_read_tokens: number
  day: string
  estimated_cost: number
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  sessions: number
}

export interface AnalyticsModelEntry {
  api_calls: number
  estimated_cost: number
  input_tokens: number
  model: string
  output_tokens: number
  sessions: number
}

export interface AnalyticsResponse {
  by_model: AnalyticsModelEntry[]
  daily: AnalyticsDailyEntry[]
  period_days: number
  skills: {
    summary: AnalyticsSkillsSummary
    top_skills: AnalyticsSkillEntry[]
  }
  totals: AnalyticsTotals
}

export interface AnalyticsSkillEntry {
  last_used_at: null | number
  manage_count: number
  percentage: number
  skill: string
  total_count: number
  view_count: number
}

export interface AnalyticsSkillsSummary {
  distinct_skills_used: number
  total_skill_actions: number
  total_skill_edits: number
  total_skill_loads: number
}

export interface AnalyticsTotals {
  total_actual_cost: number
  total_api_calls: null | number
  total_cache_read: null | number
  total_estimated_cost: number
  total_input: null | number
  total_output: null | number
  total_reasoning: null | number
  total_sessions: number
}

// ── Cron ──

export interface CronJob {
  deliver?: null | string
  enabled: boolean
  id: string
  last_error?: null | string
  last_run_at?: null | string
  name?: null | string
  next_run_at?: null | string
  prompt?: null | string
  schedule?: CronJobSchedule
  schedule_display?: null | string
  script?: null | string
  state?: null | string
}

export interface CronJobCreatePayload {
  deliver?: string
  name?: string
  prompt: string
  schedule: string
}

export interface CronJobSchedule {
  display?: string
  expr?: string
  kind?: string
}

export interface CronJobUpdates {
  deliver?: string
  enabled?: boolean
  name?: string
  prompt?: string
  schedule?: string
}

// ── Skill ──

export interface SkillInfo {
  category: string
  description: string
  enabled: boolean
  name: string
}

// ── Toolset ──

export interface ToolsetInfo {
  configured: boolean
  description: string
  enabled: boolean
  label: string
  name: string
  tools: string[]
}

export interface ToolEnvVar {
  key: string
  prompt: string
  url: string | null
  default: string | null
  is_set: boolean
}

export interface ToolProvider {
  name: string
  badge: string
  tag: string
  env_vars: ToolEnvVar[]
  post_setup: string | null
  requires_nous_auth: boolean
  is_active: boolean
}

export interface ToolsetConfig {
  name: string
  has_category: boolean
  providers: ToolProvider[]
  active_provider: string | null
}

// ── Profile ──

export interface ProfileInfo {
  has_env: boolean
  is_default: boolean
  model: null | string
  name: string
  path: string
  provider: null | string
  skill_count: number
}

export interface ProfilesResponse {
  profiles: ProfileInfo[]
}

// ── RPC / Gateway Events ──

export interface RpcEvent<T = unknown> {
  payload?: T
  session_id?: string
  type: string
}

export interface GatewayReadyPayload {
  skin?: unknown
}

// ── Action ──

export interface ActionResponse {
  name: string
  ok: boolean
  pid: number
}

export interface ActionStatusResponse {
  exit_code: number | null
  lines: string[]
  name: string
  pid: number | null
  running: boolean
}

// ── Search ──

export interface SessionSearchResult {
  lineage_root?: string | null
  model: string | null
  role: string | null
  session_id: string
  session_started: number | null
  snippet: string
  source: string | null
}

export interface SessionSearchResponse {
  results: SessionSearchResult[]
}

// ── Auxiliary LLM ──

export interface AuxiliaryTaskAssignment {
  base_url: string
  model: string
  provider: string
  task: string
}

export interface AuxiliaryModelsResponse {
  main: { model: string; provider: string }
  tasks: AuxiliaryTaskAssignment[]
}
