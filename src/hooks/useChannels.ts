/**
 * useChannels — 渠道/平台连接状态 hook
 *
 * 尝试从后端获取已连接的渠道列表。
 * 1. 优先 GET /v1/channels
 * 2. 回退 GET /api/channels
 * 3. 尝试从网关状态（gateway_status）的平台数据推断
 * 4. 最终回退：基于网关健康状态展示 WeChat 连接
 *
 * Returns:
 *   channels: [{ id, name, platform, status, lastActivity, config }]
 *   loading, error, refresh
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { call } from '../utils/bridge';
import type { PlatformStatus } from '@/types/eleve';

interface ChannelItem {
  id: string;
  name: string;
  platform: string;
  status: string;
  lastActivity: string | null;
  config: Record<string, unknown> | null;
}

interface RawChannel {
  id?: string;
  channel_id?: string;
  name?: string;
  label?: string;
  platform?: string;
  status?: string;
  state?: string;
  last_activity?: string;
  last_active?: string;
  updated_at?: string;
  config?: Record<string, unknown>;
  options?: Record<string, unknown>;
  [key: string]: unknown;
}

interface GatewayStatusResponse {
  platforms?: Record<string, PlatformStatus>;
}

/** 内置平台图标映射 */
const PLATFORM_META: Record<string, { label: string; icon: string }> = {
  wechat:    { label: '微信',     icon: 'MessageCircle' },
  telegram:  { label: 'Telegram', icon: 'MessageCircle' },
  discord:   { label: 'Discord',  icon: 'Hash' },
  slack:     { label: 'Slack',    icon: 'MessageCircle' },
  whatsapp:  { label: 'WhatsApp', icon: 'MessageCircle' },
  signal:    { label: 'Signal',   icon: 'MessageCircle' },
  email:     { label: 'Email',    icon: 'MessageCircle' },
  twitter:   { label: 'Twitter',  icon: 'MessageCircle' },
};

function getDefaultPlatformLabel(platform: string): string {
  return PLATFORM_META[platform]?.label || platform || '未知';
}

/**
 * 规范化渠道对象
 */
function normalizeChannel(raw: RawChannel): ChannelItem {
  const id = raw.id || raw.channel_id || raw.name || `ch-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: raw.name || raw.label || getDefaultPlatformLabel(raw.platform || '') || id,
    platform: (raw.platform || 'unknown').toLowerCase(),
    status: raw.status || raw.state || 'offline',
    lastActivity: raw.last_activity || raw.last_active || raw.updated_at || null,
    config: raw.config || raw.options || null,
  };
}

/**
 * 从网关状态的 platforms 字段推断渠道
 */
function inferFromPlatforms(statusPlatforms: Record<string, PlatformStatus>): ChannelItem[] {
  if (!statusPlatforms || typeof statusPlatforms !== 'object') return [];
  return Object.entries(statusPlatforms).map(([name, state]) => {
    const status =
      typeof state === 'object' && state.state === 'connected'
        ? 'online'
        : typeof state === 'string'
          ? (state === 'connected' ? 'online' : 'offline')
          : 'offline';
    return normalizeChannel({
      id: name,
      name: getDefaultPlatformLabel(name),
      platform: name,
      status,
    } as RawChannel);
  });
}

/**
 * 如果后端全无响应，兜底一个 WeChat 占位渠道
 */
function fallbackWeChatChannel(gatewayOnline: boolean): ChannelItem[] {
  return [{
    id: 'wechat',
    name: '微信',
    platform: 'wechat',
    status: gatewayOnline ? 'online' : 'offline',
    lastActivity: null,
    config: null,
  }];
}

export function useChannels({ gatewayOnline = false }: { gatewayOnline?: boolean } = {}) {
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // 直接从 gateway_status 获取平台信息（后端 /api/gateway/status 返回 platforms 字段）
      const status: GatewayStatusResponse = await call('gateway_status', {});
      if (status && status.platforms) {
        const inferred = inferFromPlatforms(status.platforms);
        if (mountedRef.current) {
          setChannels(inferred.length > 0 ? inferred : fallbackWeChatChannel(gatewayOnline));
          setLoading(false);
          return;
        }
      }
    } catch (e) {
      // gateway_status 调用失败
    }

    // 回退：基于网关在线状态展示 WeChat
    if (mountedRef.current) {
      setChannels(fallbackWeChatChannel(gatewayOnline));
      setError('无法获取渠道状态');
      setLoading(false);
    }
  }, [gatewayOnline]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => { mountedRef.current = false; };
  }, [refresh]);

  return { channels, loading, error, refresh };
}
