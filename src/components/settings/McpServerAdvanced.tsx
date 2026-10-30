/**
 * McpServerAdvanced — 单台 MCP 服务器的高级配置（内联展开）。
 *
 * 这些字段以前只能在 JSON 编辑器里手写 YAML，等于"功能存在但用户无法安全触达"：
 * - `lazy` / `idle_timeout`：决定什么时候连、什么时候回收
 * - `include_tools` / `exclude_tools`：决定这台服务器暴露哪些工具
 * - `sampling` / `elicitation`：**授权服务器借用宿主能力**，语义重、默认关闭
 *
 * 保存策略（细节在 `utils/mcp-server-config.ts`）：
 * 读取**最新**的服务器条目再增量合并，绝不用表单值重建整个对象——`command` /
 * `args` / `env` / `oauth` 这些连接身份字段被表单覆盖掉会直接连不上。
 */
import { useCallback, useMemo, useState } from 'react';
import { Switch } from '../ui/switch';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { SettingsSaveBar } from './SettingBlocks';
import { call } from '../../utils/bridge';
import { notifyError, notifySuccess } from '../../utils/notifications';
import { applyDraft, draftFromEntry, isDraftDirty, DEFAULTS } from '../../utils/mcp-server-config';
import type { AdvancedDraft } from '../../utils/mcp-server-config';

interface Props {
  name: string;
  entry: Record<string, any>;
  onSaved: () => void;
  onCancel: () => void;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <label className="text-[12px] font-medium leading-snug text-foreground">{label}</label>
      {children}
      {hint && <p className="text-[10px] leading-relaxed text-muted-foreground/60">{hint}</p>}
    </div>
  );
}

export default function McpServerAdvanced({ name, entry, onSaved, onCancel }: Props) {
  const [draft, setDraft] = useState<AdvancedDraft>(() => draftFromEntry(entry));
  const [saving, setSaving] = useState(false);

  const patch = useCallback(
    (part: Partial<AdvancedDraft>) => setDraft((prev) => ({ ...prev, ...part })),
    [],
  );

  const dirty = useMemo(() => isDraftDirty(draft, entry), [draft, entry]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // 🔴 用磁盘上的最新值做基底：展开面板期间别处可能改过同一台服务器
      const cfg = await call('get_config', {});
      const all: Record<string, any> = cfg?.mcp_servers || {};
      if (!all[name]) {
        throw new Error(`服务器 "${name}" 已不存在，请刷新列表`);
      }
      const next = applyDraft(all[name], draft);
      await call('replace_config', { sections: { mcp_servers: { ...all, [name]: next } } });
      notifySuccess(`「${name}」高级配置已保存`);
      onSaved();
    } catch (err) {
      notifyError(err, '保存高级配置失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-[var(--ui-stroke-tertiary)] bg-muted/5 px-3.5 py-3">
      {/* 连接行为 */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[12px] font-medium text-foreground">延迟连接（lazy）</div>
          <p className="text-[10px] text-muted-foreground/60">
            启动时只注册缓存里的工具，首次调用才建连。适合启动慢的 stdio 服务器。
          </p>
        </div>
        <Switch checked={draft.lazy} onCheckedChange={(v: boolean) => patch({ lazy: v })} />
      </div>

      <Field
        label="空闲回收（秒）"
        hint="超过该时长无调用则释放连接，下次调用自动重建。留空 = 不回收。"
      >
        <Input
          className="h-8 text-xs"
          value={draft.idleTimeout}
          onChange={(e) => patch({ idleTimeout: e.target.value })}
          placeholder="例如 900"
        />
      </Field>

      {/* 工具过滤 */}
      <Field label="只注册这些工具" hint="逗号分隔，支持 glob。留空 = 不过滤。连接身份字段不会被这里影响。">
        <Input
          className="h-8 text-xs font-mono"
          value={draft.include}
          onChange={(e) => patch({ include: e.target.value })}
          placeholder="read_file, list_*"
        />
      </Field>

      <Field label="排除这些工具" hint="逗号分隔。与上面的白名单同时存在时，先白名单再排除。">
        <Input
          className="h-8 text-xs font-mono"
          value={draft.exclude}
          onChange={(e) => patch({ exclude: e.target.value })}
          placeholder="delete_*, *admin*"
        />
      </Field>

      {/* sampling */}
      <div className="rounded-lg border border-[var(--ui-stroke-tertiary)] px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[12px] font-medium text-foreground">允许 sampling</div>
            <p className="text-[10px] leading-relaxed text-muted-foreground/60">
              服务器可以在工具调用中请你背后的模型生成内容。默认关闭；开启后按次数限额。
            </p>
          </div>
          <Switch
            checked={draft.samplingEnabled}
            onCheckedChange={(v: boolean) => patch({ samplingEnabled: v })}
          />
        </div>

        {draft.samplingEnabled && (
          <div className="mt-2.5 space-y-2">
            <Field label="模型" hint="留空 = 用当前会话模型。">
              <Input
                className="h-8 text-xs"
                value={draft.samplingModel}
                onChange={(e) => patch({ samplingModel: e.target.value })}
                placeholder="例如 gpt-4o-mini"
              />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="次数上限" hint={`默认 ${DEFAULTS.samplingMaxRequests}`}>
                <Input
                  className="h-8 text-xs"
                  value={draft.samplingMaxRequests}
                  onChange={(e) => patch({ samplingMaxRequests: e.target.value })}
                />
              </Field>
              <Field label="最大 token" hint={`默认 ${DEFAULTS.samplingMaxTokens}`}>
                <Input
                  className="h-8 text-xs"
                  value={draft.samplingMaxTokens}
                  onChange={(e) => patch({ samplingMaxTokens: e.target.value })}
                />
              </Field>
              <Field label="超时（秒）" hint={`默认 ${DEFAULTS.samplingTimeout}`}>
                <Input
                  className="h-8 text-xs"
                  value={draft.samplingTimeout}
                  onChange={(e) => patch({ samplingTimeout: e.target.value })}
                />
              </Field>
            </div>
          </div>
        )}
      </div>

      {/* elicitation */}
      <div className="rounded-lg border border-[var(--ui-stroke-tertiary)] px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[12px] font-medium text-foreground">允许 elicitation</div>
            <p className="text-[10px] leading-relaxed text-muted-foreground/60">
              服务器可以请求你确认或提供信息。请求会出现在本页顶部的待办里。
            </p>
          </div>
          <Switch
            checked={draft.elicitationEnabled}
            onCheckedChange={(v: boolean) => patch({ elicitationEnabled: v })}
          />
        </div>

        {draft.elicitationEnabled && (
          <div className="mt-2.5">
            <Field label="等待应答（秒）" hint={`默认 ${DEFAULTS.elicitationTimeout}；超时回 cancel，由服务器决定是否继续。`}>
              <Input
                className="h-8 text-xs"
                value={draft.elicitationTimeout}
                onChange={(e) => patch({ elicitationTimeout: e.target.value })}
              />
            </Field>
          </div>
        )}
      </div>

      <SettingsSaveBar>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          取消
        </Button>
        <Button variant="default" size="sm" onClick={handleSave} disabled={saving || !dirty}>
          保存高级配置
        </Button>
      </SettingsSaveBar>
    </div>
  );
}
