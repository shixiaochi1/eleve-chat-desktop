/**
 * agent-avatars — Agent 默认头像库（对齐 Hermes 桌面前端“头像卡片”语义）
 *
 * 预设头像 = 主题色 SVG（currentColor 着色，随 Agent 主题色即时变色）。
 * 选择后存 avatar_key 到 profile.yaml（后端），前端各处按 key 渲染。
 * 头像与主题色联动：换主题色 → 头像自动换色（同一 key 渲染时注入新色）。
 *
 * key 命名：小写蛇形。渲染组件 AgentAvatar 统一入口：
 *   - avatarKey 有值 → 渲染预设 SVG
 *   - 上传图片（dataURL）→ 渲染 img
 *   - 都没有 → 首字母 glyph
 */
import { memo } from 'react';
import { cn } from '@/lib/utils';

export interface AgentAvatarDef {
  key: string;
  label: string;
  /** 渲染 SVG 内容（color = 主题色 hex） */
  svg: (color: string) => React.ReactNode;
}

/** 12 个预设头像：几何风格机器人/动物/符号，全部 currentColor 着色 */
export const AGENT_AVATARS: AgentAvatarDef[] = [
  {
    key: 'bot',
    label: '机器人',
    svg: (c) => (
      <g stroke={c} fill="none" strokeWidth="1.4" strokeLinecap="round">
        <rect x="5" y="7.5" width="14" height="10.5" rx="2.5" fill={`${c}22`} />
        <circle cx="9.6" cy="12.4" r="1.3" fill={c} stroke="none" />
        <circle cx="14.4" cy="12.4" r="1.3" fill={c} stroke="none" />
        <path d="M10.2 15.8h3.6" />
        <path d="M12 4.5v3" />
        <circle cx="12" cy="3.6" r="1.1" fill={c} stroke="none" />
      </g>
    ),
  },
  {
    key: 'cat',
    label: '猫咪',
    svg: (c) => (
      <g stroke={c} fill="none" strokeWidth="1.4" strokeLinecap="round">
        <path d="M5 18c0-4.4 3.1-7.5 7-7.5s7 3.1 7 7.5" />
        <path d="M7.2 10.5 5 6.5l3.8 2.2" />
        <path d="M16.8 10.5 19 6.5l-3.8 2.2" />
        <circle cx="9.8" cy="13.6" r="1.1" fill={c} stroke="none" />
        <circle cx="14.2" cy="13.6" r="1.1" fill={c} stroke="none" />
        <path d="M10.2 16.6h3.6" />
      </g>
    ),
  },
  {
    key: 'fox',
    label: '狐狸',
    svg: (c) => (
      <g stroke={c} fill="none" strokeWidth="1.4" strokeLinecap="round">
        <path d="M6 10.5 4 6l4 2.2a7 7 0 0 1 8 0L20 6l-2 4.5" />
        <path d="M5.5 13a6.5 6.5 0 0 1 13 0v2.5a2.5 2.5 0 0 1-2.5 2.5h-8a2.5 2.5 0 0 1-2.5-2.5z" />
        <circle cx="10" cy="13.5" r="1" fill={c} stroke="none" />
        <circle cx="14" cy="13.5" r="1" fill={c} stroke="none" />
        <path d="M10.5 16.5h3" />
      </g>
    ),
  },
  {
    key: 'panda',
    label: '熊猫',
    svg: (c) => (
      <g stroke={c} fill="none" strokeWidth="1.4" strokeLinecap="round">
        <circle cx="12" cy="13" r="7.5" fill={`${c}22`} />
        <circle cx="8.8" cy="11" r="2" fill={c} stroke="none" />
        <circle cx="15.2" cy="11" r="2" fill={c} stroke="none" />
        <circle cx="9.6" cy="11.3" r="0.9" fill="var(--ui-card-bg)" stroke="none" />
        <circle cx="14.4" cy="11.3" r="0.9" fill="var(--ui-card-bg)" stroke="none" />
        <path d="M9.5 15.5a3 3 0 0 0 5 0" />
      </g>
    ),
  },
  {
    key: 'owl',
    label: '猫头鹰',
    svg: (c) => (
      <g stroke={c} fill="none" strokeWidth="1.4" strokeLinecap="round">
        <path d="M6 11a6 6 0 0 1 12 0v4.5a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" />
        <path d="M7.5 9 5 6.5" />
        <path d="M16.5 9 19 6.5" />
        <circle cx="9.8" cy="13" r="1.5" fill={c} stroke="none" />
        <circle cx="14.2" cy="13" r="1.5" fill={c} stroke="none" />
        <circle cx="10.1" cy="13.3" r="0.6" fill="var(--ui-card-bg)" stroke="none" />
        <circle cx="13.9" cy="13.3" r="0.6" fill="var(--ui-card-bg)" stroke="none" />
      </g>
    ),
  },
  {
    key: 'alien',
    label: '外星人',
    svg: (c) => (
      <g stroke={c} fill="none" strokeWidth="1.4" strokeLinecap="round">
        <ellipse cx="12" cy="12.5" rx="7" ry="8" fill={`${c}22`} />
        <path d="M8.5 5.5c-1.8 1-2.5 2.8-2.5 4.5" />
        <path d="M15.5 5.5c1.8 1 2.5 2.8 2.5 4.5" />
        <ellipse cx="9.7" cy="12.5" rx="1.6" ry="2.4" fill={c} stroke="none" />
        <ellipse cx="14.3" cy="12.5" rx="1.6" ry="2.4" fill={c} stroke="none" />
        <ellipse cx="10" cy="12.8" rx="0.7" ry="1" fill="var(--ui-card-bg)" stroke="none" />
        <ellipse cx="14" cy="12.8" rx="0.7" ry="1" fill="var(--ui-card-bg)" stroke="none" />
        <path d="M10.5 17.5a1.5 1.5 0 0 0 3 0" />
      </g>
    ),
  },
  {
    key: 'ghost',
    label: '幽灵',
    svg: (c) => (
      <g stroke={c} fill="none" strokeWidth="1.4" strokeLinecap="round">
        <path d="M6 19V11a6 6 0 0 1 12 0v8l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5z" fill={`${c}22`} />
        <circle cx="9.8" cy="11.5" r="1" fill={c} stroke="none" />
        <circle cx="14.2" cy="11.5" r="1" fill={c} stroke="none" />
        <path d="M10 14.5h4" />
      </g>
    ),
  },
  {
    key: 'rocket',
    label: '火箭',
    svg: (c) => (
      <g stroke={c} fill="none" strokeWidth="1.4" strokeLinecap="round">
        <path d="M12 3c2.5 2.2 3.8 5.4 3.8 8.6V16l-3.8 2.5L8.2 16v-4.4c0-3.2 1.3-6.4 3.8-8.6z" fill={`${c}22`} />
        <circle cx="12" cy="9.5" r="1.6" />
        <path d="M8.2 16 5 19.5M15.8 16l3.2 3.5" />
      </g>
    ),
  },
  {
    key: 'star',
    label: '星星',
    svg: (c) => (
      <g stroke={c} fill="none" strokeWidth="1.4" strokeLinejoin="round">
        <path d="M12 4l2.2 4.7 5.1.6-3.8 3.5 1 5-4.5-2.5L7.5 17.8l1-5L4.7 9.3l5.1-.6z" fill={`${c}22`} />
      </g>
    ),
  },
  {
    key: 'planet',
    label: '星球',
    svg: (c) => (
      <g stroke={c} fill="none" strokeWidth="1.4" strokeLinecap="round">
        <circle cx="11" cy="12" r="6.5" fill={`${c}22`} />
        <path d="M4.5 10.5c3-.8 5.5-.4 8.5 1s4.5 2.4 6.5 2" />
        <circle cx="13.5" cy="8.5" r="1" fill={c} stroke="none" />
      </g>
    ),
  },
  {
    key: 'bolt',
    label: '闪电',
    svg: (c) => (
      <g stroke={c} fill="none" strokeWidth="1.4" strokeLinejoin="round">
        <path d="M13 4 6.5 13.5h4.5L10 20l7-9.5h-4.5z" fill={`${c}22`} />
      </g>
    ),
  },
  {
    key: 'crown',
    label: '王冠',
    svg: (c) => (
      <g stroke={c} fill="none" strokeWidth="1.4" strokeLinejoin="round">
        <path d="M5 16.5 3.5 8.5l4.5 3L12 5.5l4 6 4.5-3-1.5 8z" fill={`${c}22`} />
        <circle cx="12" cy="18.5" r="1.1" fill={c} stroke="none" />
      </g>
    ),
  },
];

/** 按 key 找头像定义（未知名 → bot 兜底） */
export function getAgentAvatarDef(key?: string | null): AgentAvatarDef {
  return AGENT_AVATARS.find((a) => a.key === key) ?? AGENT_AVATARS[0];
}

/** 主题色 SVG 头像（独立渲染组件：色板选择/侧栏/宫格共用） */
export const AgentAvatarSvg = memo(function AgentAvatarSvg({
  avatarKey,
  color,
  className,
}: {
  avatarKey?: string | null;
  color: string;
  className?: string;
}) {
  const def = getAgentAvatarDef(avatarKey);
  return (
    <svg viewBox="0 0 24 24" className={cn('w-full h-full', className)} fill="none" aria-hidden="true">
      {def.svg(color)}
    </svg>
  );
});
