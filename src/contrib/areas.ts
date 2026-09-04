/**
 * 插件贡献 Area 清单与各 area 的载荷类型（阶段 1 首批）。
 *
 * Area = 主壳上可被插件挂载的扩展点。新增 area：
 * ① 这里加常量 + 载荷接口 ② 主壳对应位置消费 useContributions(area)
 * ③ 如有内置 UI，迁移为 core 贡献（source='core'，保证消费点单一）。
 */

import type { ComponentType } from 'react';

/** IconBar 动作按钮（外挂应用注册 / 插件快捷动作）。 */
export interface IconBarActionData {
  /** lucide 或项目 Icons 组件 */
  icon: ComponentType<{ className?: string }>;
  label: string;
  /** 排序权重（升序，内置项之后的追加区；缺省 100） */
  order?: number;
  /** 点击行为（外挂应用 = 意图 RPC；进程内插件 = 任意动作） */
  activate: () => void;
}

export const AREA_ICON_BAR_ACTION = 'iconBar.action';

/** 主区视图（阶段 4 Bot Mode 迁移时消费；底座先提供注册能力）。 */
export interface MainViewData {
  /** 激活键（宿主导航状态用） */
  viewId: string;
  label: string;
  component: ComponentType;
}

export const AREA_MAIN_VIEW = 'mainView';

/** 会话空态区（对齐 Hermes CHAT_EMPTY_AREA；预留）。 */
export const AREA_CHAT_EMPTY = 'chatEmpty'; 
