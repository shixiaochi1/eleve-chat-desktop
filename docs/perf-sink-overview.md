# 前端下沉架构分析 — 深度审查版

> **日期**: 2026-08-13 (v3 深度审查版)
> **背景**: 毛玻璃效果下沉到 Tauri/Rust 后，全面评估前端可下沉模块。
> **目标**: 提高性能、管理内存、降低前端复杂度。
> **原则**: 
> - 前端 = 视图层（渲染+交互）；Rust = 系统层（文件/进程/窗口/持久化）
> - **单一真相源：后端 eleved（Gateway），Tauri 壳不重复持有业务数据**
> - 严禁重复造轮子，严禁功能遗失
> - 架构干净整洁合理，符合 Rust 哲学

---

## 当前系统架构总览

```
┌──────────────────────────────────────────────────────────┐
│  Tauri 壳 (Rust)                                          │
│                                                          │
│  已实现的职责：                                            │
│  • 窗口管理（decorations, transparent, Mica 效果）         │
│  • eleved 子进程启动 + 生命周期监控                        │
│  • 端口发现（gateway_state.json 轮询）                     │
│  • 系统托盘 + 菜单                                        │
│  • PTY 终端管理（pty.rs）                                  │
│  • 剪贴板操作（clipboard.rs）                              │
│  • 预览控制台（preview_console.rs）                        │
│  • 文件监听（preview_file_watch.rs）                       │
│  • 预览 Webview（preview_webview.rs）                      │
│  • Kanban 窗口管理                                         │
│                                                          │
│  未实现的职责：                                            │
│  • Git 操作（前端用 execa spawn git 子进程）               │
│  • 配置持久化（前端用 LocalStorage）                       │
│  • 文件系统监控（前端无，后端 WS files.list 按需拉取）      │
│  • 主题窗口效果（已实现 Mica/Acrylic）                     │
│                                                          │
│  IPC Commands（7 个）：                                    │
│  1. get_gateway_port      — 端口发现                      │
│  2. get_auto_start        — 开机自启查询                   │
│  3. set_auto_start        — 开机自启设置                   │
│  4. set_window_effect     — 窗口毛玻璃效果                 │
│  5. create_deepseek_webview — DeepSeek 子窗口              │
│  6. toggle_kanban_window  — 看板窗口切换                   │
│  7. mark_restarting       — 标记重启                       │
└─────────────────────┬────────────────────────────────────┘
                      │
┌─────────────────────┼────────────────────────────────────┐
│  前端 (React/TypeScript)  257 文件        │
│                                                          │
│  当前持有的业务逻辑（应下沉的候选）：                       │
│  • Git 操作（lib/git.ts）→ spawn 子进程                   │
│  • 配置持久化（utils/storage.ts）→ LocalStorage           │
│  • 主题派生（themes/derive.ts）→ HSL/RGB 计算              │
│  • 消息流状态（hooks/useMessageStream.ts 1297 行）        │
│  • SSE 事件处理（hooks/useSSE.ts 836 行）                  │
│  • 文件树状态（hooks/useFileTree.ts 297 行）              │
│  • 终端缓冲区（store/terminal-buffer.ts）                  │
│  • Markdown 渲染（lib/markdown.ts）                       │
│  • 日志查看（lib/logs.ts）                                │
│                                                          │
│  前端数据流向：                                            │
│  前端 ←── WebSocket ──→ 后端 eleved (Gateway)              │
│  前端 ←── IPC (Tauri) ──→ Tauri 壳 (Rust)                │
│  注意：SSE/WS 不经过 Tauri 壳                              │
└──────────────────────────────────────────────────────────┘
                      │
┌─────────────────────┼────────────────────────────────────┐
│  后端 eleved (Rust Gateway)                                │
│                                                          │
│  已实现的职责：                                            │
│  • Agent 对话循环（session）                               │
│  • 工具执行（tools）                                       │
│  • 文件系统操作（ws files.list, files.diff, files.read）   │
│  • Git 操作（ws files.status, files.commit, files.branch） │
│  • 配置管理（config.yaml）                                 │
│  • 会话持久化（SQLite sessions.db）                        │
│  • 技能/记忆/Profile 管理                                  │
│                                                          │
│  WS 通道事件（部分）：                                     │
│  • files.list       — 目录列表（文件树唯一数据源）          │
│  • files.diff       — Git diff                            │
│  • files.read       — 文件读取                            │
│  • files.search     — 文件搜索                            │
│  • conversation.*   — 对话流                              │
│  • run.start/complete — 运行状态                           │
│  • config.get/update — 配置读写                            │
└──────────────────────────────────────────────────────────┘
```

