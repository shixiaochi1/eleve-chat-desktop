import { useEffect, useState } from 'react';
import { call } from '../../utils/bridge';
import { notifySuccess, notifyError } from '../../utils/notifications';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';

/**
 * ChatSettings — 聊天设置
 *
 * 对话人格、时区、推理过程显示、图片输入模式
 */
export default function ChatSettings({ onSaved }: { onSaved?: () => void }) {
  const [config, setConfig] = useState({
    personality: 'helpful',
    timezone: '',
    show_reasoning: false,
    image_input_mode: 'auto',
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
      const display = bc.display || {};
      const agent = bc.agent || {};

      setConfig({
        personality: display.personality || 'helpful',
        timezone: bc.timezone || '',
        show_reasoning: display.show_reasoning ?? false,
        image_input_mode: agent.image_input_mode || 'auto',
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
          display: {
            personality: config.personality,
            show_reasoning: config.show_reasoning,
          },
          timezone: config.timezone || undefined,
          agent: {
            image_input_mode: config.image_input_mode,
          },
        },
      });
      notifySuccess('聊天配置已保存');
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
      {/* 对话人格 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">对话人格</label>
        <select
          className="flex h-8 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          value={config.personality}
          onChange={e => update('personality', e.target.value)}
        >
          <option value="helpful">helpful — 乐于助人</option>
          <option value="concise">concise — 简洁精炼</option>
          <option value="technical">technical — 技术专业</option>
          <option value="creative">creative — 创意丰富</option>
          <option value="teacher">teacher — 循循善诱</option>
          <option value="kawaii">kawaii — 可爱风格</option>
          <option value="catgirl">catgirl — 猫娘风格</option>
          <option value="pirate">pirate — 海盗风格</option>
          <option value="shakespeare">shakespeare — 莎士比亚风</option>
          <option value="surfer">surfer — 冲浪手风</option>
          <option value="noir">noir — 黑色电影风</option>
          <option value="uwu">uwu — 软萌风格</option>
          <option value="philosopher">philosopher — 哲学思辨</option>
          <option value="hype">hype — 热情澎湃</option>
        </select>
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          选择 Agent 的对话风格和人格特征。更改后新对话生效。
        </p>
      </div>

      {/* 时区 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">时区</label>
        <Input
          type="text"
          placeholder="留空则使用系统时区"
          value={config.timezone}
          onChange={e => update('timezone', e.target.value)}
        />
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          设置 Agent 使用的时区，如 Asia/Shanghai。留空则自动检测系统时区。
        </p>
      </div>

      <div className="border-t border-border my-4" />

      {/* 显示推理过程 */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-0.5">显示推理过程</label>
          <p className="text-xs text-muted-foreground/70 leading-relaxed m-0">在回复中展示 Agent 的内部推理链和思考过程。</p>
        </div>
        <Switch
          checked={config.show_reasoning}
          onCheckedChange={(val: boolean) => update('show_reasoning', val)}
        />
      </div>

      {/* 图片输入模式 */}
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">图片输入模式</label>
        <select
          className="flex h-8 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          value={config.image_input_mode}
          onChange={e => update('image_input_mode', e.target.value)}
        >
          <option value="auto">auto — 自动决定</option>
          <option value="native">native — 原生模式</option>
          <option value="text">text — 文本描述</option>
        </select>
        <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1">
          控制 Agent 如何处理图片输入。auto 会根据模型能力自动选择。
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
