import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  dropdownMenuRow,
  dropdownMenuSectionLabel,
} from './ui/dropdown-menu';
import { Switch } from './ui/switch';
import { ThinkingIcon, CollapseIcon } from './Icons';
import { getWsClient } from '@/services/ws-client';
import {
  DEFAULT_REASONING_EFFORT,
  REASONING_EFFORTS,
  isThinkingEnabled,
  reasoningEffortLabel,
  resolveReasoningEffort,
} from '@/lib/reasoning-efforts';
import {
  sessionEffortFor,
  setFastMode,
  setGlobalReasoning,
  setSessionReasoning,
  useSessionReasoning,
} from '@/store/session-reasoning';
import { useModelContext } from '@/contexts/ModelContext';
import { useModelReasoningSupport } from '@/hooks/useModelReasoningSupport';
import { setModelPreset } from '@/store/model-presets';
import { notifyError } from '@/utils/notifications';

/** 全局配置键（无会话时的写入目标 / 挂载读回） */
const GLOBAL_EFFORT_KEY = 'agent.reasoning_effort';
const FAST_KEY = 'agent.service_tier';
/** 会话级写入键（对齐 Hermes `config.set {key:'reasoning', session_id}`） */
const SESSION_EFFORT_KEY = 'reasoning';

/** 对齐 Hermes isFastTier：fast/priority/on 视为开启 */
const isFastTier = (v: unknown): boolean =>
  typeof v === 'string' && ['fast', 'priority', 'on'].includes(v.trim().toLowerCase());

/** config.get 双形态取值（裸值 / {value} 包裹） */
const configValue = (res: unknown): unknown =>
  typeof res === 'string' ? res : (res as { value?: unknown } | null)?.value;

interface ThinkingButtonProps {
  /** 当前会话 id —— 非空时会话级写入（Hermes 同款作用域） */
  sessionId?: string | null;
}

/**
 * ⚠️ 2026-10-31 已停用：入口迁到模型胶囊的「每行模型 → 齿轮子菜单」
 * （对齐 Hermes 模型菜单形态）。本文件保留备查，InputArea 不再挂载。
 *
 * 思考深度 — 对齐 Hermes `ModelEditSubmenuBody` 的 Options 区
 * （apps/desktop/src/app/shell/model-edit-submenu.tsx L142-176）
 *
 * 结构 = 「思考」开关 + 「快速」开关 + 「推理强度」单选 7 档：
 * - none 不是档位，是思考开关的关闭态（Hermes reasoning-effort.ts 头注）；
 * - 阶梯 minimal → ultra，文案与 Hermes 中文 modelOptions 同款；
 * - 有会话写会话级（key="reasoning"），无会话落全局 agent.reasoning_effort；
 * - 模型无推理能力时显示「当前模型不支持思考模式」（Hermes noOptions 的等价文案，
 *   因为 ELEVE 的「快速」恒可用，照抄原文案会与上方开关自相矛盾）。
 */
