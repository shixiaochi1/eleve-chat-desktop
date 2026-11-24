import { useEffect, useState, useCallback } from 'react';
import { ChevronRight, KeyRound, Zap, SlidersHorizontal, Image as ImageIcon } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  getProvidersDirectory,
  selectMediaProvider,
  getMediaConfigValue,
  setMediaConfigValue,
  getMediaCredentials,
  saveMediaCredential,
  removeMediaCredential,
  type ProvidersDirectoryResponse,
  type DirectoryProviderEntry,
  type MediaCredentialStatus,
} from '../../utils/settings-store';
import { SectionCard, SettingRow } from './SettingBlocks';
import { selectCls } from '@/lib/ui-styles';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';

/**
 * 媒体服务商连接与生成参数。
 * 模型选择统一在「模型 → 媒体生成」；这里不重复展示模型目录。
 * 图床由生图方式推导：异步开启、同步关闭，避免两个控件写入冲突配置。
 */
export default function MediaProviderSection() {
  const [dir, setDir] = useState<ProvidersDirectoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── 弹窗 + MXAPI 设置 ──
  const [dialogOpen, setDialogOpen] = useState(false);
  const [credStatus, setCredStatus] = useState<Record<string, MediaCredentialStatus>>({});
  const [keyDraft, setKeyDraft] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [removingKey, setRemovingKey] = useState(false);
  const [mxChannel, setMxChannel] = useState('default');
  const [mxLinkMode, setMxLinkMode] = useState('sync');
  const [mxTier, setMxTier] = useState('AUTO');
  const [mxQuality, setMxQuality] = useState('medium');
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingSaving, setSettingSaving] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await getProvidersDirectory();
    setDir(d);
    setLoading(false);
  }, []);

  const loadCreds = useCallback(async () => {
    const list = await getMediaCredentials();
    const map: Record<string, MediaCredentialStatus> = {};
    for (const p of list) map[p.id] = p;
    setCredStatus(map);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 每次打开都重新读取，加载完成前禁止编辑，避免旧值覆盖新配置。
  useEffect(() => {
    if (!dialogOpen) return;
    setSettingsLoaded(false);
    setSettingsSaved(false);
    setKeyDraft('');
    setMxChannel('default');
    setMxLinkMode('sync');
    setMxTier('AUTO');
    setMxQuality('medium');
    void loadCreds();
    let cancelled = false;
    (async () => {
      const [channel, hostEnabled, linkMode, tier, quality] = await Promise.all([
        getMediaConfigValue('image_gen.mxapi.channel'),
        getMediaConfigValue('image_gen.image_host.enabled'),
        getMediaConfigValue('image_gen.mode'),
        getMediaConfigValue('image_gen.tier'),
        getMediaConfigValue('image_gen.quality'),
      ]);
      if (cancelled) return;
      if (typeof channel === 'string' && channel) setMxChannel(channel);
      if (linkMode === 'sync' || hostEnabled === false) setMxLinkMode('sync');
      else if (linkMode === 'async') setMxLinkMode('async');
      if (typeof tier === 'string' && ['AUTO', '1K', '2K', '4K'].includes(tier)) setMxTier(tier);
      if (typeof quality === 'string' && ['low', 'medium', 'high', 'auto'].includes(quality)) setMxQuality(quality);
      setSettingsLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [dialogOpen, loadCreds]);

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

  const handleSaveKey = async () => {
    const key = keyDraft.trim();
    if (!key) return;
    setSavingKey(true);
    setError(null);
    try {
      await saveMediaCredential('mxapi', key);
      setKeyDraft('');
      await loadCreds();
      await load(); // 刷新 available 标记
    } catch (e: any) {
      setError(e?.message || '保存 API Key 失败（请确认 ELEVE 服务已启动）');
    } finally {
      setSavingKey(false);
    }
  };

  const handleRemoveKey = async () => {
    setRemovingKey(true);
    setError(null);
    try {
      await removeMediaCredential('mxapi');
      await loadCreds();
      await load();
    } catch (e: any) {
      setError(e?.message || '移除 API Key 失败');
    } finally {
      setRemovingKey(false);
    }
  };

  const saveMxSettings = async () => {
    setSettingSaving(true);
    setSettingsSaved(false);
    setError(null);
    try {
      await setMediaConfigValue('image_gen.mxapi.channel', mxChannel);
      await setMediaConfigValue('image_gen.mode', mxLinkMode);
      // 图床不再是第二套链路开关：仅异步链路需要它。
      await setMediaConfigValue('image_gen.image_host.enabled', mxLinkMode === 'async');
      await setMediaConfigValue('image_gen.tier', mxTier);
      await setMediaConfigValue('image_gen.quality', mxQuality);
      setSettingsSaved(true);
    } catch (e: any) {
      setError(e?.message || '保存生图参数失败');
    } finally {
      setSettingSaving(false);
    }
  };

  const mediaProviders = (dir?.providers || []).filter(
    (p) => p.domains.image.length > 0 || p.domains.video.length > 0,
  );
  const eleveProvider = mediaProviders.find((p) => p.id === 'eleve') || null;
  const mxapiStatus = credStatus['mxapi'];

  const renderEngineRow = (
    usage: 'image' | 'video',
    label: string,
    models: DirectoryProviderEntry['domains']['image'],
  ) => {
    if (!eleveProvider || models.length === 0) return null;
    const isCurrent = dir?.current?.[usage] === 'eleve';
    const available = models.some((model) => model.available);
    return (
      <SettingRow key={usage} label={label} desc={!available ? '请先配置 API Key' : undefined}>
        <button
          type="button"
          onClick={() => void pick(usage, eleveProvider.id)}
          disabled={saving !== null || isCurrent || !available}
          className={`shrink-0 h-7 px-2.5 rounded-md text-[11px] border transition-colors cursor-pointer disabled:cursor-default disabled:opacity-70 ${
            isCurrent
              ? 'border-primary/60 bg-primary/10 font-medium text-primary'
              : 'border-[var(--ui-stroke-tertiary)] text-muted-foreground hover:bg-accent/40 hover:text-foreground disabled:hover:bg-transparent'
          }`}
        >
          {saving === `${usage}:eleve` ? '保存中…' : isCurrent ? '当前引擎' : '设为引擎'}
        </button>
      </SettingRow>
    );
  };

  return (
    <div className="mt-2 space-y-2.5 border-t border-[var(--ui-stroke-quaternary)] pt-5">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-foreground">媒体生成</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {mediaProviders.length} 家
        </span>
      </div>

      {loading && <p className="text-[11px] text-muted-foreground">加载中…</p>}
      {!loading && mediaProviders.length === 0 && (
        <p className="text-[11px] text-muted-foreground">暂无媒体服务商</p>
      )}

      <div className="grid gap-2.5 sm:grid-cols-2">
        {mediaProviders.map((p) => {
          const available = [...p.domains.image, ...p.domains.video].some((model) => model.available);
          return (
            <button
              key={p.id}
              type="button"
              aria-label={`配置 ${p.name} 媒体生成`}
              onClick={() => { setDialogOpen(true); setError(null); }}
              className="group rounded-xl border border-[var(--ui-stroke-tertiary)] bg-card p-3.5 text-left shadow-xs transition-colors hover:border-primary/40 hover:bg-accent/20 cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-purple/10 text-accent-purple">
                    <ImageIcon size={16} strokeWidth={1.8} />
                  </span>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-foreground">{p.name}</span>
                    <span className={`flex shrink-0 items-center gap-1 text-[10px] ${available ? 'text-success' : 'text-warning'}`}>
                      <span className={`size-1.5 rounded-full ${available ? 'bg-success' : 'bg-warning'}`} />
                      {available ? 'Key 已配置' : 'Key 未配置'}
                    </span>
                  </div>
                </div>
                <ChevronRight size={14} className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <div className="mt-2.5 flex gap-1.5">
                {p.domains.image.length > 0 && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">生图</span>}
                {p.domains.video.length > 0 && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">生视频</span>}
              </div>
            </button>
          );
        })}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setError(null); }}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>ELEVE 媒体生成</DialogTitle>
            <DialogDescription>配置 API Key、生成引擎和生图参数。</DialogDescription>
          </DialogHeader>

          {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

          <div className="space-y-4">
            <SectionCard
              className="mb-0"
              icon={KeyRound}
              title="API Key"
              desc="用于生图和生视频，画布共用。"
              headerTrailing={
                mxapiStatus?.configured ? (
                  <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                    <span className="size-1.5 rounded-full bg-success" />
                    {mxapiStatus.masked}
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                    <span className="size-1.5 rounded-full bg-warning" />
                    未配置
                  </span>
                )
              }
            >
              <div className="px-4 py-3.5">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    type="password"
                    aria-label="MXAPI API Key"
                    className="h-8 min-w-0 flex-1 text-xs"
                    placeholder={mxapiStatus?.configured ? '输入新 Key 以替换' : '输入 MXAPI API Key'}
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveKey(); }}
                    autoComplete="off"
                  />
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      className="h-8"
                      onClick={() => void handleSaveKey()}
                      disabled={savingKey || !keyDraft.trim()}
                    >
                      {savingKey ? '保存中…' : '保存'}
                    </Button>
                    {mxapiStatus?.configured && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => void handleRemoveKey()}
                        disabled={removingKey}
                      >
                        {removingKey ? '移除中…' : '移除'}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard className="mb-0" icon={Zap} title="生成引擎">
              {renderEngineRow('image', '生图', eleveProvider?.domains.image || [])}
              {renderEngineRow('video', '生视频', eleveProvider?.domains.video || [])}
            </SectionCard>

            <SectionCard
              className="mb-0"
              icon={SlidersHorizontal}
              title="生图参数"
              desc="生成模型在「模型 → 媒体生成」中选择。"
            >
              <SettingRow label="生图方式">
                <div className="w-48">
                  <select
                    aria-label="生图方式"
                    className={selectCls}
                    value={mxLinkMode}
                    disabled={!settingsLoaded || settingSaving}
                    onChange={(e) => { setMxLinkMode(e.target.value); setSettingsSaved(false); }}
                  >
                    <option value="sync">同步（尺寸精确）</option>
                    <option value="async">异步（速度优先）</option>
                  </select>
                </div>
              </SettingRow>
              <SettingRow label="通道">
                <div className="w-48">
                  <select
                    aria-label="生图通道"
                    className={selectCls}
                    value={mxChannel}
                    disabled={!settingsLoaded || settingSaving}
                    onChange={(e) => { setMxChannel(e.target.value); setSettingsSaved(false); }}
                  >
                    <option value="default">default（标准）</option>
                    <option value="default2">default2（备用）</option>
                    <option value="official">official（稳定）</option>
                    <option value="openai_official_cheap">openai_official_cheap（平价）</option>
                  </select>
                </div>
              </SettingRow>
              <SettingRow label="分辨率">
                <div className="w-48">
                  <select
                    aria-label="生图分辨率"
                    className={selectCls}
                    value={mxTier}
                    disabled={!settingsLoaded || settingSaving}
                    onChange={(e) => { setMxTier(e.target.value); setSettingsSaved(false); }}
                  >
                    <option value="AUTO">自动</option>
                    <option value="1K">1K</option>
                    <option value="2K">2K</option>
                    <option value="4K">4K</option>
                  </select>
                </div>
              </SettingRow>
              <SettingRow label="质量">
                <div className="w-48">
                  <select
                    aria-label="生图质量"
                    className={selectCls}
                    value={mxQuality}
                    disabled={!settingsLoaded || settingSaving}
                    onChange={(e) => { setMxQuality(e.target.value); setSettingsSaved(false); }}
                  >
                    <option value="low">低（草稿）</option>
                    <option value="medium">标准</option>
                    <option value="high">高（精细）</option>
                    <option value="auto">自动</option>
                  </select>
                </div>
              </SettingRow>
            </SectionCard>
          </div>

          <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t border-[var(--ui-stroke-quaternary)] bg-[var(--ui-chat-bubble-background)] px-4 py-3">
            <span className={`text-xs ${settingsSaved ? 'text-success' : 'text-muted-foreground'}`}>
              {!settingsLoaded ? '正在读取配置…' : settingsSaved ? '已保存' : ''}
            </span>
            <Button
              size="sm"
              onClick={() => void saveMxSettings()}
              disabled={!settingsLoaded || settingSaving}
            >
              {settingSaving ? '保存中…' : '保存参数'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
