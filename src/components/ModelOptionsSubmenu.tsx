/**
 * 模型选项子菜单 — 对齐 Hermes `ModelEditSubmenuBody`
 * （apps/desktop/src/app/shell/model-edit-submenu.tsx L142-176）
 *
 * 结构 = 「思考」开关 + 「快速」开关 + 「推理强度」7 档单选。
 * 挂在模型列表每一行的子菜单里（对齐 Hermes 模型行 → 齿轮子菜单的形态）。
 *
 * 只在子菜单展开时挂载（Radix SubContent 的 Presence 门控），因此可以安全地
 * 在组件内按该行模型查推理能力。
 */
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  dropdownMenuRow,
  dropdownMenuSectionLabel,
} from './ui/dropdown-menu';
import { Switch } from './ui/switch';
import {
  DEFAULT_REASONING_EFFORT,
  REASONING_EFFORTS,
  isThinkingEnabled,
  resolveReasoningEffort,
} from '@/lib/reasoning-efforts';
import { useModelReasoningSupport } from '@/hooks/useModelReasoningSupport';

interface ModelOptionsSubmenuProps {
  provider: string;
  modelId: string;
  /** 该行当前档位（活跃行 = 会话生效值；非活跃行 = 该模型 preset 或默认） */
  effort: string;
  /** 该行快速模式 */
  fast: boolean;
  onSetOptions: (patch: { effort?: string; fast?: boolean }) => void;
}

export default function ModelOptionsSubmenu({
  provider,
  modelId,
  effort,
  fast,
  onSetOptions,
}: ModelOptionsSubmenuProps) {
  const reasoningUnsupported = useModelReasoningSupport(provider, modelId);
  const rawEffort = effort || DEFAULT_REASONING_EFFORT;
  const thinkingOn = isThinkingEnabled(rawEffort);
  const activeLevel = resolveReasoningEffort(rawEffort);

  return (
    <>
      {!reasoningUnsupported && (
        <DropdownMenuItem
          className={dropdownMenuRow}
          onSelect={(event) => event.preventDefault()}
        >
          <span>思考</span>
          <Switch
            checked={thinkingOn}
            className="ml-auto"
            onCheckedChange={(on) =>
              onSetOptions({
                effort: on
                  ? resolveReasoningEffort(rawEffort) || DEFAULT_REASONING_EFFORT
                  : 'none',
              })
            }
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
          onCheckedChange={(on) => onSetOptions({ fast: on })}
          aria-label="快速模式开关"
        />
      </DropdownMenuItem>

      <DropdownMenuSeparator className="mx-0" />

      {reasoningUnsupported ? (
        <div className="px-2.5 py-3 text-xs text-muted-foreground">
          当前模型不支持思考模式
        </div>
      ) : (
        <>
          <DropdownMenuLabel className={dropdownMenuSectionLabel}>推理强度</DropdownMenuLabel>
          {/* 🔴 2026-11-02：中文档位里有 4 个"越来越强"的说法（高/极高/最高/超高），
              单看汉字分不清。这里把**线路规范名**（high/xhigh/max/ultra）作为弱化后缀
              显示 —— 它不是内部黑话，而是各家 provider 实际接受的取值
              （对齐 Hermes：`sends X on this route` 用同一套名字）。 */}
          <div className="px-2.5 pb-1 text-[0.625rem] leading-4 text-muted-foreground/70">
            超出模型支持范围的档位会自动下调到最近的可用档
          </div>
          <DropdownMenuRadioGroup
            value={activeLevel}
            // 作用域由父组件决定：活跃行写会话/全局，非活跃行只记忆 preset
            onValueChange={(value) => onSetOptions({ effort: value })}
          >
            {REASONING_EFFORTS.map((e) => (
              <DropdownMenuRadioItem
                key={e.value}
                value={e.value}
                className={dropdownMenuRow}
                onSelect={(event) => event.preventDefault()}
                title={e.desc}
              >
                <span>{e.label}</span>
                <span className="ml-auto font-mono text-[0.625rem] text-muted-foreground/70">
                  {e.value}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </>
      )}
    </>
  );
}
