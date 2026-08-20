import { useEffect, useState, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  getProvidersDirectory,
  selectMediaProvider,
  getMediaConfigValue,
  setMediaConfigValue,
  type ProvidersDirectoryResponse,
  type DirectoryProviderEntry,
} from '../../utils/settings-store';

/**
 * MediaProviderSection — 媒体生成服务商（生图 / 生视频，分域选择）
 *
 * 架构（2026-08-20 服务商统一视图 + 底层分域隔离）：
 * - 数据源：WS providers.directory（聚合 LLM 池 + 生图 + 生视频 三源，只读）
 * - 只展示 image / video 域服务商（与上方 LLM 聊天服务商卡片墙物理分区）
 * - 同一服务商跨域（如 eleve 同时提供生图+生视频）→ 按域徽标分组展示，各自独立选择
 * - 选择：WS media.provider.select 分域写入 config（image_gen.provider / video_gen.provider）
 * - available 标记 = 凭据是否就绪（key 配在 ELEVE 侧，前端零密钥）
 *
 * 🔴 ELEVE 媒体生成卡片展开（2026-08-20 用户要求，MXAPI 官网 api-guide 对齐）：
 * - 点击卡片头展开：显示 MXAPI 通道分类「能力全览」（MXAPI_CHANNELS：Nano 系列 /
 *   即梦绘图 / 基础·Pro 绘图 / 即梦视频 / Veo 视频 / Suno 音乐，含端点与实现状态，
 *   implemented=false 灰显「待接入」）
 * - 设置区：生图模型（nano/nano-pro/nano2）+ X-Channel 通道（default/premium）→
 *   config.set 单键写入 image_gen.mxapi.model / image_gen.mxapi.channel
 */
