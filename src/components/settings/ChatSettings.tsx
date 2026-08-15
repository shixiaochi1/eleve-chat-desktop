import { useEffect, useState } from 'react';
import { Eye, Code2, User, Brain } from 'lucide-react';
import { call } from '../../utils/bridge';
import { notifyError } from '../../utils/notifications';
import { setShowReasoning } from '../../store/display-settings';
import { useToolViewMode, setToolViewMode, type ToolViewMode } from '@/store/tool-view';
import { cn } from '@/lib/utils';
import { Switch } from '../ui/switch';

/**
 * ChatSettings — 聊天设置
 *
 * 分区卡片：
 * - 对话行为：对话人格、时区
 * - 消息显示：显示推理过程、工具调用显示、图片输入模式
 *
 * 所有字段变更即时生效（静默保存后端，失败才报错），无保存按钮。
 */

/** 工具调用显示模式选项（对齐 Hermes appearance-settings toolView 文案） */
const TOOL_VIEW_OPTIONS: { id: ToolViewMode; label: string; desc: string; Icon: typeof Eye }[] = [
  { id: 'product', label: '产品', desc: '易读的工具活动与简洁摘要', Icon: Eye },
  { id: 'technical', label: '技术', desc: '包含原始工具参数/结果及底层细节', Icon: Code2 },
];

/** 常用 IANA 时区（按 UTC 偏移分组，覆盖中国用户与全球主要城市） */
const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: 'Pacific/Honolulu', label: '(UTC-10) 檀香山' },
  { value: 'America/Anchorage', label: '(UTC-9) 安克雷奇' },
  { value: 'America/Los_Angeles', label: '(UTC-8) 洛杉矶 · 温哥华' },
  { value: 'America/Denver', label: '(UTC-7) 丹佛' },
  { value: 'America/Chicago', label: '(UTC-6) 芝加哥 · 达拉斯' },
  { value: 'America/New_York', label: '(UTC-5) 纽约 · 多伦多' },
  { value: 'America/Caracas', label: '(UTC-4) 加拉加斯' },
  { value: 'America/Sao_Paulo', label: '(UTC-3) 圣保罗 · 布宜诺斯艾利斯' },
  { value: 'Atlantic/Azores', label: '(UTC-1) 亚速尔群岛' },
  { value: 'Etc/UTC', label: '(UTC+0) 协调世界时 UTC' },
  { value: 'Europe/London', label: '(UTC+0) 伦敦 · 都柏林' },
  { value: 'Europe/Paris', label: '(UTC+1) 巴黎 · 柏林 · 罗马' },
  { value: 'Europe/Athens', label: '(UTC+2) 雅典 · 开罗' },
  { value: 'Europe/Moscow', label: '(UTC+3) 莫斯科 · 伊斯坦布尔' },
  { value: 'Asia/Dubai', label: '(UTC+4) 迪拜' },
  { value: 'Asia/Karachi', label: '(UTC+5) 卡拉奇' },
  { value: 'Asia/Kolkata', label: '(UTC+5:30) 孟买 · 新德里' },
  { value: 'Asia/Dhaka', label: '(UTC+6) 达卡' },
  { value: 'Asia/Bangkok', label: '(UTC+7) 曼谷 · 雅加达 · 河内' },
  { value: 'Asia/Shanghai', label: '(UTC+8) 北京 · 上海 · 新加坡' },
  { value: 'Asia/Hong_Kong', label: '(UTC+8) 香港' },
  { value: 'Asia/Taipei', label: '(UTC+8) 台北' },
  { value: 'Asia/Tokyo', label: '(UTC+9) 东京 · 首尔' },
  { value: 'Australia/Adelaide', label: '(UTC+9:30) 阿德莱德' },
  { value: 'Australia/Sydney', label: '(UTC+10) 悉尼 · 墨尔本' },
  { value: 'Pacific/Auckland', label: '(UTC+12) 奥克兰 · 惠灵顿' },
];

/** 分区卡片：标题 + 描述 + 内容 */
function SectionCard({
  icon: Icon,
  title,
  desc,
  children,
}: {
  icon: typeof User;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden mb-4">
      <div className="flex items-start gap-2.5 px-4 py-3">
        <Icon size={15} className="text-muted-foreground mt-0.5 shrink-0" strokeWidth={1.75} />
        <div>
          <h3 className="text-sm font-semibold text-foreground leading-tight">{title}</h3>
          <p className="text-xs text-muted-foreground/70 leading-relaxed mt-0.5">{desc}</p>
        </div>
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </div>
  );
}

