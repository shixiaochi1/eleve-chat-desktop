/**
 * ChannelsPanel — 渠道/平台管理面板
 *
 * 展示已连接的即时通讯平台（微信、Telegram、Discord、Slack 等）
 * 每个渠道卡片显示：平台图标、名称/ID、连接状态、最近活动时间、平台类型标签
 */
import { cn } from '@/lib/utils';
import {
  MessageCircle,
  Hash,
  Radio,
  Wifi,
  WifiOff,
  Plus,
  RefreshCw,
  Loader,
  Circle,
} from 'lucide-react';
import { useChannels } from '../hooks/useChannels';

interface ChannelItem {
  id: string;
  name: string;
  platform: string;
  status: string;
  lastActivity: string | null;
  config: Record<string, unknown> | null;
}

interface ChannelsPanelProps {
  gatewayOnline?: boolean;
  onOpenSettings?: () => void;
}

/**
 * 平台 → 图标映射
 */
function platformIcon(platform: string) {
  switch (platform) {
    case 'discord':
      return <Hash size={18} strokeWidth={1.5} />;
    case 'telegram':
    case 'wechat':
    case 'whatsapp':
    case 'signal':
    case 'slack':
    case 'email':
    case 'twitter':
    default:
      return <MessageCircle size={18} strokeWidth={1.5} />;
  }
}

/**
 * 平台 → 标签色彩
 */
function platformColor(platform: string): string {
  switch (platform) {
    case 'wechat':    return '#07c160';
    case 'telegram':  return '#0088cc';
    case 'discord':   return '#5865f2';
    case 'slack':     return '#4a154b';
    case 'whatsapp':  return '#25d366';
    case 'signal':    return '#3a76f0';
    default:          return 'var(--accent)';
  }
}

/**
 * 格式化时间戳
 */
function fmtTimestamp(ts: string | null | undefined): string {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin}分钟前`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}小时前`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}天前`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}

/**
 * 格式化渠道名称（取可读部分）
 */
function displayName(ch: ChannelItem): string {
  return ch.name || ch.id || '未知渠道';
}

export default function ChannelsPanel({ gatewayOnline, onOpenSettings }: ChannelsPanelProps) {
  const { channels, loading, error, refresh } = useChannels({ gatewayOnline });

  return (
    <div className="p-2 space-y-2">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-foreground">频道</h3>
        <div className="flex items-center gap-1">
          <button
            className="p-1 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            onClick={refresh}
            title="刷新"
            disabled={loading}
          >
            <RefreshCw size={14} strokeWidth={1.5} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            className="flex items-center gap-0.5 px-1.5 py-1 text-xs text-accent hover:bg-accent/10 rounded transition-colors"
            onClick={onOpenSettings}
            title="添加频道 — 前往设置配置平台"
          >
            <Plus size={14} strokeWidth={1.5} />
            <span>添加</span>
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="space-y-1">
        {loading && channels.length === 0 ? (
          <div className="flex flex-col items-center py-6 text-muted-foreground gap-1">
            <Loader size={18} strokeWidth={1.5} className="animate-spin" />
            <span className="text-xs">加载中…</span>
          </div>
        ) : error ? (
          <div className="flex items-center gap-1 px-2 py-1 text-xs text-destructive bg-destructive/5 rounded border border-destructive/20">
            <WifiOff size={16} strokeWidth={1.5} />
            <span className="flex-1">{error}</span>
            <button className="text-accent hover:underline" onClick={refresh}>重试</button>
          </div>
        ) : channels.length === 0 ? (
          <div className="flex flex-col items-center py-6 text-muted-foreground gap-1">
            <Radio size={28} strokeWidth={1.5} className="text-muted-foreground/30" />
            <span className="text-xs">暂无已连接的频道</span>
            <span className="text-[10px] text-muted-foreground/50">点击「添加」配置新的通讯平台</span>
          </div>
        ) : (
          <div className="space-y-1">
            {channels.map((ch: ChannelItem) => (
              <div key={ch.id} className="flex items-center gap-2 p-2 rounded border border-border hover:bg-accent/5 transition-colors">
                {/* 左侧图标 */}
                <div className="shrink-0" style={{ color: platformColor(ch.platform) }}>
                  {platformIcon(ch.platform)}
                </div>

                {/* 中间信息 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-foreground truncate">{displayName(ch)}</span>
                    <span
                      className="px-1 py-0.5 text-[10px] rounded shrink-0"
                      style={{
                        background: `${platformColor(ch.platform)}22`,
                        color: platformColor(ch.platform),
                      }}
                    >
                      {ch.platform}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
                    <span className={cn(
                      'flex items-center gap-0.5',
                      ch.status === 'online' ? 'text-success' :
                      ch.status === 'connecting' ? 'text-warning' : 'text-muted-foreground/50'
                    )}>
                      <span className={cn(
                        'w-1.5 h-1.5 rounded-full',
                        ch.status === 'online' ? 'bg-success' :
                        ch.status === 'connecting' ? 'bg-warning animate-pulse' : 'bg-muted-foreground/50'
                      )} />
                      {ch.status === 'online' ? '在线' :
                       ch.status === 'connecting' ? '连接中' : '离线'}
                    </span>
                    {ch.lastActivity && (
                      <span>{fmtTimestamp(ch.lastActivity)}</span>
                    )}
                  </div>
                </div>

                {/* 右侧状态指示 */}
                <div className="shrink-0">
                  {ch.status === 'online' ? (
                    <Wifi size={14} strokeWidth={1.5} className="text-success" />
                  ) : (
                    <WifiOff size={14} strokeWidth={1.5} className="text-muted-foreground/40" />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
