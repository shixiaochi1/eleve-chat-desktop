import { useEffect, useState, useCallback } from 'react';
import {
  getProvidersDirectory,
  selectMediaProvider,
  type ProvidersDirectoryResponse,
  type DirectoryProviderEntry,
} from '../../utils/settings-store';

/**
 * MediaProviderSection — 媒体生成服务商（生图 / 生视频，分域选择）
 *
 * 架构（2026-08-20 服务商统一视图 + 底层分域隔离）：
 * - 数据源：WS providers.directory（聚合 LLM 池 + 生图 + 生视频 三源，只读）
 * - 只展示 image / video 域服务商（与上方 LLM 聊天服务商卡片墙物理分区）
 * - 同一服务商跨域（如 xai 同时提供生图+生视频）→ 按域徽标分组展示，各自独立选择
 * - 选择：WS media.provider.select 分域写入 config（image_gen.provider / video_gen.provider）
 * - available 标记 = 凭据是否就绪（key 配在 ELEVE 侧，前端零密钥）
 */
export default function MediaProviderSection() {
  const [dir, setDir] = useState<ProvidersDirectoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await getProvidersDirectory();
    setDir(d);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pick = async (usage: 'image' | 'video', provider: string) => {
    setSaving(`${usage}:${provider}`);
    setError(null);
    try {
      await selectMediaProvider(usage, provider);
      await load();
    } catch (e: any) {
      setError(e?.message || '选择失败');
    } finally {
      setSaving(null);
    }
  };

  const mediaProviders = (dir?.providers || []).filter(
    (p) => p.domains.image.length > 0 || p.domains.video.length > 0,
  );

  const renderDomain = (
    p: DirectoryProviderEntry,
    usage: 'image' | 'video',
    label: string,
    models: DirectoryProviderEntry['domains']['image'],
    current: string,
  ) => {
    if (models.length === 0) return null;
    const isCurrent = current === p.id;
    return (
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[10px] text-muted-foreground">{label}</span>
          <div className="flex flex-wrap gap-1 mt-0.5">
            {models.slice(0, 3).map((m) => (
              <span key={m.id} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground truncate max-w-[8rem]">
                {m.display || m.id}
              </span>
            ))}
            {models.length > 3 && (
              <span className="text-[10px] text-muted-foreground">+{models.length - 3}</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => pick(usage, p.id)}
          disabled={saving !== null}
          className={`shrink-0 px-2 py-1 rounded-md text-[11px] border transition-colors disabled:opacity-50 ${
            isCurrent
              ? 'bg-primary/10 text-primary border-primary/30'
              : 'border-border text-muted-foreground hover:bg-accent/40'
          }`}
        >
          {saving === `${usage}:${p.id}` ? '保存中…' : isCurrent ? '当前引擎' : '设为引擎'}
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-2.5 pt-5 mt-2 border-t border-border">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-foreground">媒体生成（生图 / 生视频）</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
          {mediaProviders.length} 家
        </span>
        <span className="text-[10px] text-muted-foreground">
          与聊天服务商分域隔离；未标「可用」= 需在画布 API 设置保存 key
        </span>
      </div>

      {error && <p className="text-[11px] text-destructive">{error}</p>}
      {loading && <p className="text-[11px] text-muted-foreground">加载中…</p>}
      {!loading && mediaProviders.length === 0 && (
        <p className="text-[11px] text-muted-foreground">暂无媒体服务商</p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {mediaProviders.map((p) => (
          <div key={p.id} className="rounded-xl border border-border bg-card p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">{p.name}</span>
              <span className="text-[10px] font-mono text-muted-foreground">{p.id}</span>
            </div>
            {renderDomain(p, 'image', '生图', p.domains.image, dir?.current?.image || '')}
            {renderDomain(p, 'video', '生视频', p.domains.video, dir?.current?.video || '')}
          </div>
        ))}
      </div>
    </div>
  );
}