/** 设置行：label + 描述 + 右侧控件（开关类） */
function SettingRow({
  label,
  desc,
  children,
}: {
  label: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <label className="block text-xs font-medium text-foreground mb-0.5">{label}</label>
        <p className="text-xs text-muted-foreground/70 leading-relaxed m-0">{desc}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** 设置字段：label + 控件 + 描述（输入/选择类） */
function SettingField({
  label,
  desc,
  children,
}: {
  label: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-foreground mb-1.5">{label}</label>
      {children}
      <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1.5">{desc}</p>
    </div>
  );
}

/** 设置项通用 select 样式（与项目其它设置页一致） */
const SELECT_CLASS =
  'flex h-8 w-full items-center rounded-md border border-input bg-transparent px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

export default function ChatSettings({ onSaved }: { onSaved?: () => void }) {
  const toolViewMode = useToolViewMode();
  const [config, setConfig] = useState({
    personality: '',
    timezone: '',
    show_reasoning: false,
    image_input_mode: 'auto',
  });
  const [loading, setLoading] = useState(false);
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
        personality: display.personality || '',
        timezone: bc.timezone || '',
        show_reasoning: display.show_reasoning ?? true,
        image_input_mode: agent.image_input_mode || 'auto',
      });
      // 同步全局 store（读侧与渲染侧同源，防面板内外状态漂移）
      setShowReasoning(display.show_reasoning ?? true);
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
    setLoading(false);
  };

  /**
   * 变更即保存（即时生效，无保存按钮）：
   * 本地 state 先行更新保证 UI 响应，随后静默提交后端；失败才报错。
   */
  const update = (field: string, value: unknown) => {
    const next = { ...config, [field]: value } as typeof config;
    setConfig(next);

    // 推理块显示：写侧即时同步 store（无需刷新/重进会话）
    if (field === 'show_reasoning') {
      setShowReasoning(next.show_reasoning);
    }

    void call('update_config', {
      config: {
        display: {
          personality: next.personality,
          show_reasoning: next.show_reasoning,
        },
        // 🔴 清空时区必须写 null 而非 undefined：js-yaml dump 会丢弃 undefined 值 →
        // 后端 config.set.raw 收不到 timezone 键 → 旧值残留清不掉（加性更新语义）。
        // null → yaml.dump 输出 `timezone: null` → 后端 flatten 收集叶节点 →
        // update_value 置 None → 内存+磁盘同步清空。
        timezone: next.timezone || null,
        agent: {
          image_input_mode: next.image_input_mode,
        },
      },
    }).catch(e => {
      notifyError(e, '保存失败');
    });
  };

  if (loading) return <p className="text-xs text-muted-foreground/70">加载中…</p>;
  if (!loaded) return null;

  return (
    <div>
      {/* 对话行为 */}
      <SectionCard icon={User} title="对话行为" desc="控制 Agent 的对话风格与时间感知">
        <SettingField label="对话人格" desc="选择 Agent 的对话风格和人格特征。更改后新对话生效。">
          <select
            className={SELECT_CLASS}
            value={config.personality}
            onChange={e => update('personality', e.target.value)}
          >
            <option value="">无 — 不使用人格覆盖（默认）</option>
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
        </SettingField>

        <SettingField label="时区" desc="Agent 使用该时区感知时间。留空自动检测系统时区。">
          <select
            className={SELECT_CLASS}
            value={config.timezone}
            onChange={e => update('timezone', e.target.value)}
          >
            <option value="">自动 — 使用系统时区</option>
            {TIMEZONE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </SettingField>
      </SectionCard>

      {/* 消息显示 */}
      <SectionCard icon={Brain} title="消息显示" desc="控制回复中的推理链与工具调用展示方式">
        <SettingRow label="显示推理过程" desc="在回复中展示 Agent 的内部推理链和思考过程。">
          <Switch
            checked={config.show_reasoning}
            onCheckedChange={(val: boolean) => update('show_reasoning', val)}
          />
        </SettingRow>

        {/* 工具调用显示模式 */}
        <div>
          <label className="block text-xs font-medium text-foreground mb-1.5">工具调用显示</label>
          <div className="flex gap-2.5">
            {TOOL_VIEW_OPTIONS.map(({ id, label, desc, Icon }) => {
              const selected = toolViewMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setToolViewMode(id)}
                  className={cn(
                    'flex flex-col items-center gap-1 p-2.5 rounded-lg cursor-pointer transition-all text-xs text-center flex-1',
                    selected
                      ? 'border border-primary bg-accent/10 text-primary'
                      : 'border border-border bg-background text-muted-foreground hover:bg-accent/5'
                  )}
                >
                  <Icon size={18} strokeWidth={1.5} className={selected ? 'text-primary' : 'text-muted-foreground'} />
                  <span className="font-semibold">{label}</span>
                  <span className="text-[10px] text-muted-foreground/70 leading-tight">{desc}</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1.5">
            产品模式隐藏原始工具数据；技术模式显示完整输入/输出。
          </p>
        </div>

        <SettingField label="图片输入模式" desc="控制 Agent 如何处理图片输入。auto 会根据模型能力自动选择。">
          <select
            className={SELECT_CLASS}
            value={config.image_input_mode}
            onChange={e => update('image_input_mode', e.target.value)}
          >
            <option value="auto">auto — 自动决定</option>
            <option value="native">native — 原生模式</option>
            <option value="text">text — 文本描述</option>
          </select>
        </SettingField>
      </SectionCard>
    </div>
  );
}
