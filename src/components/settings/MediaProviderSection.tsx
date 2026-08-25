import { useEffect, useState, useCallback } from 'react';
import { ChevronDown, KeyRound, X } from 'lucide-react';
import { Switch } from '../ui/switch';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '../ui/dialog';

/**
 * MediaProviderSection — 媒体生成服务商（生图 / 生视频，分域选择）
 *
 * 架构（2026-08-20 服务商统一视图 + 底层分域隔离）：
 * - 数据源：WS providers.directory（聚合 LLM 池 + 生图 + 生视频 三源，只读）
 * - 只展示 image / video 域服务商（与上方 LLM 聊天服务商卡片墙物理分区）
 * - 选择：WS media.provider.select 分域写入 config（image_gen.provider / video_gen.provider）
 * - available 标记 = 凭据是否就绪（key 配在 ELEVE 侧，前端零密钥）
 *
 * 🔴 ELEVE 媒体生成卡片弹窗（2026-08-20 用户要求，MXAPI 官网 api-guide 对齐）：
 * 点击卡片 → Dialog 弹窗，包含：
 * 1. **API Key 输入**：MXAPI_API_KEY 保存到 ELEVE（HTTP /v1/media/credentials，
 *    与画布 ApiSettingsModal 同端点同契约，key 存 profile .env，只回 masked）
 * 2. **引擎**：生图 / 生视频「设为引擎」（WS media.provider.select）
 * 3. **MXAPI 模型分类预设**：图片 / 视频 / 音乐 三大类，组内按通道子分组；
 *    implemented=true 可点选（写 image_gen.mxapi.model），false 灰显「待接入」
 * 4. **设置**：X-Channel 通道（default/premium）→ config.set 单键写入
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
  const [mxModel, setMxModel] = useState('nano');
  const [mxChannel, setMxChannel] = useState('default');
  // 🔴 2026-08-24：扩图模型（image_gen.mxapi.outpaint_model，默认 gpt-image-2）
  const [mxOutpaintModel, setMxOutpaintModel] = useState('gpt-image-2');
  // 🔴 2026-08-25：图床开关（image_gen.image_host.enabled，默认开——链路1
  // 图床→公网 URL→原生 /v2 异步，快；关闭 → 强制链路3 edits）
  const [mxImageHostEnabled, setMxImageHostEnabled] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingSaving, setSettingSaving] = useState(false);

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

  // 弹窗打开时：加载凭据状态 + mxapi 子配置（每次打开都刷新，避免读陈旧配置）
  useEffect(() => {
    if (!dialogOpen) return;
    // 🔴 2026-08-24：重开弹窗重置 settingsLoaded → 重新从 config 读取
    //（此前 settingsLoaded 只加载一次，dialog 重开读陈旧值）
    setSettingsLoaded(false);
    setKeyDraft('');
    void loadCreds();
    let cancelled = false;
    (async () => {
      const model = await getMediaConfigValue('image_gen.mxapi.model');
      const channel = await getMediaConfigValue('image_gen.mxapi.channel');
      const outpaint = await getMediaConfigValue('image_gen.mxapi.outpaint_model');
      const hostEnabled = await getMediaConfigValue('image_gen.image_host.enabled');
      if (cancelled) return;
      if (typeof model === 'string' && model) setMxModel(model);
      if (typeof channel === 'string' && channel) setMxChannel(channel);
      if (typeof outpaint === 'string' && outpaint) setMxOutpaintModel(outpaint);
      if (typeof hostEnabled === 'boolean') setMxImageHostEnabled(hostEnabled);
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
      setError(e?.message || '解除 API Key 失败');
    } finally {
      setRemovingKey(false);
    }
  };

  const pickMxModel = async (modelId: string) => {
    setSettingSaving(true);
    setError(null);
    try {
      await setMediaConfigValue('image_gen.mxapi.model', modelId);
      setMxModel(modelId);
    } catch (e: any) {
      setError(e?.message || '保存模型失败');
    } finally {
      setSettingSaving(false);
    }
  };

  const saveMxSettings = async () => {
    setSettingSaving(true);
    setError(null);
    try {
      await setMediaConfigValue('image_gen.mxapi.channel', mxChannel);
      // 🔴 2026-08-24：扩图模型一并保存（image_gen.mxapi.outpaint_model）
      await setMediaConfigValue('image_gen.mxapi.outpaint_model', mxOutpaintModel);
      // 🔴 2026-08-25：图床开关一并保存（image_gen.image_host.enabled）
      await setMediaConfigValue('image_gen.image_host.enabled', mxImageHostEnabled);
      setSettingsLoaded(true);
    } catch (e: any) {
      setError(e?.message || '保存 ELEVE 媒体生成设置失败');
    } finally {
      setSettingSaving(false);
    }
  };

  const mediaProviders = (dir?.providers || []).filter(
    (p) => p.domains.image.length > 0 || p.domains.video.length > 0,
  );
  const eleveProvider = mediaProviders.find((p) => p.id === 'eleve') || null;
  const mxapiStatus = credStatus['mxapi'];

  // ── 弹窗内渲染：引擎（生图/生视频 设为引擎）──
  const renderEngineRow = (
    usage: 'image' | 'video',
    label: string,
    models: DirectoryProviderEntry['domains']['image'],
  ) => {
    if (!eleveProvider) return null;
    if (models.length === 0) return null;
    const isCurrent = (dir?.current as any)?.[usage] === 'eleve';
    const available = models[0]?.available ?? false;
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2">
        <div className="min-w-0">
          <div className="text-xs font-medium">{label}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {available ? 'ELEVE 媒体生成 key 已配置' : '未配置 key — 先在上方保存 API Key'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void pick(usage, eleveProvider.id)}
          disabled={saving !== null}
          className={`shrink-0 px-2.5 py-1 rounded-md text-[11px] border transition-colors disabled:opacity-50 ${
            isCurrent
              ? 'bg-primary/10 text-primary border-primary/30'
              : 'border-border text-muted-foreground hover:bg-accent/40'
          }`}
        >
          {saving === `${usage}:eleve` ? '保存中…' : isCurrent ? '当前引擎' : '设为引擎'}
        </button>
      </div>
    );
  };

  // ── 弹窗内渲染：MXAPI 模型分类预设 ──
  const renderMxapiChannels = () => {
    const channels = eleveProvider?.mxapi?.channels || [];
    if (channels.length === 0) return null;
    const categories = ['图片', '视频', '音乐'];
    return (
      <div className="space-y-3">
        {categories.map((cat) => {
          const catGroups = channels.filter((g) => g.category === cat);
          if (catGroups.length === 0) return null;
          const all = catGroups.flatMap((g) => g.models);
          const implementedCount = all.filter((m) => m.implemented).length;
          return (
            <div key={cat} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] px-2 py-0.5 rounded-md bg-primary/10 text-primary font-semibold">{cat}</span>
                <span className="text-[10px] text-muted-foreground/60">
                  {implementedCount} 个已实现 / {all.length} 个通道
                </span>
              </div>
              {catGroups.map((g) => (
                <div key={g.group} className="space-y-1">
                  <div className="text-[10px] text-muted-foreground">{g.group}</div>
                  <div className="flex flex-wrap gap-1">
                    {g.models.map((m) => {
                      const active = mxModel === m.id;
                      const implemented = m.implemented;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          disabled={!implemented || settingSaving}
                          onClick={() => void pickMxModel(m.id)}
                          title={implemented ? `${m.display} — ${m.apiPath}` : `${m.display}（后端待接入）— ${m.apiPath}`}
                          className={`text-[10px] px-2 py-1 rounded-md border transition-colors ${
                            active && implemented
                              ? 'border-primary bg-primary/10 text-primary font-medium'
                              : implemented
                                ? 'border-border text-foreground hover:bg-accent/40 cursor-pointer'
                                : 'border-border/40 text-muted-foreground/50 line-through decoration-muted-foreground/40 cursor-not-allowed'
                          }`}
                        >
                          {m.display}
                          {!implemented && <span className="ml-1 no-underline">待接入</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
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
          与聊天服务商分域隔离；「未配 key」= 需在卡片弹窗内保存 ELEVE 媒体生成 API Key
        </span>
      </div>

      {error && <p className="text-[11px] text-destructive">{error}</p>}
      {loading && <p className="text-[11px] text-muted-foreground">加载中…</p>}
      {!loading && mediaProviders.length === 0 && (
        <p className="text-[11px] text-muted-foreground">暂无媒体服务商</p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {mediaProviders.map((p) => {
          const available = p.domains.image[0]?.available ?? false;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => { setDialogOpen(true); setError(null); }}
              className="rounded-xl border border-border bg-card p-3 text-left transition-all hover:border-primary/40 hover:bg-accent/20 cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs font-medium">{p.name}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">{p.id}</span>
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
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
                  <KeyRound size={11} /> 配置与分类
                  <ChevronDown size={13} className="text-muted-foreground" />
                </span>
              </div>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {/* 🔴 2026-08-24：5 个官方模型全部展示（此前 slice(0,3) 漏掉 nano2-lite/gpt-image-2） */}
                {p.domains.image.map((m) => (
                  <span key={m.id} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground truncate max-w-[12rem]">
                    {m.display || m.id}
                  </span>
                ))}
                {p.domains.video.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">生视频：待接入</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* ═══ ELEVE 媒体生成配置弹窗（2026-08-20：API Key + 引擎 + MXAPI 模型分类 + 设置） ═══ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              ELEVE 媒体生成
              <span className="text-[10px] font-mono text-muted-foreground">eleve · 预设通道</span>
            </DialogTitle>
            <DialogDescription>
              凭据与设置保存在 ELEVE 侧（画布共用）；模型按通道分类预设，标「待接入」的后端尚未实现。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* ── 1. API Key ── */}
            <section className="rounded-xl border border-border/60 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">API Key（MXAPI_API_KEY）</span>
                {mxapiStatus?.configured ? (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-600">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    已配置：{mxapiStatus.masked}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] text-amber-600">
                    <span className="size-1.5 rounded-full bg-amber-500" />
                    未配置
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  className="flex h-8 flex-1 min-w-0 items-center rounded-md border border-input bg-transparent px-2 py-1 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                  // 🔴 2026-08-21：已配置时输入框显示 ******** 占位（key 明文永不下发前端，
                  // 保存后草稿清空 → 占位提示已配置；重新输入即覆盖）
                  placeholder={mxapiStatus?.configured ? '********' : '粘贴 ELEVE 媒体生成 API Key（open.mxapi.org 商户后台创建）'}
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveKey(); }}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => void handleSaveKey()}
                  disabled={savingKey || !keyDraft.trim()}
                  className="shrink-0 h-8 px-3 rounded-md text-[11px] bg-primary text-primary-foreground transition-colors disabled:opacity-50"
                >
                  {savingKey ? '保存中…' : '保存到 ELEVE'}
                </button>
                {mxapiStatus?.configured && (
                  <button
                    type="button"
                    onClick={() => void handleRemoveKey()}
                    disabled={removingKey}
                    className="shrink-0 h-8 px-2.5 rounded-md text-[11px] border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors disabled:opacity-50"
                  >
                    {removingKey ? '解除中…' : '解除'}
                  </button>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground/60">
                key 加密写入 ELEVE profile .env（CredentialScope），画布与桌面端共用；明文永不下发前端。
              </p>
            </section>

            {/* ── 2. 引擎（生图 / 生视频） ── */}
            <section className="space-y-2">
              <span className="text-xs font-medium">引擎</span>
              <div className="grid gap-2 sm:grid-cols-2">
                {renderEngineRow('image', '生图（ELEVE 媒体生成）', eleveProvider?.domains.image || [])}
                {renderEngineRow('video', '生视频（通道待接入）', eleveProvider?.domains.video || [])}
              </div>
            </section>

            {/* ── 3. MXAPI 模型分类预设 ── */}
            <section className="space-y-2">
              <span className="text-xs font-medium">ELEVE 媒体生成模型（分类预设）</span>
              <p className="text-[10px] text-muted-foreground/60 -mt-1.5">
                点击已实现模型即切换生图模型（写入 image_gen.mxapi.model）
              </p>
              {renderMxapiChannels()}
            </section>

            {/* ── 4. 设置（X-Channel + 扩图模型） ── */}
            <section className="rounded-xl border border-border/60 p-3 space-y-2">
              {/* 🔴 2026-08-25 图床开关（链路1：图床→公网 URL→原生 /v2 异步，快；
                  默认开；关闭 → 强制链路3 edits multipart） */}
              <div className="flex items-center justify-between gap-2">
                <div className="grid gap-0.5">
                  <label className="text-[10px] text-foreground">图床（image_gen.image_host.enabled）</label>
                  <p className="text-[10px] text-muted-foreground/60">
                    开启 = 生图/编辑走链路1（ImgBB 图床 + 原生 /v2 异步，快）；关闭 = 强制链路3（/v1 edits）
                  </p>
                </div>
                <Switch
                  checked={mxImageHostEnabled}
                  onCheckedChange={(val: boolean) => setMxImageHostEnabled(val)}
                />
              </div>
              <div className="flex items-end gap-2">
                <div className="grid gap-1 flex-1">
                  <label className="text-[10px] text-muted-foreground">扩图模型（image_gen.mxapi.outpaint_model）</label>
                  <select
                    className="flex h-7 w-full items-center rounded-md border border-input bg-transparent px-2 py-1 text-[11px] text-foreground outline-none"
                    value={mxOutpaintModel}
                    onChange={(e) => setMxOutpaintModel(e.target.value)}
                  >
                    {/* 🔴 2026-08-25 扩图模型收窄：仅 gpt-image-2（唯一底层支持 mask 的模型；
                        NANO 系 Gemini 官方无 mask 能力，实测 nano-pro 扩图 mask 无效效果差） */}
                    <option value="gpt-image-2">gpt-image-2（10 积分，唯一支持 mask 扩图）</option>
                  </select>
                </div>
              </div>
              <div className="flex items-end gap-2">
                <div className="grid gap-1 flex-1">
                  <label className="text-[10px] text-muted-foreground">通道 X-Channel（image_gen.mxapi.channel）</label>
                  <select
                    className="flex h-7 w-full items-center rounded-md border border-input bg-transparent px-2 py-1 text-[11px] text-foreground outline-none"
                    value={mxChannel}
                    onChange={(e) => setMxChannel(e.target.value)}
                  >
                    {/* 🔴 2026-08-24 对齐官方通道：default / default2 / official / openai_official_cheap
                        （删旧 premium——官方文档无此通道）；通道为全局配置，
                        模型不在支持列表时 MXAPI 会自动回落，官方通道标注适用模型 */}
                    <option value="default">default（标准，全部模型）</option>
                    <option value="default2">default2（备用，nano2 / gpt-image-2）</option>
                    <option value="official">official（稳定，nano-pro / nano2 / gpt-image-2）</option>
                    <option value="openai_official_cheap">openai_official_cheap（平价，仅 gpt-image-2）</option>
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
              <p className="text-[10px] text-muted-foreground/60">
                当前生图模型：{mxModel}（nano / nano-pro / nano2 / nano2-lite / gpt-image-2）
              </p>
            </section>
          </div>

          <div className="flex justify-end pt-1">
            <DialogClose asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 h-8 px-4 rounded-md text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors cursor-pointer"
              >
                <X size={13} /> 关闭
              </button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
