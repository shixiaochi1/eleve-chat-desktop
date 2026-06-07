# TS 类型治理计划 — 移除 @ts-nocheck + 收紧 :any

> 创建时间: 2026-06-07
> 前置条件: JS→TS 迁移已完成，tsc 零错误，Vite 构建通过

## 当前状态

| 指标 | 数量 |
|------|------|
| @ts-nocheck 文件 | 31 |
| `: any` 使用 | 143 |
| strict: true | 已开启（但 @ts-nocheck 文件不受约束） |

## 核心发现

**@ts-nocheck 的连锁效应**: UI 基元有 @ts-nocheck → 类型信息丢失 → Settings 等消费者也被迫加 @ts-nocheck。修复上游基元后，下游自动解锁。

## 执行计划

### P0: 立即可做（零/极少修改，移除即过）

| # | 文件 | @ts-nocheck 错误数 | 修复方式 |
|---|------|-------------------|----------|
| 1 | settings/AdvancedSettings | 0 | 删 @ts-nocheck |
| 2 | settings/AppearanceSettings | 0 | 删 @ts-nocheck |
| 3 | settings/ModelSettings | 0 | 删 @ts-nocheck |
| 4 | settings/ProviderSettings | 0 | 删 @ts-nocheck |
| 5 | ui/disclosure-caret | 1 | 补1处类型 |
| 6 | ui/button | 1 | 补1处类型 |

**预期**: 移除 6 个 @ts-nocheck，tsc 保持零错误

### P1: 简单 UI 基元（5个错误以内，10分钟/个）

| # | 文件 | 错误数 | 修复方式 |
|---|------|--------|----------|
| 7 | ui/braille-spinner | 2 | 补 props 类型 |
| 8 | ui/separator | 3 | 补 React 组件类型 |
| 9 | ui/switch | 5 | 修复 SwitchProps + onCheckedChange |
| 10 | ui/copy-button | 5 | 补 callback 类型 |
| 11 | ui/checkbox | 6 | 补 Radix 泛型约束 |

**预期**: 移除 5 个 @ts-nocheck。修复 switch 后解锁 SystemSettings(1错) + 5个下游消费者

### P2: 中等 UI 基元（5-15个错误，30分钟/个）

| # | 文件 | 错误数 | 修复方式 |
|---|------|--------|----------|
| 12 | ui/tabs | 9 | 补 TabsList/TabsTrigger 泛型 |
| 13 | ui/sidebar | 13 | 补 SidebarProvider context 类型 |
| 14 | ui/scroll-area | 14 | 补 ScrollArea props |
| 15 | ui/tooltip | 15 | 补 TooltipProvider 类型 |

**预期**: 移除 4 个 @ts-nocheck。修复 tabs 后解锁部分 Settings 下游

### P3: 复杂 UI 基元（20+个错误，1小时/个）

| # | 文件 | 错误数 | 修复方式 |
|---|------|--------|----------|
| 16 | ui/dialog | 23 | DialogContent/Overlay Radix 泛型 |
| 17 | ui/sheet | 24 | SheetContent 方向泛型 |
| 18 | ui/select | 29 | SelectItem/SelectValue 泛型推导 |
| 19 | ui/context-menu | 32 | ContextMenu 复合组件泛型 |
| 20 | ui/dropdown-menu | 50 | 最复杂，DropdownMenu 复合泛型 |

**预期**: 移除 5 个 @ts-nocheck。修复 dialog 后解锁 PasswordDialog

### P4: Settings 下游清理（上游 P1-P3 修复后）

| # | 文件 | 错误数 | 依赖 |
|---|------|--------|------|
| 21 | settings/ChatSettings | 1 | 无 |
| 22 | settings/SystemSettings | 1 | P1 switch |
| 23 | settings/WorkspaceSettings | 1 | 无 |
| 24 | settings/VoiceSettings | 2 | 无 |
| 25 | settings/MemorySettings | 3 | 无 |
| 26 | settings/SafetySettings | 6 | P1 switch |
| 27 | settings/GatewaySettings | 6 | 无 |
| 28 | settings/MCPSettings | 34 | P2-P3 多个UI基元 |

### P5: 业务组件（上游全部修复后）

| # | 文件 | 行数 | 说明 |
|---|------|------|------|
| 29 | PasswordDialog | 131 | 依赖 P3 dialog |
| 30 | KanbanPanel | 2349 | 最复杂，分阶段拆解 |

### P6: 收紧 `: any`（143处 → 目标 <30）

按文件 any 密度排序，优先处理高频文件：

| 优先级 | 文件 | any数 | 策略 |
|--------|------|-------|------|
| 🔴 | SettingsPanel | 12 | API 响应定义接口 |
| 🔴 | SkillsPanel | 11 | skill 数据结构类型化 |
| 🔴 | App.tsx | 10 | monitorState/debugState 已有类型，补全引用 |
| 🔴 | useModels | 9 | API 响应定义 ModelsResponse 接口 |
| 🟡 | CronPanel | 7 | cron 数据结构类型化 |
| 🟡 | DebugPanel | 6 | debug event 类型化 |
| 🟡 | useChannels | 5 | channel 数据类型化 |
| 🟡 | ModelSelector | 5 | 死代码，可删除 |
| 🟡 | MessageContainer | 5 | virtualizer 类型细化 |
| 🟢 | 其余 30+文件 | 1-4 | 逐个收紧 |

## 执行纪律

1. **每完成一个 Phase，跑 tsc --noEmit + vite build 验证**
2. **P0-P1 可批量执行；P2-P3 逐个文件修**
3. **KanbanPanel 最后处理，可能需先拆分再补类型**
4. **修复上游 UI 基元后，立即检查下游 Settings 是否自动解锁**
5. **不追求一步到位，每个 Phase 独立可交付**

## 里程碑

- **P0 完成**: @ts-nocheck 31→25，any 不变
- **P1 完成**: @ts-nocheck 25→20，any ~-10
- **P2 完成**: @ts-nocheck 20→16
- **P3 完成**: @ts-nocheck 16→11，PasswordDialog 解锁
- **P4 完成**: @ts-nocheck 11→3（仅 KanbanPanel + 2个复杂Settings）
- **P5 完成**: @ts-nocheck 0
- **P6 完成**: any 143→<30