## 关键发现：后端已经持有的能力

**`files.list`（ws/mod.rs L3281-3343）**：
- 后端已经用 `std::fs::read_dir` 扫描目录
- 已经实现了 `FILES_ALWAYS_EXCLUDED` 硬排除
- 已经实现了 gitignore 过滤（`files_gitignore_matcher`）
- 已经实现了 symlink 跟随判断（`std::fs::metadata` 跟随）
- 已经实现了目录优先 + 字母序排序
- **性能瓶颈**：`std::fs::read_dir` 是同步阻塞调用，在大目录下可能慢

**`files.status` / `files.commit` 等 Git 操作**：
- 后端 eleved Gateway 已经有 Git 相关 WS 端点
- 但实现方式可能是 spawn `git` 子进程（需进一步确认）

**结论**：很多"前端下沉"的工作，后端已经做了。**Tauri 壳不应该重复后端已实现的能力**。

---

## v1/v2 方案审查 — 逐条核实

### ❌ 文件树下沉 — 不成立

| 维度 | v1/v2 判断 | 实际代码 | 结论 |
|------|------------|----------|------|
| 递归扫描 | "JS 递归扫描卡死主线程" | 前端调 `call('files_list')`，后端用 `std::fs::read_dir` | **诊断错误**。前端无扫描。瓶颈在后端 `read_dir`（同步阻塞）。 |
| 缓存管理 | "4 个 state 状态爆炸" | 竞态守卫 + 定向刷新是真实需求（项目切换/文件变更） | **不是问题**。这是合理的状态管理，下沉只会转移复杂度。 |
| 性能瓶颈 | "前端扫描慢" | 后端 `read_dir` 全量读取大目录 | **瓶颈在后端**。需要优化后端 `files.list`，不是前端下沉。 |

**正确做法**：
1. 后端 `files.list` 用 `ignore::WalkBuilder` 替换 `std::fs::read_dir`（异步 + 智能过滤）
2. 前端保持现有架构，优化虚拟列表渲染

### ❌ 消息流下沉 — 不成立

| 维度 | v1/v2 判断 | 实际代码 | 结论 |
|------|------------|----------|------|
| DOM Patch | "Rust Diff → 前端直接 DOM 操作" | 违反 React 范式，与虚拟 DOM 冲突 | **方案错误**。会导致 UI 混乱。 |
| SQLite 存储 | "Tauri 壳存消息到 SQLite" | 后端 eleved 已持有所有消息（SQLite sessions.db） | **重复建设**。违反单一真相源。 |
| SSE 解析 | "Rust 结构化解析 SSE" | SSE 是前端 ↔ 后端 WS 直连，不经过 Tauri 壳 | **架构代价过大**。改通信架构代价 >> 收益。 |

**正确做法**：
1. 前端优化：`React.memo` + `useSelector` 精细化订阅，减少重渲染范围
2. 每个 Token 的 state 更新改为引用追加（不是全量 clone）
3. 长消息列表用虚拟列表（react-window）

### ✅ Git 操作下沉 — 成立，但有前提

| 维度 | v1/v2 判断 | 实际代码 | 结论 |
|------|------------|----------|------|
| 前端 spawn | "simple-git spawn 子进程" | 前端 `lib/git.ts` 用 `execa('git', [...])` | **正确**。每次操作 fork 进程。 |
| 后端也有 | — | 后端 eleved 也有 Git WS 端点 | **需要确认**：后端 Git 操作是 spawn 还是 git2？ |
| Tauri 壳做 | "Rust git2 原生绑定" | 可行，且 Tauri 壳已有子进程管理基础设施 | **成立**。但需确保与后端不冲突。 |

**前提条件**：
1. 先确认后端 eleved 的 Git 实现方式
2. 如果后端已用 git2，Tauri 壳不需要重复
3. 如果后端 spawn 子进程，**优先优化后端**，其次才是 Tauri 壳

