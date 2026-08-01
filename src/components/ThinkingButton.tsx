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

/**
 * 思考深度档位 — 对齐 Hermes REASONING LEVEL 六档设计（VALID_REASONING_EFFORTS + none）
 * value 为写入后端配置 agent.reasoning_effort 的值：
 *   none/minimal/low/medium/high/xhigh（Hermes 同款六档）；
 *   空/未知值读回 → medium（Hermes normalizeEffort: empty → medium）
 */
const EFFORTS = [
  { value: 'none', label: '关闭', desc: '不发送推理参数（对齐 Hermes Off）' },
  { value: 'minimal', label: '极速', desc: '最少推理，响应最快' },
  { value: 'low', label: '低', desc: '轻量推理，快速回答' },
  { value: 'medium', label: '标准', desc: '均衡推理，适合多数提示' },
  { value: 'high', label: '高', desc: '深度推理，适合复杂任务' },
  { value: 'xhigh', label: '极致', desc: '最大推理深度（模型支持时）' },
] as const;

type Effort = (typeof EFFORTS)[number]['value'];

/** 后端配置键（对应 eleve-config agent.reasoning_effort） */
const CONFIG_KEY = 'agent.reasoning_effort';

/**
 * 思考深度 — 对齐 Hermes reasoning_effort
 *
 * 按钮（图标+当前档位+箭头）+ 下拉六档选择，每档带说明、选中打勾。
 * 选中后 config.set 持久化（内存+磁盘，立即生效）；挂载时读回已存档位。
 */
export default function ThinkingButton() {
  // Hermes normalizeEffort 语义：空/未知 → medium
  const [effort, setEffort] = useState<Effort>('medium');

  // 挂载时读回已持久化的档位（防御性：任何异常/未知值都回退 Hermes 默认 medium）
  useEffect(() => {
    getWsClient()
      .configGet(CONFIG_KEY)
      .then((res) => {
        const v = res?.value;
        if (typeof v === 'string' && EFFORTS.some((e) => e.value === v)) {
          setEffort(v as Effort);
        } else {
          // 空/旧值 ''(自动)/未知 → Hermes unset → medium
          setEffort('medium');
        }
      })
      .catch(() => {});
  }, []);

  const handleSelect = useCallback((value: Effort) => {
    setEffort(value);
    getWsClient().configSet(CONFIG_KEY, value).catch((err) => {
      console.warn('[ThinkingButton] config.set failed:', err);
    });
  }, []);

  const current = EFFORTS.find((e) => e.value === effort);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'group inline-flex h-(--composer-control-size) shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 outline-none transition-colors',
            'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
          title={`思考深度：${current?.label}（点击切换）`}
          aria-label="思考深度"
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
        {EFFORTS.map((e) => {
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
