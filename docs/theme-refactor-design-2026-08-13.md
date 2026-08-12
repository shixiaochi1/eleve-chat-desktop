# ELEVE 主题系统重构设计文档

**日期**: 2026-08-13  
**目标**: 照搬 macOS 主题系统架构，清理所有独立颜色配置

---

## 一、macOS 主题系统核心设计

macOS 的主题系统只有 **2 个用户可控参数**：

```
┌─────────────────────────────────────┐
│  用户选择（仅 2 个）                  │
│                                     │
│  1. Appearance: Light / Dark / Auto │
│  2. Accent Color: 8 预设 + 自定义    │
│                                     │
│  系统自动派生所有颜色                 │
└─────────────────────────────────────┘
```

**派生规则**：
- 背景色、文字色、边框色 → 由 Appearance（明暗）决定
- 主色（primary）、焦点环（ring）→ = Accent Color
- 高亮色、选中色 → = Accent Color 淡化
- 语义色（红/绿/黄/蓝）→ 跟随明暗微调亮度

**关键原则**：
1. **单一真相源**：只有 accent + appearance 两个参数
2. **全部派生**：没有任何手写颜色值
3. **明暗独立**：Light/Dark 是独立维度，不是主题的一部分

---

## 二、当前 ELEVE 的问题

### 2.1 架构混乱

```
当前状态（3 套系统并存）：
├── 10 套预设主题（presets.ts）     ← 每套手写 20+ 颜色值
├── macOS 强调色（macos-accents.ts） ← 从 1 个颜色派生
└── 自定义颜色覆盖（customColors）   ← 逐变量微调
```

**问题**：
- 10 套预设主题 = 200+ 个手写颜色值，维护成本高
- 预设主题和 macOS 强调色并存，用户困惑
- 自定义颜色覆盖破坏了派生逻辑
- 组件中有大量硬编码颜色，脱离主题系统

### 2.2 硬编码颜色分布

| 文件 | 问题 | 优先级 |
|------|------|--------|
| `ErrorBoundary.tsx` | 错误页面完全硬编码 | P0 |
| `DebugPanel.tsx` | 事件颜色硬编码 | P0 |
| `GridModeView.tsx` | Agent 卡片独立颜色系统 | P0 |
| `SessionWindowApp.tsx` | 重复的卡片颜色逻辑 | P0 |
| `ProjectTreePanel.tsx` | 默认项目颜色硬编码 | P1 |
| `ThemePanel.tsx` | 回退色硬编码 | P1 |
| `code-editor-theme.ts` | 代码编辑器独立色板 | P1 |
| `ChannelsPanel.tsx` | 平台品牌色（合理保留） | P2 |

---

## 三、新架构设计

### 3.1 数据模型

```typescript
// 用户可控参数（只有 2 个）
interface ThemeSettings {
  accent: string        // 强调色 hex（默认 '#007AFF'）
  appearance: 'light' | 'dark' | 'auto'  // 外观模式（默认 'auto'）
}

// 派生结果（全部自动计算）
interface DerivedColors {
  // 背景层
  background: string
  foreground: string
  card: string
  cardForeground: string
  popover: string
  popoverForeground: string
  
  // 主色层
  primary: string           // = accent
  primaryForeground: string // 自动计算可读性
  secondary: string         // = accent 淡化
  secondaryForeground: string
  accent: string            // = accent 淡化（选中态）
  accentForeground: string
  
  // 边框层
  border: string
  input: string
  ring: string              // = accent
  
  // 语义层
  destructive: string
  destructiveForeground: string
  
  // 侧边栏
  sidebarBackground: string
  sidebarBorder: string
  
  // 气泡
  userBubble: string
  userBubbleBorder: string
}
```

### 3.2 派生逻辑

```typescript
function deriveColors(accent: string, isDark: boolean): DerivedColors {
  if (isDark) {
    return {
      background: '#1C1C1E',
      foreground: '#F5F5F7',
      card: '#2C2C2E',
      cardForeground: '#F5F5F7',
      // ...
      primary: accent,
      primaryForeground: getReadableOn(accent),
      secondary: mix(accent, '#1C1C1E', 0.18),
      // ...
    }
  } else {
    return {
      background: '#F5F5F7',
      foreground: '#1D1D1F',
      card: '#FFFFFF',
      cardForeground: '#1D1D1F',
      // ...
      primary: accent,
      primaryForeground: getReadableOn(accent),
      secondary: mix(accent, '#FFFFFF', 0.12),
      // ...
    }
  }
}
```

