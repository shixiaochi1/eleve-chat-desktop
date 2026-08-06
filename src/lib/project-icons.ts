/**
 * 项目外观图标（对齐 Hermes PROJECT_ICONS 28 个 codicon 名 → lucide 映射）
 *
 * Hermes 侧图标是 codicon 名（'folder-library' 等），后端 projects.icon 存
 * 同名字符串；ELEVE 用 lucide-react，这里建 28 项一一映射 + 键列表。
 * 展示逻辑（对齐 Hermes projectIcon）：有 icon → 图标（按 color 着色）；
 * 无 icon 有 color → 纯色点；都无 → 默认 folder-library 语义（FolderGit）。
 */
import {
  BookOpen, Bug, Cloud, Database, Flame, FlaskConical, FolderGit, Gift, GitBranch,
  Globe, Heart, Home, KeyRound, LayoutDashboard, Lightbulb, Monitor, Network,
  Package, Radio, Rocket, Shield, Smartphone, Star, Target, Telescope, Terminal,
  Wrench, Zap,
  type LucideIcon,
} from 'lucide-react';

/** Hermes PROJECT_ICONS 同名键（后端存储值 = 此键） */
export const PROJECT_ICON_KEYS: string[] = [
  'folder-library', 'repo', 'rocket', 'beaker', 'flame', 'star-full', 'heart', 'zap',
  'target', 'lightbulb', 'tools', 'device-desktop', 'device-mobile', 'terminal',
  'dashboard', 'globe', 'broadcast', 'cloud', 'database', 'package', 'book',
  'organization', 'bug', 'shield', 'key', 'gift', 'telescope', 'home',
];

/** codicon 键 → lucide 图标 */
export const PROJECT_ICONS: Record<string, LucideIcon> = {
  'folder-library': FolderGit,
  repo: GitBranch,
  rocket: Rocket,
  beaker: FlaskConical,
  flame: Flame,
  'star-full': Star,
  heart: Heart,
  zap: Zap,
  target: Target,
  lightbulb: Lightbulb,
  tools: Wrench,
  'device-desktop': Monitor,
  'device-mobile': Smartphone,
  terminal: Terminal,
  dashboard: LayoutDashboard,
  globe: Globe,
  broadcast: Radio,
  cloud: Cloud,
  database: Database,
  package: Package,
  book: BookOpen,
  organization: Network,
  bug: Bug,
  shield: Shield,
  key: KeyRound,
  gift: Gift,
  telescope: Telescope,
  home: Home,
};

/** 未知/未设置时的默认图标（Hermes folder-library 语义） */
export const PROJECT_DEFAULT_ICON: LucideIcon = FolderGit;

/** 取图标组件；未知键回退默认 */
export function projectIconFor(key?: string | null): LucideIcon {
  return (key && PROJECT_ICONS[key]) || PROJECT_DEFAULT_ICON;
}
