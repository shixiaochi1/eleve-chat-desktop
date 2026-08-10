/**
 * 按模型能力门控思考深度（对齐 Hermes mainCaps.reasoning ?? true）
 *
 * 单一权威实现：明确 reasoning=false → unsupported=true（禁用+提示）；
 * 未知/查询失败/未配置 → false（Hermes ?? true 语义：未报告时默认允许）。
 *
 * 消费方：ThinkingButton（主模型）/ 需要单模型查询的场景。
 * 🔴 注意：per-item 批量场景（Aux 卡片、Fallback 行）不用本 hook（map 内不能调 hook），
 * 用 ModelSettings 的 capsCache 合并查询。
 */
import { useEffect, useState } from 'react';
import { lookupModelCapabilities } from '@/utils/settings-store';

export function useModelReasoningSupport(
  provider: string | null | undefined,
  model: string | null | undefined,
): boolean {
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const p = (provider || '').trim();
    const m = (model || '').trim();
    if (!p || !m) {
      setUnsupported(false);
      return;
    }
    lookupModelCapabilities(p, m)
      .then((caps) => {
        if (!cancelled) setUnsupported(caps?.reasoning === false);
      })
      .catch(() => { /* 查询失败 → 不禁用（Hermes ?? true 语义） */ });
    return () => { cancelled = true; };
  }, [provider, model]);

  return unsupported;
}