### 3.3 文件结构

```
src/themes/
├── types.ts              # 类型定义（简化）
├── derive.ts             # 核心派生逻辑（新）
├── accents.ts            # 预设强调色（原 macos-accents.ts 重命名）
├── context.tsx           # 主题上下文（简化）
└── index.ts              # 导出（简化）

删除：
├── presets.ts            # 删除 10 套预设
```

### 3.4 持久化

```yaml
# config.yaml
display:
  accent: '#007AFF'       # 强调色
  appearance: 'auto'      # 'light' | 'dark' | 'auto'
```

**迁移策略**：
- 旧 `display.skin` 字段 → 映射到新字段
- 如果 skin 是 'default' → accent='#007AFF', appearance='light'
- 如果 skin 是 'midnight' → accent='#AF52DE', appearance='dark'
- 其他预设 → 提取最接近的 accent 色

### 3.5 后端影响

| 文件 | 改动 |
|------|------|
| `config_service.rs` | 默认配置改为 `accent: '#007AFF'`, `appearance: 'auto'` |
| `config_service.rs` | 删除 `display.skin` 的元数据，新增 `display.accent` + `display.appearance` |
| `commands.rs` | `/skin` 命令改为 `/accent` + `/appearance` |
| `lib.rs` | `SkinChanged` 事件改为 `ThemeChanged { accent, appearance }` |
| `ws/mod.rs` | WebSocket 事件更新 |

---

## 四、实施计划

### Phase 1: 核心架构（前端）

1. 新建 `derive.ts` — 核心派生逻辑
2. 重写 `context.tsx` — 只管理 accent + appearance
3. 重写 `ThemePanel.tsx` — 简化 UI
4. 删除 `presets.ts` — 移除 10 套预设
5. 更新 `index.ts` — 简化导出

### Phase 2: 修复硬编码（前端）

6. 修复 `ErrorBoundary.tsx` — 使用 CSS 变量
7. 修复 `DebugPanel.tsx` — 使用语义色变量
8. 统一 `GridModeView.tsx` + `SessionWindowApp.tsx` — 提取公共卡片颜色模块
9. 修复 `ProjectTreePanel.tsx` — 使用主题变量
10. 修复 `ThemePanel.tsx` — 使用主题变量

### Phase 3: 后端适配

11. 更新 `config_service.rs` — 新配置字段
12. 更新 `commands.rs` — 新命令
13. 更新 `lib.rs` — 新事件
14. 更新 `ws/mod.rs` — 新 WebSocket 事件
15. 迁移逻辑：旧 skin → 新 accent + appearance

### Phase 4: CSS 清理

16. 清理 `style.css` 硬编码颜色
17. 统一阴影系统

---

## 五、风险与决策

### 5.1 用户影响

**失去**：
- 10 套预设主题（Midnight、Ember、Cyberpunk...）
- 逐变量自定义颜色能力

**获得**：
- macOS 式的简洁体验
- 一致的颜色系统
- 更少的维护成本

### 5.2 迁移兼容性

**方案 A**：硬迁移
- 旧 skin 字段直接删除
- 用户需要重新选择 accent + appearance
- 简单但用户体验差

**方案 B**：软迁移（推荐）
- 旧 skin 映射到新 accent + appearance
- 用户无感知
- 需要维护映射表

### 5.3 Glass 主题处理

Glass 主题有特殊的毛玻璃效果，不是简单的颜色派生。

**方案**：
- 保留 Glass 作为特殊的 appearance 模式
- `appearance: 'light' | 'dark' | 'auto' | 'glass'`
- Glass 模式下使用半透明背景 + backdrop-filter

---

## 六、待确认

1. **Glass 主题**：保留为 appearance 模式，还是删除？
2. **代码编辑器主题**：独立选择，还是跟随主主题？
3. **迁移策略**：硬迁移（简单）还是软迁移（兼容）？
4. **CLI 命令**：`/skin` 改为 `/accent` + `/appearance`，还是保留 `/skin` 但改行为？

---

**文档版本**: v1.0  
**状态**: 待老大确认
