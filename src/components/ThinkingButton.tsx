import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { ThinkingIcon, CheckIcon, CollapseIcon } from './Icons';
import { getWsClient } from '@/services/ws-client';
import { REASONING_EFFORTS, type ReasoningEffort } from '@/lib/reasoning-efforts';
import { useModelContext } from '@/contexts/ModelContext';
import { useModelReasoningSupport } from '@/hooks/useModelReasoningSupport';

/** 后端配置键（对应 eleve-config agent.reasoning_effort） */
const CONFIG_KEY = 'agent.reasoning_effort';

/**
 * 思考深度 — 对齐 Hermes reasoning_effort
 *
 * 按钮（图标+当前档位+箭头）+ 下拉六档选择，每档带说明、选中打勾。
 * 选中后 config.set 持久化（内存+磁盘，立即生效）；挂载时读回已存档位。
 */
export default function ThinkingButton() {
  // 🔴 2026-08-10 主模型能力门控（对齐 Hermes mainCaps.reasoning ?? true）：
  //   当前主模型（provider/model）不支持推理 → 按钮禁用 + 提示，设置不会生效。
  //   未知/查询失败/未配置模型 → 不禁用（Hermes ?? true 语义）。
  const { currentModel } = useModelContext();
  // 🔴 共享 hook（hooks/useModelReasoningSupport）：按主模型能力门控
  const ref = (currentModel || '').trim();
  const slash = ref.indexOf('/');
  const reasoningUnsupported = useModelReasoningSupport(
    slash > 0 ? ref.slice(0, slash) : null,
    slash > 0 ? ref.slice(slash + 1) : null,
  );

  // Hermes normalizeEffort 语义：空/未知 → medium
  const [effort, setEffort] = useState<ReasoningEffort>('medium');

  // 挂载时读回已持久化的档位（防御性：任何异常/未知值都回退 Hermes 默认 medium）
  useEffect(() => {
    getWsClient()
      .configGet(CONFIG_KEY)
      .then((res) => {
        // 🔴 兼容两种返回形态：后端 config.get 返回裸 pointer 值（如 "high"），
        // 部分端点返回 { value: ... } 包裹——都取字符串值
        const v = typeof res === 'string' ? res : (res as { value?: unknown })?.value;
        if (typeof v === 'string' && REASONING_EFFORTS.some((e) => e.value === v)) {
          setEffort(v as ReasoningEffort);
        } else {
          // 空/旧值 ''(自动)/未知 → Hermes unset → medium
          setEffort('medium');
        }
      })
      .catch(() => {});
  }, []);

  const handleSelect = useCallback((value: ReasoningEffort) => {
    setEffort(value);
    getWsClient().configSet(CONFIG_KEY, value).catch((err) => {
      console.warn('[ThinkingButton] config.set failed:', err);
    });
  }, []);

  const current = REASONING_EFFORTS.find((e) => e.value === effort);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'group inline-flex h-(--composer-control-size) shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 outline-none transition-colors',
            'text-muted-foreground hover:bg-accent hover:text-foreground',
            reasoningUnsupported && 'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground'
          )}
          title={reasoningUnsupported ? '当前模型不支持思考模式，此设置不会生效' : `思考深度：${current?.label}（点击切换）`}
          aria-label="思考深度"
          disabled={reasoningUnsupported}
        >
          <ThinkingIcon className="shrink-0" />
          <span className="text-[10px] font-medium">{current?.label}</span>
          <CollapseIcon
            size={10}
            className="shrink-0 opacity-50 transition-transform duration-150 group-data-[state=open]:rotate-180"
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="start" className="flex w-72 flex-col gap-1">
        {/* 标题头 — 对齐 Hermes "REASONING LEVEL" */}
        <DropdownMenuLabel className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground/70">
          思考深度
        </DropdownMenuLabel>
        {REASONING_EFFORTS.map((e) => {
          const selected = effort === e.value;
          return (
            <DropdownMenuItem
              key={e.label}
              onSelect={() => handleSelect(e.value)}
              className={cn(
                'items-start gap-2 rounded-lg border px-2.5 py-2',
                selected
                  ? 'border-primary bg-primary/5 text-foreground'
                  : 'border-border/40'
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={cn('text-xs', selected ? 'font-semibold' : 'font-medium')}>
                  {e.label}
                </span>
                <span className="text-[10px] leading-snug text-muted-foreground/70">{e.desc}</span>
              </div>
              {selected && <CheckIcon className="mt-0.5 shrink-0 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
