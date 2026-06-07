import { useEffect, useState } from 'react';
import { call } from '../../utils/bridge';
import { notifySuccess, notifyError } from '../../utils/notifications';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';

/**
 * VoiceSettings — 语音设置
 *
 * 语音转文字 (STT)、文字转语音 (TTS)、自动朗读、录音快捷键
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
    voice_max_recording_seconds: 30,
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
        voice_max_recording_seconds: voice.max_recording_seconds ?? 30,
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
    <div>
      {/* ══════════ 语音转文字 (STT) ══════════ */}
      <h3 className="text-sm font-medium mb-3">语音转文字 (STT)</h3>

      {/* STT 开关 */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-0.5">启用语音转文字</label>
          <p className="text-xs text-muted-foreground/70 leading-relaxed m-0">开启后可通过语音输入与 Agent 对话。</p>
        </div>
        <Switch
          checked={config.stt_enabled}
          onCheckedChange={(val: boolean) => update('stt_enabled', val)}
        />
      </div>

      {/* STT 提供商 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">STT 提供商</label>
        <select
          className="flex h-8 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          value={config.stt_provider}
          onChange={e => update('stt_provider', e.target.value)}
        >
          <option value="local">local — 本地 Whisper</option>
          <option value="openai">openai — OpenAI API</option>
          <option value="elevenlabs">elevenlabs — ElevenLabs</option>
        </select>
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          选择语音识别的后端服务提供商。
        </p>
      </div>

      {/* 本地模型 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">本地 STT 模型</label>
        <select
          className="flex h-8 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          value={config.stt_local_model}
          onChange={e => update('stt_local_model', e.target.value)}
        >
          <option value="tiny">tiny — 超轻量</option>
          <option value="base">base — 基础</option>
          <option value="small">small — 小型</option>
          <option value="medium">medium — 中等</option>
          <option value="large-v3">large-v3 — 大型 v3</option>
        </select>
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          本地 Whisper 模型的尺寸。模型越大精度越高但资源消耗也越大。
        </p>
      </div>

      {/* 本地语言 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">本地 STT 语言</label>
        <Input
          type="text"
          placeholder="留空自动检测"
          value={config.stt_local_language}
          onChange={e => update('stt_local_language', e.target.value)}
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          指定语音识别的语言代码，如 zh, en, ja。留空则自动检测。
        </p>
      </div>

      <div className="border-t border-border my-4" />

      {/* ══════════ 文字转语音 (TTS) ══════════ */}
      <h3 className="text-sm font-medium mb-3">文字转语音 (TTS)</h3>

      {/* TTS 提供商 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">TTS 提供商</label>
        <select
          className="flex h-8 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          value={config.tts_provider}
          onChange={e => update('tts_provider', e.target.value)}
        >
          <option value="edge">edge — Edge TTS</option>
          <option value="openai">openai — OpenAI TTS</option>
          <option value="elevenlabs">elevenlabs — ElevenLabs</option>
        </select>
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          选择语音合成的后端服务提供商。
        </p>
      </div>

      {/* Edge 语音 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">Edge TTS 语音</label>
        <Input
          type="text"
          placeholder="例如: zh-CN-XiaoxiaoNeural"
          value={config.tts_edge_voice}
          onChange={e => update('tts_edge_voice', e.target.value)}
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          Edge TTS 的语音名称。留空则使用默认语音。
        </p>
      </div>

      {/* OpenAI 语音 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">OpenAI TTS 语音</label>
        <select
          className="flex h-8 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
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
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          OpenAI TTS 的语音音色选项。
        </p>
      </div>

      {/* OpenAI 模型 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">OpenAI TTS 模型</label>
        <Input
          type="text"
          placeholder="例如: tts-1-hd"
          value={config.tts_openai_model}
          onChange={e => update('tts_openai_model', e.target.value)}
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          OpenAI TTS 使用的模型名称。留空则使用默认模型。
        </p>
      </div>

      <div className="border-t border-border my-4" />

      {/* ══════════ 语音控制 ══════════ */}
      <h3 className="text-sm font-medium mb-3">语音控制</h3>

      {/* 自动朗读回复 */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-0.5">自动朗读回复</label>
          <p className="text-xs text-muted-foreground/70 leading-relaxed m-0">Agent 回复后自动进行语音朗读。</p>
        </div>
        <Switch
          checked={config.voice_auto_tts}
          onCheckedChange={(val: boolean) => update('voice_auto_tts', val)}
        />
      </div>

      {/* 录音快捷键 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">录音快捷键</label>
        <Input
          type="text"
          placeholder="例如: Ctrl+Shift+M"
          value={config.voice_record_key}
          onChange={e => update('voice_record_key', e.target.value)}
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          开始 / 停止录音的键盘快捷键。
        </p>
      </div>

      {/* 最大录音时长 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">最大录音时长（秒）</label>
        <Input
          type="number"
          min={5}
          max={300}
          step={5}
          value={config.voice_max_recording_seconds}
          onChange={e => update('voice_max_recording_seconds', parseInt(e.target.value) || 30)}
          className="w-32"
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          单次录音的最大时长限制（默认 30 秒）。
        </p>
      </div>

      {/* 保存按钮 */}
      <div className="mt-4">
        <Button variant="default" size="sm" disabled={saving} onClick={handleSave}>
          {saving ? '保存中…' : '保存配置'}
        </Button>
      </div>
    </div>
  );
}