export default function ThinkingButton({ sessionId }: ThinkingButtonProps) {
  // 主模型能力门控（对齐 Hermes mainCaps.reasoning ?? true）
  const { currentModel } = useModelContext();
  const ref = (currentModel || '').trim();
  const slash = ref.indexOf('/');
  const reasoningUnsupported = useModelReasoningSupport(
    slash > 0 ? ref.slice(0, slash) : null,
    slash > 0 ? ref.slice(slash + 1) : null,
  );

  // 🔴 单一真相源：会话级档位 + 全局默认 + 快速（store/session-reasoning）。
  //   sessionEffort 必须按**本组件所属会话**取——切会话/新建草稿时旧值不会被误显示。
  const reasoningState = useSessionReasoning();
  const sessionEffort = sessionEffortFor(reasoningState, sessionId);
  const { globalEffort, fast } = reasoningState;
  const rawEffort = sessionEffort || globalEffort || DEFAULT_REASONING_EFFORT;

  // 挂载时读回全局默认 + 快速模式（会话级值由 session.info 权威推送）
  useEffect(() => {
    const ws = getWsClient();
    ws.configGet(GLOBAL_EFFORT_KEY)
      .then((res) => {
        const v = configValue(res);
        setGlobalReasoning(typeof v === 'string' ? v.trim().toLowerCase() : '');
      })
      .catch(() => {});
    ws.configGet(FAST_KEY)
      .then((res) => setFastMode(isFastTier(configValue(res))))
      .catch(() => {});
  }, []);

  const thinkingOn = isThinkingEnabled(rawEffort);
  const activeLevel = resolveReasoningEffort(rawEffort);
  const label = thinkingOn ? reasoningEffortLabel(activeLevel) : reasoningEffortLabel('none');

  const writeEffort = useCallback(
    (value: string) => {
      // 乐观更新（UI 立即反馈；session.info 到达后以权威值为准）
      const previous = sessionId ? sessionEffort : globalEffort;
      if (sessionId) setSessionReasoning(sessionId, value);
      else setGlobalReasoning(value);

      // 记住该模型的选择（对齐 Hermes per-model preset；切回模型时恢复）
      const ref = (currentModel || '').trim();
      const at = ref.indexOf('/');
      if (at > 0) setModelPreset(ref.slice(0, at), ref.slice(at + 1), { effort: value });

      const ws = getWsClient();
      const write = sessionId
        ? ws.configSet(SESSION_EFFORT_KEY, value, sessionId)
        : ws.configSet(GLOBAL_EFFORT_KEY, value);
      write.catch((err) => {
        // 对齐 Hermes patchReasoning 的失败回滚——UI 不能显示一个没生效的档位
        if (sessionId) setSessionReasoning(sessionId, previous);
        else setGlobalReasoning(previous);
        notifyError(err, '思考档位更新失败');
      });
    },
    [sessionId, currentModel, sessionEffort, globalEffort],
  );

  const toggleThinking = useCallback(
    (on: boolean) => {
      // 对齐 Hermes（`effortValue || defaultEffort`）：重新打开时恢复
      // 「当前档位 → 全局默认 → medium」，而不是上一次手选的档位。
      const resume =
        resolveReasoningEffort(rawEffort) ||
        resolveReasoningEffort(globalEffort) ||
        DEFAULT_REASONING_EFFORT;
      writeEffort(on ? resume : 'none');
    },
    [writeEffort, rawEffort, globalEffort],
  );

  const toggleFast = useCallback((on: boolean) => {
    setFastMode(on);
    const ws = getWsClient();
    // 🔴 2026-10-31 per-session fast：有会话写会话级（后端 set_fast_mode →
    //   build_extra_body 逐请求下发）；无会话（草稿）写全局默认。
    const write = sessionId
      ? ws.configSet('fast', on ? 'priority' : 'normal', sessionId)
      // 关闭写 null（清空 service_tier）——写 "normal" 会被透传成非法 wire 值
      : ws.configSet(FAST_KEY, on ? 'priority' : null);
    write.catch((err) => {
      setFastMode(!on); // 失败回滚（对齐 Hermes patchFast）
      notifyError(err, '快速模式更新失败');
    });
  }, [sessionId]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'group inline-flex h-(--composer-control-size) shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 outline-none transition-colors',
            'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
          title={reasoningUnsupported ? '当前模型不支持思考模式，此设置不会生效' : `推理强度：${label}（点击切换）`}
          aria-label="推理强度"
        >
          <ThinkingIcon className="shrink-0" />
          <span className="text-[10px] font-medium">{label}</span>
          <CollapseIcon
            size={10}
            className="shrink-0 opacity-50 transition-transform duration-150 group-data-[state=open]:rotate-180"
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="start" className="w-52">
        {/* 选项区 — 思考（none 由开关持有）+ 快速（对齐 Hermes Options 区） */}
        {!reasoningUnsupported && (
          <DropdownMenuItem
            className={dropdownMenuRow}
            onSelect={(event) => event.preventDefault()}
          >
            <span>思考</span>
            <Switch
              checked={thinkingOn}
              className="ml-auto"
              onCheckedChange={toggleThinking}
              aria-label="思考开关"
            />
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className={dropdownMenuRow}
          onSelect={(event) => event.preventDefault()}
        >
          <span>快速</span>
          <Switch
            checked={fast}
            className="ml-auto"
            onCheckedChange={toggleFast}
            aria-label="快速模式开关"
          />
        </DropdownMenuItem>

        <DropdownMenuSeparator className="mx-0" />

        {reasoningUnsupported ? (
          // 等价 Hermes modelOptions.noOptions（ELEVE 的「快速」恒可用，
          // 原文案会和上方开关自相矛盾 → 明确说推理不可用）
          <div className="px-2.5 py-3 text-xs text-muted-foreground">当前模型不支持思考模式</div>
        ) : (
          <>
            <DropdownMenuLabel className={dropdownMenuSectionLabel}>推理强度</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={activeLevel} onValueChange={writeEffort}>
              {REASONING_EFFORTS.map((e) => (
                <DropdownMenuRadioItem
                  key={e.value}
                  value={e.value}
                  className={dropdownMenuRow}
                  onSelect={(event) => event.preventDefault()}
                  title={e.desc}
                >
                  {e.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
