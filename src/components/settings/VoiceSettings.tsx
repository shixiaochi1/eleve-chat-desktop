import { useEffect, useState } from 'react';
import { call } from '../../utils/bridge';
import { notifySuccess, notifyError } from '../../utils/notifications';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Mic, Volume2, SlidersHorizontal, AlertTriangle } from 'lucide-react';
import { SectionCard, SettingRow, SettingField, SettingsSaveBar } from './SettingBlocks';
import { selectCls } from '@/lib/ui-styles';

/**
 * VoiceSettings — 语音设置
 *
 * 语音转文字 (STT)、文字转语音 (TTS)、自动朗读、录音快捷键
 *
 * 2026-08-31 卡片 UI 重构：裸表单 → 统一 SectionCard 分组卡片（逻辑不变）。
 */
export default function VoiceSettings({ onSaved }: { onSaved?: () => void }) {
  const [config, setConfig] = useState({
    stt_enabled: false,
    stt_provider: 'local',
    stt_local_model: 'base',
    stt_local_language: '',
    tts_provider: 'edge',
    tts_edge_voice: '',
    tts_openai_voice: 'alloy',
    tts_openai_model: '',
    voice_auto_tts: false,
    voice_record_key: '',
    voice_max_recording_seconds: 120,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const bc = await call('get_config', {});
      const stt = bc.stt || {};
      const tts = bc.tts || {};
      const voice = bc.voice || {};

      setConfig({
        stt_enabled: stt.enabled ?? false,
        stt_provider: stt.provider || 'local',
        stt_local_model: stt.local?.model || 'base',
        stt_local_language: stt.local?.language || '',
        tts_provider: tts.provider || 'edge',
        tts_edge_voice: tts.edge?.voice || '',
        tts_openai_voice: tts.openai?.voice || 'alloy',
        tts_openai_model: tts.openai?.model || '',
        voice_auto_tts: voice.auto_tts ?? false,
        voice_record_key: voice.record_key || '',
        voice_max_recording_seconds: voice.max_recording_seconds ?? 120,
      });
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
    setLoading(false);
  };

  const update = (field: string, value: unknown) => {
    setConfig(prev => ({ ...prev, [field]: value } as typeof prev));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await call('update_config', {
        config: {
          stt: {
            enabled: config.stt_enabled,
            provider: config.stt_provider,
            local: {
              model: config.stt_local_model,
              language: config.stt_local_language || undefined,
            },
          },
          tts: {
            provider: config.tts_provider,
            edge: {
              voice: config.tts_edge_voice || undefined,
            },
            openai: {
              voice: config.tts_openai_voice,
              model: config.tts_openai_model || undefined,
            },
          },
          voice: {
            auto_tts: config.voice_auto_tts,
            record_key: config.voice_record_key || undefined,
            max_recording_seconds: config.voice_max_recording_seconds,
          },
        },
      });
      notifySuccess('语音配置已保存');
      onSaved?.();
    } catch (e) {
      notifyError(e, '保存失败');
    }
    setSaving(false);
  };

  if (loading) return <p className="text-xs text-muted-foreground/70">加载中…</p>;
  if (!loaded) return null;

  return (
    <div className="max-w-2xl">
      {/* 能力现状提示（F6: 原文案"后端尚未实现"已过时 — P3/审计修复后录音+转录+TTS 已接线） */}
      <div className="mb-5 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-xs leading-relaxed text-warning">
        <AlertTriangle size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" />
        <span>
          语音输入已可用（麦克风录音 + 云端转录，需 OpenAI API Key）。
          本地 STT 模型、回复后自动朗读（auto_tts）暂未接入。
        </span>
      </div>

      {/* ══════════ 语音转文字 (STT) ══════════ */}
      <SectionCard icon={Mic} title="语音转文字 (STT)" desc="平台语音消息自动转录">
        <SettingRow label="平台语音消息自动转录" desc="收到聊天平台（Telegram 等）的语音消息时自动转录。桌面麦克风录音不受此开关影响。">
          <Switch
            checked={config.stt_enabled}
            onCheckedChange={(val: boolean) => update('stt_enabled', val)}
          />
        </SettingRow>
        <SettingField label="STT 提供商" desc="选择语音识别的后端服务提供商。">
          <select
            className={selectCls}
            value={config.stt_provider}
            onChange={e => update('stt_provider', e.target.value)}
          >
            <option value="local">local — 本地 Whisper</option>
            <option value="openai">openai — OpenAI API</option>
            <option value="elevenlabs">elevenlabs — ElevenLabs</option>
          </select>
        </SettingField>
        <SettingField label="本地 STT 模型" desc="本地 Whisper 模型的尺寸。模型越大精度越高但资源消耗也越大。">
          <select
            className={selectCls}
            value={config.stt_local_model}
            onChange={e => update('stt_local_model', e.target.value)}
          >
            <option value="tiny">tiny — 超轻量</option>
            <option value="base">base — 基础</option>
            <option value="small">small — 小型</option>
            <option value="medium">medium — 中等</option>
            <option value="large-v3">large-v3 — 大型 v3</option>
          </select>
        </SettingField>
        <SettingField label="本地 STT 语言" desc="指定语音识别的语言代码，如 zh, en, ja。留空则自动检测。">
          <Input
            type="text"
            placeholder="留空自动检测"
            value={config.stt_local_language}
            onChange={e => update('stt_local_language', e.target.value)}
          />
        </SettingField>
      </SectionCard>

      {/* ══════════ 文字转语音 (TTS) ══════════ */}
      <SectionCard icon={Volume2} title="文字转语音 (TTS)" desc="Agent 回复的语音合成">
        <SettingField label="TTS 提供商" desc="选择语音合成的后端服务提供商。">
          <select
            className={selectCls}
            value={config.tts_provider}
            onChange={e => update('tts_provider', e.target.value)}
          >
            <option value="edge">edge — Edge TTS</option>
            <option value="openai">openai — OpenAI TTS</option>
            <option value="elevenlabs">elevenlabs — ElevenLabs</option>
          </select>
        </SettingField>
        <SettingField label="Edge TTS 语音" desc="Edge TTS 的语音名称。留空则使用默认语音。">
          <Input
            type="text"
            placeholder="例如: zh-CN-XiaoxiaoNeural"
            value={config.tts_edge_voice}
            onChange={e => update('tts_edge_voice', e.target.value)}
          />
        </SettingField>
        <SettingField label="OpenAI TTS 语音" desc="OpenAI TTS 的语音音色选项。">
          <select
            className={selectCls}
            value={config.tts_openai_voice}
            onChange={e => update('tts_openai_voice', e.target.value)}
          >
            <option value="alloy">alloy</option>
            <option value="echo">echo</option>
            <option value="fable">fable</option>
            <option value="onyx">onyx</option>
            <option value="nova">nova</option>
            <option value="shimmer">shimmer</option>
          </select>
        </SettingField>
        <SettingField label="OpenAI TTS 模型" desc="OpenAI TTS 使用的模型名称。留空则使用默认模型。">
          <Input
            type="text"
            placeholder="例如: tts-1-hd"
            value={config.tts_openai_model}
            onChange={e => update('tts_openai_model', e.target.value)}
          />
        </SettingField>
      </SectionCard>

      {/* ══════════ 语音控制 ══════════ */}
      <SectionCard icon={SlidersHorizontal} title="语音控制" desc="自动朗读与录音行为">
        <SettingRow label="自动朗读回复" desc="Agent 回复后自动进行语音朗读。">
          <Switch
            checked={config.voice_auto_tts}
            onCheckedChange={(val: boolean) => update('voice_auto_tts', val)}
          />
        </SettingRow>
        <SettingField label="录音快捷键" desc="开始 / 停止录音的键盘快捷键。">
          <Input
            type="text"
            placeholder="例如: Ctrl+Shift+M"
            value={config.voice_record_key}
            onChange={e => update('voice_record_key', e.target.value)}
          />
        </SettingField>
        <SettingField label="最大录音时长（秒）" desc="单次录音的最大时长限制（默认 30 秒）。">
          <Input
            type="number"
            min={5}
            max={300}
            step={5}
            value={config.voice_max_recording_seconds}
            onChange={e => update('voice_max_recording_seconds', parseInt(e.target.value) || 120)}
            className="w-40"
          />
        </SettingField>
      </SectionCard>

      {/* 保存按钮 */}
      <SettingsSaveBar>
        <Button variant="default" size="sm" disabled={saving} onClick={handleSave}>
          {saving ? '保存中…' : '保存配置'}
        </Button>
      </SettingsSaveBar>
    </div>
  );
}
