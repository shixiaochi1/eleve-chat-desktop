import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Codicon } from './ui/codicon';
import { ModelIcon, LoadingIcon, CollapseIcon, CheckIcon } from './Icons';
import ModelOptionsSubmenu from './ModelOptionsSubmenu';
import type { GroupedModels } from '@/hooks/useModels';
import { useModelContext } from '@/contexts/ModelContext';
import {
  effectiveReasoningEffort,
  setFastMode,
  setGlobalReasoning,
  setSessionReasoning,
  useSessionReasoning,
} from '@/store/session-reasoning';
import { effortStatusSuffix } from '@/lib/model-status-label';
import { DEFAULT_REASONING_EFFORT } from '@/lib/reasoning-efforts';
import { getModelPreset, setModelPreset, useModelPresets } from '@/store/model-presets';
import { writeFastMode, writeReasoningEffort } from '@/lib/reasoning-writes';
import { getWsClient } from '@/services/ws-client';
import { notifyError } from '@/utils/notifications';

/** config.get 双形态取值（裸值 / {value} 包裹） */
const configValue = (res: unknown): unknown =>
  typeof res === 'string' ? res : (res as { value?: unknown } | null)?.value;

/** 对齐 Hermes isFastTier：fast/priority/on 视为开启 */
const isFastTier = (v: unknown): boolean =>
  typeof v === 'string' && ['fast', 'priority', 'on'].includes(v.trim().toLowerCase());

interface ModelPillProps {
  /** 当前模型名（本地选中值，或后端运行值兜底） */
  model?: string;
  /** 按 provider 分组的模型列表 */
  grouped?: GroupedModels;
  /** 模型列表加载中 */
  loading?: boolean;
  /** 模型列表加载错误 */
  error?: string | null;
  /** 切换模型（调用后端 setModel） */
  onSelect?: (modelId: string) => void;
  /** 打开设置面板（池空时引导用户配置） */
  onOpenSettings?: () => void;
  /** 下拉展开时强制刷新模型列表（FIX-C：兜底后端广播丢失） */
  onRefresh?: () => void;
  /** 标签是否叠加 `· 快速 中` 状态（对齐 Hermes 输入区胶囊；宫格卡片不传，防主会话档位串台） */
  showEffort?: boolean;
  /** 目标会话 id —— 切模型后恢复该模型的思考预设时写入会话级（缺省写全局） */
  sessionId?: string | null;
}

/**
 * 模型胶囊 — Hermes 式 Model Pill（对齐 Hermes composer model-pill）
 *
 * 常驻输入区控制行：显示当前模型名，点击展开按 provider 分组的下拉列表切换。
 * 数据由 App 持有的 useModels 单例经 InputArea 传入（单一数据源，不重复请求）。
 * 与 [≡] 命令、[📎] 附件共用同一套 ghost 控件语言：28px 高、悬停背景反馈。
 *
 * 微交互：展开时箭头旋转 180°、菜单缩放入场（下拉组件内置）、选中项打勾高亮。
 */