export default function MediaProviderSection() {
  const [dir, setDir] = useState<ProvidersDirectoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── 卡片展开 + MXAPI 设置 ──
  const [expanded, setExpanded] = useState(false);
  const [mxModel, setMxModel] = useState('nano');
  const [mxChannel, setMxChannel] = useState('default');
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingSaving, setSettingSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await getProvidersDirectory();
    setDir(d);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 展开时加载当前 mxapi 子配置
  useEffect(() => {
    if (!expanded || settingsLoaded) return;
    let cancelled = false;
    (async () => {
      const model = await getMediaConfigValue('image_gen.mxapi.model');
      const channel = await getMediaConfigValue('image_gen.mxapi.channel');
      if (cancelled) return;
      if (typeof model === 'string' && model) setMxModel(model);
      if (typeof channel === 'string' && channel) setMxChannel(channel);
      setSettingsLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [expanded, settingsLoaded]);

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

  const saveMxSettings = async () => {
    setSettingSaving(true);
    setError(null);
    try {
      await setMediaConfigValue('image_gen.mxapi.model', mxModel);
      await setMediaConfigValue('image_gen.mxapi.channel', mxChannel);
      setSettingsLoaded(true);
    } catch (e: any) {
      setError(e?.message || '保存 MXAPI 设置失败');
    } finally {
      setSettingSaving(false);
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
    // 可用性取首个模型标记（同一 provider 内一致）
    const available = models[0]?.available ?? false;
    return (
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">{label}</span>
            {available ? (
              <span className="flex items-center gap-1 text-[10px] text-emerald-600">
                <span className="size-1.5 rounded-full bg-emerald-500" /> key 已配
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] text-amber-600">
                <span className="size-1.5 rounded-full bg-amber-500" /> 未配 key
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1 mt-0.5">
            {models.slice(0, 3).map((m) => (
              <span key={m.id} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground truncate max-w-[8rem]">
                {/* 无模型目录的 provider → 占位条目（video 域 ELEVE 通道待接入） */}
                {usage === 'video' && m.id === p.id ? '视频通道待接入' : m.display || m.id}
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

  /** MXAPI 能力分类全览（implemented=false → 灰显「待接入」） */
  const renderMxapiChannels = (p: DirectoryProviderEntry) => {
    const channels = p.mxapi?.channels || [];
    if (channels.length === 0) return null;
    return (
      <div className="space-y-2">
        <div className="text-[11px] font-medium text-foreground">MXAPI 通道分类（能力全览）</div>
        {channels.map((g) => (
          <div key={g.group}>
            <div className="text-[10px] text-muted-foreground">{g.group}</div>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {g.models.map((m) => (
                <span
                  key={m.id}
                  title={`${m.display} — ${m.apiPath}${m.implemented ? '' : '（后端待接入）'}`}
                  className={`text-[10px] px-1.5 py-0.5 rounded truncate max-w-[11rem] ${
                    m.implemented
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted/60 text-muted-foreground/60 line-through decoration-muted-foreground/40'
                  }`}
                >
                  {m.display}
                  {!m.implemented && <span className="ml-1 no-underline">待接入</span>}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  /** MXAPI 设置区（生图模型 + X-Channel 通道 → config.set 单键写入） */
  const renderMxapiSettings = () => {
    return (
      <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end border-t border-border pt-2.5">
        <div className="grid gap-1">
          <label className="text-[10px] text-muted-foreground">生图模型（image_gen.mxapi.model）</label>
          <select
            className="flex h-7 w-full items-center rounded-md border border-input bg-transparent px-2 py-1 text-[11px] text-foreground outline-none"
            value={mxModel}
            onChange={(e) => setMxModel(e.target.value)}
          >
            <option value="nano">nano — Nano (gemini-2.5-flash)</option>
            <option value="nano-pro">nano-pro — Nano Pro (gemini-3-pro)</option>
            <option value="nano2">nano2 — Nano2 (gemini-3.1-flash)</option>
          </select>
        </div>
        <div className="grid gap-1">
          <label className="text-[10px] text-muted-foreground">通道 X-Channel（image_gen.mxapi.channel）</label>
          <select
            className="flex h-7 w-full items-center rounded-md border border-input bg-transparent px-2 py-1 text-[11px] text-foreground outline-none"
            value={mxChannel}
            onChange={(e) => setMxChannel(e.target.value)}
          >
            <option value="default">default（默认通道）</option>
            <option value="premium">premium（优质通道）</option>
          </select>
        </div>
        <button
          type="button"
          onClick={() => void saveMxSettings()}
          disabled={settingSaving}
          className="shrink-0 h-7 px-3 rounded-md text-[11px] border border-primary/30 text-primary bg-primary/10 transition-colors disabled:opacity-50"
        >
          {settingSaving ? '保存中…' : '保存设置'}
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
          与聊天服务商分域隔离；「未配 key」= 需在画布 API 设置保存 MXAPI API Key
        </span>
      </div>

      {error && <p className="text-[11px] text-destructive">{error}</p>}
      {loading && <p className="text-[11px] text-muted-foreground">加载中…</p>}
      {!loading && mediaProviders.length === 0 && (
        <p className="text-[11px] text-muted-foreground">暂无媒体服务商</p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {mediaProviders.map((p) => (
          <div
            key={p.id}
            className={`rounded-xl border border-border bg-card p-3 space-y-2 transition-all ${expanded ? 'sm:col-span-2' : ''}`}
          >
            {/* 卡片头：点击展开/收起 */}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="w-full flex items-center justify-between gap-2 cursor-pointer"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs font-medium">{p.name}</span>
                <span className="text-[10px] font-mono text-muted-foreground">{p.id}</span>
                {p.mxapi && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    点击查看 MXAPI 设置与分类
                  </span>
                )}
              </div>
              <ChevronDown
                size={15}
                className={`shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
              />
            </button>

            {renderDomain(p, 'image', '生图', p.domains.image, dir?.current?.image || '')}
            {renderDomain(p, 'video', '生视频', p.domains.video, dir?.current?.video || '')}

            {/* 展开区：MXAPI 能力分类 + 设置 */}
            {expanded && (
              <div className="space-y-2.5 pt-1">
                {renderMxapiChannels(p)}
                {renderMxapiSettings()}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