### ⚠️ 配置持久化下沉 — 部分成立

| 维度 | 判断 | 结论 |
|------|------|------|
| LocalStorage | 同步读写阻塞主线程，大容量卡顿 | **成立** |
| 后端配置 | 后端已有 `config.yaml` + WS `config.get/update` | **前端 LocalStorage 是缓存**，真相源在后端 |
| 下沉方案 | Rust 原子写入 + 热重载监听 | **成立**，但需与后端配置协调 |

**正确做法**：Tauri 壳管前端 UI 配置（窗口大小、面板位置、主题偏好），后端管业务配置（模型、Agent、Profile）。

---

## 修正后下沉方案

### 🔴 P0 — 必须下沉（Rust 天然优势，无重复建设）

#### P0-1：Git 操作下沉到 Tauri 壳

**前提**：确认后端 eleved 的 Git 实现方式。如果后端已用 git2 且性能 OK，则跳过。

**如果后端 spawn 子进程**：
- 后端优先优化（改 git2）
- Tauri 壳不需要重复（前端通过 WS 调后端）

**如果前端有独立 Git 需求**（不经过后端的本地 Git 操作）：
- Tauri 壳实现 `git2` 原生绑定
- IPC 暴露给前端

#### P0-2：配置持久化下沉

- **前端 UI 配置**（窗口大小、面板状态、主题偏好）→ Rust 原子写入文件系统
- **后端业务配置**（模型、Agent、Profile）→ 保持后端 `config.yaml`
- 两者不重复，各司其职

### 🟠 P1 — 应该优化（不改架构，优化实现）

#### P1-1：消息流渲染优化（前端层面）

- 不用下沉，在 React 层优化
- `React.memo` 精细化重渲染
- Zustand `useSelector` 按需订阅
- 虚拟列表（react-window）

#### P1-2：后端 `files.list` 优化

- 后端 `std::fs::read_dir` → `ignore::WalkBuilder`
- 异步非阻塞
- 智能过滤（gitignore + 隐藏文件 + 大小限制）

### 🟡 P2 — 可下沉（架构优化，收益中等）

#### P2-1：文件系统监控（新增能力）

- Rust `notify` crate 监听文件变更
- 主动推送给前端（不是前端轮询）
- 前端只渲染变更通知

#### P2-2：日志查看下沉

- Rust 按需读取（Offset/Limit）
- 不加载全文件

#### P2-3：Markdown 预渲染

- Rust `comrak` 预渲染 HTML
- 前端直插 innerHTML

---

## 执行路线图

```
Phase 1: 确认后端 Git 实现方式（后端 eleved Gateway）
         ↓
Phase 2: 配置持久化下沉（前端 UI 配置 → Rust 文件系统）
         ↓
Phase 3: 后端 files.list 优化（read_dir → WalkBuilder）
         ↓
Phase 4: 消息流渲染优化（React 层面，不下沉）
         ↓
Phase 5: 文件系统监控（Rust notify → 前端推送）
```

## 下沉决策矩阵

| 模块 | 是否下沉 | 下沉到哪里 | 理由 |
|------|----------|------------|------|
| 窗口效果（Mica） | ✅ 已下沉 | Tauri 壳 | 系统级 API，Rust 天然优势 |
| Git 操作 | ⏳ 待确认 | 后端 或 Tauri 壳 | 先确认后端实现方式 |
| 配置持久化 | ✅ 是 | Tauri 壳（UI 配置） | LocalStorage 阻塞主线程 |
| 文件树 | ❌ 否 | 后端优化 | 前端无扫描，瓶颈在后端 |
| 消息流 | ❌ 否 | 前端优化 | 后端已持有数据，下沉=重复 |
| SSE 处理 | ❌ 否 | 前端优化 | 不经过 Tauri 壳，改造价太大 |
| 终端缓冲区 | ✅ 部分 | Tauri 壳（PTY 管理） | 已有 pty.rs，优化缓冲区 |
| 文件监控 | ✅ 是 | Tauri 壳（新增） | notify crate，前端只渲染 |
| 日志查看 | ✅ 是 | Tauri 壳 | 按需读取，不加载全文件 |
| Markdown | ✅ 是 | Tauri 壳 | comrak 预渲染 |
