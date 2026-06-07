/**
 * Eleve 图标映射 — 统一管理所有 SVG 图标
 * 使用 lucide-react，细线条 SF Symbols 风格
 */
import {
  Zap,
  MessageCircle,
  Clock,
  Wrench,
  Terminal,
  Settings,
  Sun,
  Moon,
  Info,
  ArrowUp,
  Square,
  Menu,
  Copy,
  RefreshCw,
  Plus,
  X,
  Search,
  ArrowLeft,
  RotateCw,
  Power,
  ChevronRight,
  ChevronDown,
  Brain,
  Cpu,
  Circle,
  Check,
  Loader,
  Play,
  Pause,
  Pencil,
  Trash2,
  Folder,
  File,
  Package,
  Globe,
  History,
  Activity,
  Server,
  Users,
  Hash,
  Eye,
  EyeOff,
  Filter,
  Puzzle,
  User,
  BookOpen,
  BarChart3,
  LayoutGrid,
  List,
  Bot,
  Radio,
  Edit3,
  type LucideProps,
} from 'lucide-react';

/** 通用图标 props */
const ICON_SIZE_SM = 14;
const ICON_SIZE_MD = 18;
const ICON_SIZE_LG = 22;
const ICON_SIZE_XL = 28;

/** 通用 stroke 属性 — 统一细线条风格 */
const strokeProps = {
  strokeWidth: 1.5,
  absoluteStrokeWidth: true,
};

type IconComponent = React.ComponentType<LucideProps>;

// ── 导航图标 ──
export const BrandIcon: IconComponent = (props) => <Zap size={ICON_SIZE_LG} {...strokeProps} {...props} />;
export const ChatIcon: IconComponent = (props) => <MessageCircle size={ICON_SIZE_MD} {...strokeProps} {...props} />;
export const CronIcon: IconComponent = (props) => <Clock size={ICON_SIZE_MD} {...strokeProps} {...props} />;
export const ClockIcon: IconComponent = (props) => <Clock size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const MemoryIcon: IconComponent = (props) => <Brain size={ICON_SIZE_MD} {...strokeProps} {...props} />;
export const BrainIcon: IconComponent = (props) => <Brain size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const SkillsIcon: IconComponent = (props) => <Puzzle size={ICON_SIZE_MD} {...strokeProps} {...props} />;
export const DebugIcon: IconComponent = (props) => <Terminal size={ICON_SIZE_MD} {...strokeProps} {...props} />;
export const TerminalIcon: IconComponent = (props) => <Terminal size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const SettingsIcon: IconComponent = (props) => <Settings size={ICON_SIZE_MD} {...strokeProps} {...props} />;
export const AboutIcon: IconComponent = (props) => <Info size={ICON_SIZE_MD} {...strokeProps} {...props} />;

// ── 操作图标 ──
export const SendIcon: IconComponent = (props) => <ArrowUp size={ICON_SIZE_MD} {...strokeProps} {...props} />;
export const StopIcon: IconComponent = (props) => <Square size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const CommandMenuIcon: IconComponent = (props) => <Menu size={ICON_SIZE_MD} {...strokeProps} {...props} />;
export const CopyIcon: IconComponent = (props) => <Copy size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const RegenerateIcon: IconComponent = (props) => <RefreshCw size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const NewIcon: IconComponent = (props) => <Plus size={ICON_SIZE_MD} {...strokeProps} {...props} />;
export const DeleteIcon: IconComponent = (props) => <X size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const SearchIcon: IconComponent = (props) => <Search size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const BackIcon: IconComponent = (props) => <ArrowLeft size={ICON_SIZE_MD} {...strokeProps} {...props} />;
export const RetryIcon: IconComponent = (props) => <RotateCw size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const RestartIcon: IconComponent = (props) => <Power size={ICON_SIZE_SM} {...strokeProps} {...props} />;

