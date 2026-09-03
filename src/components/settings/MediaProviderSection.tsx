import { useEffect, useState, useCallback } from 'react';
import { ChevronDown, KeyRound, X, Zap, SlidersHorizontal, Image as ImageIcon } from 'lucide-react';
import { Switch } from '../ui/switch';
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
import { SectionCard, SettingRow, SettingField } from './SettingBlocks';
import { selectCls } from '@/lib/ui-styles';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '../ui/dialog';

/** 媒体分类语义色点（与 ModelSettings 媒体生成 Tab 分类一致，跟随主题 accent 色） */
const CATEGORY_DOT: Record<string, string> = {
  图片: 'bg-accent-cyan',
  视频: 'bg-accent-purple',
  音乐: 'bg-accent-pink',
};

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
 *    🔴 2026-09-03 收敛为只读能力全览（当前生效模型高亮，分域 current）——
 *    模型选择唯一入口在「设置 → 模型 → 媒体生成」，消除两页重叠双写
 * 4. **设置**：X-Channel 通道（default/premium）→ config.set 单键写入
 *
 * 2026-08-31 弹窗 UI 重构：统一 SettingBlocks 卡片语言（图标 chip 分区头 +
 * 13px 标签层级 + 统一控件），消灭 10/11/12px 混排与样式漂移。
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
      <SettingRow
        key={usage}
        label={label}
        desc={available ? 'ELEVE 媒体生成 key 已配置' : '未配置 key — 先在上方保存 API Key'}
      >
        <button
          type="button"
          onClick={() => void pick(usage, eleveProvider.id)}
          disabled={saving !== null}
          className={`shrink-0 h-7 px-2.5 rounded-md text-[11px] border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
            isCurrent
              ? 'border-primary/60 bg-primary/10 font-medium text-primary'
              : 'border-[var(--ui-stroke-tertiary)] text-muted-foreground hover:bg-accent/40 hover:text-foreground'
          }`}
        >
          {saving === `${usage}:eleve` ? '保存中…' : isCurrent ? '当前引擎' : '设为引擎'}
        </button>
      </SettingRow>
    );
  };

  // ── 弹窗内渲染：MXAPI 模型分类预设（🔴 2026-09-03 收敛为只读能力全览——
  // 模型选择唯一入口在「设置 → 模型 → 媒体生成」，消除两页重叠双写入口）──
  const renderMxapiChannels = () => {
    const channels = eleveProvider?.mxapi?.channels || [];
    if (channels.length === 0) return null;
    const categories = ['图片', '视频', '音乐'];
    const currentImage = ((dir?.current as any)?.image_model as string) || '';
    const currentVideo = ((dir?.current as any)?.video_model as string) || '';
    return (
      <div className="space-y-4">
        {categories.map((cat) => {
          const catGroups = channels.filter((g) => g.category === cat);
          if (catGroups.length === 0) return null;
          const all = catGroups.flatMap((g) => g.models);
          const implementedCount = all.filter((m) => m.implemented).length;
          return (
            <div key={cat} className="space-y-2">
              {/* 分类头：语义色点 + 名称 + 统计（与模型页媒体生成 Tab 同语言） */}
              <div className="flex items-center gap-2">
                <span className={`size-1.5 shrink-0 rounded-full ${CATEGORY_DOT[cat] || 'bg-muted-foreground'}`} />
                <span className="text-xs font-semibold text-foreground">{cat}</span>
                <span className="text-[10px] text-muted-foreground/60">
                  {implementedCount} 个已实现 / {all.length} 个通道
                </span>
              </div>
              {catGroups.map((g) => (
                <div key={g.group} className="space-y-1.5">
                  <div className="text-[10px] font-medium text-muted-foreground">{g.group}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {g.models.map((m) => {
                      const active = m.implemented && (cat === '视频' ? currentVideo === m.id : currentImage === m.id);
                      return (
                        <span
                          key={m.id}
                          title={m.implemented ? `${m.display} — ${m.apiPath}` : `${m.display}（后端待接入）— ${m.apiPath}`}
                          className={`inline-flex items-center h-7 px-2.5 rounded-md border text-[11px] ${
                            active
                              ? 'border-primary/60 bg-primary/10 font-medium text-primary'
                              : m.implemented
                                ? 'border-[var(--ui-stroke-tertiary)] text-foreground'
                                : 'border-[var(--ui-stroke-quaternary)] text-muted-foreground/50 line-through decoration-muted-foreground/40'
                          }`}
                        >
                          {m.display}
                          {!m.implemented && <span className="ml-1 no-underline">待接入</span>}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
        <p className="text-[10px] text-muted-foreground/60">
          模型选择请前往「设置 → 模型 → 媒体生成」（本页为连接与引擎配置，能力全览只读展示）
        </p>
      </div>
    );
  };

  return (
    <div className="space-y-2.5 pt-5 mt-2 border-t border-[var(--ui-stroke-quaternary)]">
      {/* 分区标题 */}
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-foreground">媒体生成（生图 / 生视频）</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
          {mediaProviders.length} 家
        </span>
        <span className="text-[10px] text-muted-foreground truncate">
          与聊天服务商分域隔离；「未配 key」= 需在卡片弹窗内保存 ELEVE 媒体生成 API Key
        </span>
      </div>

      {error && <p className="text-[11px] text-destructive">{error}</p>}
      {loading && <p className="text-[11px] text-muted-foreground">加载中…</p>}
      {!loading && mediaProviders.length === 0 && (
        <p className="text-[11px] text-muted-foreground">暂无媒体服务商</p>
      )}

      {/* 服务商卡片墙（与上方 LLM 服务商卡片同语言：图标块 + 名称 + 状态徽章 + 模型徽章） */}
      <div className="grid gap-2.5 sm:grid-cols-2">
        {mediaProviders.map((p) => {
          const available = p.domains.image[0]?.available ?? false;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => { setDialogOpen(true); setError(null); }}
              className="group rounded-xl border border-[var(--ui-stroke-tertiary)] bg-card shadow-xs p-3.5 text-left transition-colors hover:border-primary/40 hover:bg-accent/20 cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  {/* 媒体域图标块 */}
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-purple/10 text-accent-purple">
                    <ImageIcon size={16} strokeWidth={1.8} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-semibold text-foreground truncate">{p.name}</span>
                      {available ? (
                        <span className="flex shrink-0 items-center gap-1 text-[10px] text-success">
                          <span className="size-1.5 rounded-full bg-success" /> key 已配
                        </span>
                      ) : (
                        <span className="flex shrink-0 items-center gap-1 text-[10px] text-warning">
                          <span className="size-1.5 rounded-full bg-warning" /> 未配 key
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground/60 truncate">{p.id}</div>
                  </div>
                </div>
                <ChevronDown size={14} className="shrink-0 text-muted-foreground transition-transform group-hover:translate-y-0.5" />
              </div>
              <div className="flex flex-wrap gap-1 mt-2.5">
                {/* 🔴 2026-08-24：5 个官方模型全部展示（此前 slice(0,3) 漏掉 nano2-lite/gpt-image-2） */}
                {p.domains.image.map((m) => (
                  <span key={m.id} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground truncate max-w-[12rem]">
                    {m.display || m.id}
                  </span>
                ))}
                {/* 🔴 2026-09-03 即梦视频已接通：video 域模型与 image 域同款 chip 渲染
                    （此前写死「生视频：待接入」——08-20 通道预留期占位未拆） */}
                {p.domains.video.map((m) => (
                  <span key={m.id} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground truncate max-w-[12rem]">
                    {m.display || m.id}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* ═══ ELEVE 媒体生成配置弹窗（API Key + 引擎 + 模型分类 + 设置） ═══ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              ELEVE 媒体生成
              <span className="text-[10px] font-mono font-normal text-muted-foreground">eleve · 预设通道</span>
            </DialogTitle>
            <DialogDescription>
              凭据与设置保存在 ELEVE 侧（画布共用）；模型按通道分类预设，标「待接入」的后端尚未实现。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* ── 1. API Key ── */}
            <SectionCard
              icon={KeyRound}
              title="API Key"
              desc="MXAPI_API_KEY — 加密写入 ELEVE profile .env，画布与桌面端共用，明文永不下发前端"
              headerTrailing={
                mxapiStatus?.configured ? (
                  <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                    <span className="size-1.5 rounded-full bg-success" />
                    已配置 {mxapiStatus.masked}
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
                <div className="flex items-center gap-2">
                  <Input
                    type="password"
                    className="h-8 flex-1 text-xs"
                    // 🔴 2026-08-21：已配置时输入框显示 ******** 占位（key 明文永不下发前端，
                    // 保存后草稿清空 → 占位提示已配置；重新输入即覆盖）
                    placeholder={mxapiStatus?.configured ? '********' : '粘贴 ELEVE 媒体生成 API Key（open.mxapi.org 商户后台创建）'}
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveKey(); }}
                    autoComplete="off"
                  />
                  <Button
                    variant="default"
                    size="sm"
                    className="h-8 shrink-0"
                    onClick={() => void handleSaveKey()}
                    disabled={savingKey || !keyDraft.trim()}
                  >
                    {savingKey ? '保存中…' : '保存到 ELEVE'}
                  </Button>
                  {mxapiStatus?.configured && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0"
                      onClick={() => void handleRemoveKey()}
                      disabled={removingKey}
                    >
                      {removingKey ? '解除中…' : '解除'}
                    </Button>
                  )}
                </div>
              </div>
            </SectionCard>

            {/* ── 2. 引擎（生图 / 生视频） ── */}
            <SectionCard icon={Zap} title="引擎" desc="媒体生成工具实际使用的后端通道">
              {renderEngineRow('image', '生图引擎（ELEVE 媒体生成）', eleveProvider?.domains.image || [])}
              {/* 🔴 2026-09-03 即梦视频已接通，删「通道待接入」占位文案 */}
              {renderEngineRow('video', '生视频引擎（ELEVE 媒体生成）', eleveProvider?.domains.video || [])}
            </SectionCard>

            {/* ── 3. 模型分类预设（只读能力全览；选择入口在 模型→媒体生成） ── */}
            <SectionCard
              icon={ImageIcon}
              title="生成模型"
              desc="通道能力全览（只读）；切换模型请前往「设置 → 模型 → 媒体生成」"
            >
              <div className="px-4 py-3.5">
                {renderMxapiChannels()}
              </div>
            </SectionCard>

            {/* ── 4. 设置（图床 + 扩图模型 + X-Channel） ── */}
            <SectionCard icon={SlidersHorizontal} title="设置" desc="链路与通道参数">
              {/* 🔴 2026-08-25 图床开关（链路1：图床→公网 URL→原生 /v2 异步，快；
                  默认开；关闭 → 强制链路3 edits multipart） */}
              <SettingRow
                label="图床（image_gen.image_host.enabled）"
                desc="开启 = 生图/编辑走链路1（ImgBB 图床 + 原生 /v2 异步，快）；关闭 = 强制链路3（/v1 edits）"
              >
                <Switch
                  checked={mxImageHostEnabled}
                  onCheckedChange={(val: boolean) => setMxImageHostEnabled(val)}
                />
              </SettingRow>
              <SettingField label="扩图模型（image_gen.mxapi.outpaint_model）">
                <select
                  className={selectCls}
                  value={mxOutpaintModel}
                  onChange={(e) => setMxOutpaintModel(e.target.value)}
                >
                  {/* 🔴 2026-08-25 扩图模型收窄：仅 gpt-image-2（唯一底层支持 mask 的模型；
                      NANO 系 Gemini 官方无 mask 能力，实测 nano-pro 扩图 mask 无效效果差） */}
                  <option value="gpt-image-2">gpt-image-2（10 积分，唯一支持 mask 扩图）</option>
                </select>
              </SettingField>
              <SettingField label="通道 X-Channel（image_gen.mxapi.channel）">
                <select
                  className={selectCls}
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
              </SettingField>
            </SectionCard>
          </div>

          {/* 底部操作：当前模型状态（分域） + 保存设置 + 关闭 */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">
              当前生图模型：<span className="font-medium text-foreground">{((dir?.current as any)?.image_model as string) || mxModel || 'nano'}</span>
              <span className="mx-1.5 text-muted-foreground/40">·</span>
              当前生视频模型：<span className="font-medium text-foreground">{((dir?.current as any)?.video_model as string) || '（引擎默认）'}</span>
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={() => void saveMxSettings()}
                disabled={settingSaving}
              >
                {settingSaving ? '保存中…' : '保存设置'}
              </Button>
              <DialogClose asChild>
                <Button variant="outline" size="sm">
                  <X size={13} /> 关闭
                </Button>
              </DialogClose>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
