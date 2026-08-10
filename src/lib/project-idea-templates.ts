/**
 * 新建项目 idea 模板（对齐 Hermes lib/project-idea-templates.ts 全量 16 个）。
 * 模板 chips 预填 idea；展示的随机 handful（打开/洗牌时重排）。
 * 🔴 2026-08-10 老大要求：label + idea 全部中文化。
 */

export interface ProjectIdeaTemplate {
  emoji: string;
  label: string;
  idea: string;
}

export const PROJECT_IDEA_TEMPLATES: ProjectIdeaTemplate[] = [
  {
    emoji: '🎮',
    label: '游戏开发',
    idea: '一个周末就能做出来的小浏览器游戏。\n\n- 一个核心玩法，反馈要爽快\n- 无需构建步骤——单个 HTML/JS 文件\n- 60 秒内就能上手玩',
  },
  {
    emoji: '📚',
    label: '写小说',
    idea: '一本进行中的小说。\n\n- 跟踪章节、人物和时间线\n- 每日字数目标\n- 在草稿旁边保留研究笔记',
  },
  {
    emoji: '🤖',
    label: '机器人应用',
    idea: '为小社区做一个机器人应用。\n\n- 斜杠命令 + 有趣的日常互动\n- 轻量持久化存储\n- 部署在免费平台上',
  },
  {
    emoji: '📊',
    label: '数据可视化',
    idea: '把我在意的数据集做成交互式可视化。\n\n- 选好数据集和它回答的一个问题\n- 清洗 → 图表 → 注释\n- 单页即可分享',
  },
  {
    emoji: '🎨',
    label: '生成艺术',
    idea: '一件生成艺术作品。\n\n- 一个算法，多种随机种子\n- 导出高清静帧\n- 收藏最佳输出作品集',
  },
  {
    emoji: '🍳',
    label: '菜谱管理',
    idea: '个人菜谱收藏。\n\n- 按食材和心情搜索\n- 随时调整分量\n- 自动生成购物清单',
  },
  {
    emoji: '🧪',
    label: '研究日志',
    idea: '为开放问题做研究笔记本。\n\n- 记录实验、结果和死胡同\n- 内联引用来源\n- 每周综合所学',
  },
  {
    emoji: '💸',
    label: '预算跟踪',
    idea: '一个务实的预算跟踪工具。\n\n- 导入交易记录，快速打标签\n- 每月支出 vs 计划\n- 一张图说清真相',
  },
  {
    emoji: '🌱',
    label: '习惯打卡',
    idea: '一个真正能坚持的习惯打卡工具。\n\n- 少量每日勾选\n- 不焦虑的连续打卡\n- 平静的每周回顾',
  },
  {
    emoji: '🗺️',
    label: '行程规划',
    idea: '为即将到来的冒险做行程规划。\n\n- 逐日行程安排\n- 地图标记 + 备注\n- 行李与预算清单',
  },
  {
    emoji: '🎵',
    label: '音乐玩具',
    idea: '一个小型音乐创作玩具。\n\n- 一种乐器或音序器\n- Web Audio，免安装\n- 录制并分享一段循环',
  },
  {
    emoji: '🧩',
    label: '谜题生成器',
    idea: '为我喜欢的谜题做生成器。\n\n- 程序化生成可解的谜题\n- 难度调节旋钮\n- 可打印可玩',
  },
  {
    emoji: '📝',
    label: '数字花园',
    idea: '一个数字花园 / 个人维基。\n\n- 互相链接的原子笔记\n- 随时间生长，永无“完成”\n- 公开发布公开部分',
  },
  {
    emoji: '🛰️',
    label: 'API 封装',
    idea: '为常用的 API 做干净封装。\n\n- 类型化客户端 + 合理默认值\n- 每个端点一个示例\n- 发布它',
  },
  {
    emoji: '🏋️',
    label: '健身计划',
    idea: '健身计划 / 记录工具。\n\n- 制定每周训练拆分\n- 手机上快速记录组数\n- 跟踪数月进步',
  },
  {
    emoji: '🧠',
    label: '记忆卡片',
    idea: '间隔重复记忆卡片应用。\n\n- 快速收录卡片\n- 简单 SM-2 调度\n- 每天 5 分钟复习',
  },
  {
    emoji: '✍️',
    label: '剧本创作',
    idea: '一部短片剧本。\n\n- 一句话梗概 → 节拍 → 场景\n- 规范格式，无干扰\n- 最终完成朗读版',
  },
  {
    emoji: '🔭',
    label: '边学边做',
    idea: '用项目学会一直回避的东西。\n\n- 最小真实项目就能学会它\n- 记录每个坑的笔记\n- 成功后写篇总结',
  },
];

/** 随机 handful（对齐 Hermes randomIdeaTemplates count=6） */
export function randomIdeaTemplates(count = 6): ProjectIdeaTemplate[] {
  const pool = [...PROJECT_IDEA_TEMPLATES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}
