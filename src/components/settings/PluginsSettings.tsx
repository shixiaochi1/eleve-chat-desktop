import { Puzzle } from 'lucide-react';
import { setPluginEnabled, usePluginRecords } from '../../contrib/plugins-store';
import { SectionCard, SettingRow } from './SettingBlocks';
import { Switch } from '../ui/switch';

/**
 * PluginsSettings — 插件开关
 *
 * 2026-11-13 统一卡片语言：此前是设置页里唯一没改造的页面（英文标题
 * "Plugins" / "empty"、ON-OFF 裸按钮、无分组卡片），与其余 12 页
 * （中文 + SectionCard + 13px 标签 + 开关控件）断层。开关逻辑不变。
 */
export default function PluginsSettings() {
  const records = usePluginRecords();

  return (
    <div className="max-w-2xl">
      <SectionCard
        icon={Puzzle}
        title="插件"
        desc="启用或停用已安装的插件；停用后其界面入口与贡献同时下线"
      >
        {records.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            暂无插件
          </div>
        ) : (
          records.map(rec => (
            <SettingRow
              key={rec.id}
              label={rec.name}
              desc={rec.description ? `${rec.description}（${rec.id}）` : rec.id}
            >
              <Switch
                checked={rec.enabled}
                onCheckedChange={(v: boolean) => setPluginEnabled(rec.id, v)}
              />
            </SettingRow>
          ))
        )}
      </SectionCard>
    </div>
  );
}