export default function ModelPill(props: ModelPillProps) {
  // 🔴 Context 优先，props 覆盖（向后兼容：既有调用方传 props 仍然生效）
  const ctx = useModelContext();
  const model = props.model ?? ctx.currentModel;
  const grouped = props.grouped ?? ctx.grouped ?? {};
  const loading = props.loading ?? ctx.loading;
  const error = props.error ?? ctx.error;
  const onSelect = props.onSelect ?? ctx.onSelect;
  const onOpenSettings = props.onOpenSettings ?? ctx.onOpenSettings;
  const onRefresh = props.onRefresh ?? ctx.onRefresh;
  const groups = Object.values(grouped);
  const hasModels = groups.length > 0;

  // 🔴 搜索过滤（对齐 Hermes app/shell/model-catalog-menu + 仓内 kanban/ModelCatalogMenu）：
  // 命中 model id 或 provider 名子串即保留；provider 命中 ⇒ 该组整组保留
  // （每行都满足 provider 条件，语义与范例的扁平行过滤一致）。
  const [query, setQuery] = useState('');
  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = Object.values(grouped);
    if (!q) return all;
    return all
      .map((g) => ({
        ...g,
        models: g.models.filter(
          (m) => m.id.toLowerCase().includes(q) || (g.providerName || '').toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.models.length > 0);
  }, [grouped, query]);
  // P3：友好显示名 — "provider/model" ref 只显示模型名（完整 ref 在 title/下拉项里）
  const shortModel = model ? (model.includes('/') ? model.slice(model.indexOf('/') + 1) : model) : '';
  const displayName = shortModel || (loading ? '模型加载中' : hasModels ? '选择模型' : '无模型');

  // 🔴 2026-10-31 对齐 Hermes：输入区胶囊标签 = `模型 · 快速 中`（档位恒显示）。
  //   宫格卡片不传 showEffort（各自独立会话）→ 不叠加主会话档位，防串台。
  // 菜单受控：模型行是 SubTrigger（点击不再自动关闭根菜单），切模型后手动收起。
  const [menuOpen, setMenuOpen] = useState(false);

  // 🔴 全局默认的挂载读回：草稿会话（未创建）没有 session.info 推送，
  //   思考档位/快速模式必须在这里补一次，否则新建聊天会显示 medium / 关闭。
  useEffect(() => {
    if (!props.showEffort) return;
    const ws = getWsClient();
    ws.configGet('agent.reasoning_effort')
      .then((res) => {
        const v = configValue(res);
        if (typeof v === 'string') setGlobalReasoning(v);
      })
      .catch(() => {});
    ws.configGet('agent.service_tier')
      .then((res) => setFastMode(isFastTier(configValue(res))))
      .catch(() => {});
  }, [props.showEffort]);

  // 预设变更订阅：非活跃行的选项改动不会写会话/store，必须靠这个触发重渲染，
  // 否则子菜单里的开关/选中态会停在旧值。
  useModelPresets();

  const reasoningState = useSessionReasoning();
  const statusSuffix = props.showEffort && shortModel
    ? effortStatusSuffix({
        fast: reasoningState.fast,
        effort: effectiveReasoningEffort(reasoningState, props.sessionId ?? ''),
        model,
      })
    : '';

  // 🔴 2026-10-31 对齐 Hermes `applyModelPreset`：切到某模型时恢复它上次的
  //   思考档位/快速偏好（键 provider::model；有会话写会话级，否则写全局默认）。
  //   store 是「主输入区」单值：宫格卡片（不传 showEffort）只写会话，不更新 store。
  const handleSelectModel = (id: string) => {
    setMenuOpen(false);
    onSelect?.(id);
    const at = id.indexOf('/');
    if (at <= 0) return;
    const provider = id.slice(0, at);
    const modelId = id.slice(at + 1);
    const preset = getModelPreset(provider, modelId);

    if (preset.effort) {
      if (props.sessionId) {
        if (props.showEffort) setSessionReasoning(props.sessionId, preset.effort);
        void writeReasoningEffort(props.sessionId, preset.effort).catch(() => {});
      } else if (props.showEffort) {
        setGlobalReasoning(preset.effort);
        void writeReasoningEffort(undefined, preset.effort).catch(() => {});
      }
    }

    if (preset.fast !== undefined) {
      if (props.sessionId) {
        if (props.showEffort) setFastMode(preset.fast);
        void writeFastMode(props.sessionId, preset.fast).catch(() => {});
      } else if (props.showEffort) {
        setFastMode(preset.fast);
        void writeFastMode(undefined, preset.fast).catch(() => {});
      }
    }
  };

  /**
   * 模型子菜单的选项写入（对齐 Hermes `controller.setOptions`）：
   * - 总是记录该模型的 preset（跨会话记忆）；
   * - 仅**活跃行**把改动推到会话（有会话）/全局默认（草稿）。
   */
  const setOptionsFor = (targetId: string, patch: { effort?: string; fast?: boolean }) => {
    const at = targetId.indexOf('/');
    if (at <= 0) return;
    const provider = targetId.slice(0, at);
    const modelId = targetId.slice(at + 1);
    setModelPreset(provider, modelId, patch);

    const isActive = !!model && targetId === model;
    if (!isActive) return;

    if (patch.effort !== undefined) {
      if (props.sessionId) setSessionReasoning(props.sessionId, patch.effort);
      else setGlobalReasoning(patch.effort);
      void writeReasoningEffort(props.sessionId, patch.effort).catch((err) => {
        notifyError(err, '思考档位更新失败');
      });
    }

    if (patch.fast !== undefined) {
      setFastMode(patch.fast);
      void writeFastMode(props.sessionId, patch.fast).catch((err) => {
        notifyError(err, '快速模式更新失败');
      });
    }
  };

  return (
    <DropdownMenu
      open={menuOpen}
      onOpenChange={(open) => {
        setMenuOpen(open);
        if (open) onRefresh?.();
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'group inline-flex h-(--composer-control-size) max-w-44 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 outline-none transition-colors',
            'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
          title={
            model
              ? `当前模型：${model}${statusSuffix ? ` · ${statusSuffix}` : ''}（点击切换）`
              : '切换模型'
          }
          aria-label="切换模型"
        >
          {loading ? (
            <LoadingIcon className="shrink-0 animate-spin" />
          ) : (
            <ModelIcon className="shrink-0" />
          )}
          <span className="min-w-0 truncate text-xs font-medium">{displayName}</span>
          {statusSuffix && (
            <span className="shrink-0 text-[10px] opacity-70">· {statusSuffix}</span>
          )}
          <CollapseIcon
            size={12}
            className="shrink-0 opacity-60 transition-transform duration-150 group-data-[state=open]:rotate-180"
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        {/* 🔴 搜索框常驻（对齐 Hermes：搜索做在下拉内，不开全屏面板）——
            仅在确有模型可筛时显示，避免空态/错误态多一个无用的输入框 */}
        {!loading && !error && hasModels && (
          <DropdownMenuSearch placeholder="搜索模型 / Provider…" onValueChange={setQuery} />
        )}
        {loading && <DropdownMenuLabel>模型列表加载中…</DropdownMenuLabel>}
        {!loading && error === 'empty' && !hasModels && (
          <DropdownMenuLabel className="flex flex-col gap-1.5">
            <span className="text-muted-foreground">未配置 Provider</span>
            {onOpenSettings && (
              <button
                className="mt-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90"
                onClick={onOpenSettings}
              >
                前往设置
              </button>
            )}
          </DropdownMenuLabel>
        )}
        {!loading && error && error !== 'empty' && !hasModels && (
          <DropdownMenuLabel className="text-destructive">连接失败：{error}</DropdownMenuLabel>
        )}
        {!loading && !error && !hasModels && <DropdownMenuLabel>无可用模型</DropdownMenuLabel>}
        {!loading && !error && hasModels && filteredGroups.length === 0 && (
          <DropdownMenuLabel>无匹配模型</DropdownMenuLabel>
        )}
        {filteredGroups.map((group, gi) => (
          <div key={group.providerId}>
            {gi > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[0.625rem] uppercase tracking-wide">
              {group.providerName}
            </DropdownMenuLabel>
            {group.models.map((m) => {
              const selected = !!model && m.id === model;

              // 宫格卡片：保持扁平列表（各自会话的档位不在主 store 里，无法安全显示）
              if (!props.showEffort) {
                return (
                  <DropdownMenuItem
                    key={m.id}
                    onSelect={() => handleSelectModel(m.id)}
                    className={cn(selected && 'text-foreground')}
                  >
                    <span className="min-w-0 flex-1 truncate" title={m.id}>
                      {m.id}
                    </span>
                    {selected && <CheckIcon className="shrink-0 text-primary" />}
                  </DropdownMenuItem>
                );
              }

              // 主输入区：对齐 Hermes「每行模型 → 齿轮子菜单（Options / 推理强度）」
              const at = m.id.indexOf('/');
              const rowProvider = at > 0 ? m.id.slice(0, at) : group.providerId;
              const rowModel = at > 0 ? m.id.slice(at + 1) : m.id;
              const rowPreset = getModelPreset(rowProvider, rowModel);
              const rowEffort = selected
                ? effectiveReasoningEffort(reasoningState, props.sessionId ?? '')
                : rowPreset.effort || DEFAULT_REASONING_EFFORT;
              const rowFast = selected ? reasoningState.fast : (rowPreset.fast ?? false);

              return (
                <DropdownMenuSub key={m.id}>
                  <DropdownMenuSubTrigger
                    hideChevron
                    // 点击整行 = 切模型（对齐 Hermes：SubTrigger.onClick = activate）；
                    // 悬停/方向键右 = 展开选项子菜单。
                    onClick={() => handleSelectModel(m.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleSelectModel(m.id);
                      }
                    }}
                    className={cn('gap-1.5', selected && 'text-foreground')}
                  >
                    <span className="min-w-0 flex-1 truncate" title={m.id}>
                      {m.id}
                    </span>
                    {selected && <CheckIcon className="shrink-0 text-primary" />}
                    <Codicon
                      className="shrink-0 text-muted-foreground/45"
                      name="settings-gear"
                      size="0.75rem"
                    />
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-52">
                    <ModelOptionsSubmenu
                      provider={rowProvider}
                      modelId={rowModel}
                      effort={rowEffort}
                      fast={rowFast}
                      onSetOptions={(patch) => setOptionsFor(m.id, patch)}
                    />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              );
            })}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
