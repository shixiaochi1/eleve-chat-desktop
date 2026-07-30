import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { ModelIcon, LoadingIcon, CollapseIcon, CheckIcon } from './Icons';
import type { GroupedModels } from '@/hooks/useModels';
import { useModelContext } from '@/contexts/ModelContext';

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
  // P3：友好显示名 — "provider/model" ref 只显示模型名（完整 ref 在 title/下拉项里）
  const shortModel = model ? (model.includes('/') ? model.slice(model.indexOf('/') + 1) : model) : '';
  const displayName = shortModel || (loading ? '模型加载中' : hasModels ? '选择模型' : '无模型');

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) onRefresh?.(); }}>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'group inline-flex h-(--composer-control-size) max-w-44 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 outline-none transition-colors',
            'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
          title={model ? `当前模型：${model}（点击切换）` : '切换模型'}
          aria-label="切换模型"
        >
          {loading ? (
            <LoadingIcon className="shrink-0 animate-spin" />
          ) : (
            <ModelIcon className="shrink-0" />
          )}
          <span className="min-w-0 truncate text-xs font-medium">{displayName}</span>
          <CollapseIcon
            size={12}
            className="shrink-0 opacity-60 transition-transform duration-150 group-data-[state=open]:rotate-180"
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
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
        {groups.map((group, gi) => (
          <div key={group.providerId}>
            {gi > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[0.625rem] uppercase tracking-wide">
              {group.providerName}
            </DropdownMenuLabel>
            {group.models.map((m) => {
              const selected = !!model && m.id === model;
              return (
                <DropdownMenuItem
                  key={m.id}
                  onSelect={() => onSelect?.(m.id)}
                  className={cn(selected && 'text-foreground')}
                >
                  <span className="min-w-0 flex-1 truncate" title={m.id}>
                    {m.id}
                  </span>
                  {selected && <CheckIcon className="shrink-0 text-primary" />}
                </DropdownMenuItem>
              );
            })}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