// ── 主题图标 ──
export const ThemeDarkIcon: IconComponent = (props) => <Moon size={ICON_SIZE_MD} {...strokeProps} {...props} />;
export const ThemeLightIcon: IconComponent = (props) => <Sun size={ICON_SIZE_MD} {...strokeProps} {...props} />;

// ── UI 装饰图标 ──
export const ExpandIcon: IconComponent = (props) => <ChevronRight size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const CollapseIcon: IconComponent = (props) => <ChevronDown size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const ThinkingIcon: IconComponent = (props) => <Brain size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const ToolIcon: IconComponent = (props) => <Wrench size={ICON_SIZE_MD} {...strokeProps} {...props} />;
export const SmallToolIcon: IconComponent = (props) => <Wrench size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const ModelIcon: IconComponent = (props) => <Cpu size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const FallbackIcon: IconComponent = (props) => <RefreshCw size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const StatusDot: IconComponent = (props) => <Circle size={10} {...strokeProps} {...props} />;
export const DotIcon: IconComponent = (props) => <Circle size={8} fill="currentColor" strokeWidth={0} {...props} />;
export const CheckIcon: IconComponent = (props) => <Check size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const LoadingIcon: IconComponent = (props) => <Loader size={ICON_SIZE_SM} {...strokeProps} {...props} />;

// ── 操作扩展图标 ──
export const PlayIcon: IconComponent = (props) => <Play size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const PauseIcon: IconComponent = (props) => <Pause size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const PencilIcon: IconComponent = (props) => <Pencil size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const TrashIcon: IconComponent = (props) => <Trash2 size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const FolderIcon: IconComponent = (props) => <Folder size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const FileIcon: IconComponent = (props) => <File size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const PackageIcon: IconComponent = (props) => <Package size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const GlobeIcon: IconComponent = (props) => <Globe size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const HistoryIcon: IconComponent = (props) => <History size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const HashIcon: IconComponent = (props) => <Hash size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const EyeIcon: IconComponent = (props) => <Eye size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const EyeOffIcon: IconComponent = (props) => <EyeOff size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const FilterIcon: IconComponent = (props) => <Filter size={ICON_SIZE_SM} {...strokeProps} {...props} />;

// ── 网关面板图标 ──
export const ActivityIcon: IconComponent = (props) => <Activity size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const ServerIcon: IconComponent = (props) => <Server size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const UsersIcon: IconComponent = (props) => <Users size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const UserIcon: IconComponent = (props) => <User size={ICON_SIZE_SM} {...strokeProps} {...props} />;
export const BookOpenIcon: IconComponent = (props) => <BookOpen size={ICON_SIZE_SM} {...strokeProps} {...props} />;

// ── 用量分析图标 ──
export const UsageIcon: IconComponent = (props) => <BarChart3 size={ICON_SIZE_MD} {...strokeProps} {...props} />;

// ── 频道管理图标 ──
export const ChannelsIcon: IconComponent = (props) => <Radio size={ICON_SIZE_MD} {...strokeProps} {...props} />;

// ── 看板图标 ──
export const KanbanIcon: IconComponent = (props) => <LayoutGrid size={ICON_SIZE_MD} {...strokeProps} {...props} />;

// ── 大纲图标 ──
export const OutlineIcon: IconComponent = (props) => <List size={ICON_SIZE_MD} {...strokeProps} {...props} />;

// ── Agent 协作图标 ──
export const AgentIcon: IconComponent = (props) => <Users size={ICON_SIZE_MD} {...strokeProps} {...props} />;
export const BotIcon: IconComponent = (props) => <Bot size={ICON_SIZE_SM} {...strokeProps} {...props} />;

// ── 欢迎页大图标 ──
export const WelcomeIcon: IconComponent = (props) => <Zap size={48} strokeWidth={1} {...props} />;
export const Edit3Icon: IconComponent = (props) => <Edit3 size={ICON_SIZE_SM} {...strokeProps} {...props} />;
