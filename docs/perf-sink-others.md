# P3 — 其他可下沉模块

## 1. 配置持久化下沉 ✅

### 当前问题

- **位置**: `utils/storage.ts` + `utils/settings-store.ts`
- **问题**:
  - LocalStorage 同步读写阻塞主线程（大容量时 `setItem` ~5ms+）
  - 无并发安全，无自动恢复
  - `storage.load()` / `storage.save()` 封装简单，无 schema 验证

### 下沉方案

**架构原则**：
- Tauri 壳管**前端 UI 配置**（窗口大小、面板位置、主题偏好）
- 后端管**业务配置**（模型、Agent、Profile、Gateway）
- 两者不重复，各司其职

```rust
// crates/eleve-desktop/src/config.rs

use serde::{Serialize, Deserialize};
use std::path::PathBuf;

/// 前端 UI 配置（Tauri 壳管理）
#[derive(Serialize, Deserialize, Default)]
pub struct UiConfig {
    pub window: WindowConfig,
    pub panels: PanelConfig,
    pub theme: ThemeConfig,
}

#[derive(Serialize, Deserialize, Default)]
pub struct WindowConfig {
    pub width: u32,
    pub height: u32,
    pub is_maximized: bool,
}

#[derive(Serialize, Deserialize, Default)]
pub struct PanelConfig {
    pub left_panel_width: u32,
    pub right_panel_width: u32,
    pub left_panel_visible: bool,
    pub right_panel_visible: bool,
}

#[derive(Serialize, Deserialize, Default)]
pub struct ThemeConfig {
    pub accent: String,
    pub appearance: String,
}

/// 配置存储（原子写入 + 自动恢复）
pub struct ConfigStore {
    path: PathBuf,
}

impl ConfigStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// 读取配置（带自动恢复）
    pub fn load(&self) -> Result<UiConfig> {
        match std::fs::read_to_string(&self.path) {
            Ok(content) => {
                let config: UiConfig = serde_json::from_str(&content)?;
                Ok(config)
            }
            Err(_) => {
                // 尝试从 .bak 恢复
                let bak = self.path.with_extension("bak");
                if bak.exists() {
                    let content = std::fs::read_to_string(&bak)?;
                    let config: UiConfig = serde_json::from_str(&content)?;
                    eprintln!("[Config] Recovered from backup");
                    Ok(config)
                } else {
                    eprintln!("[Config] No config found, using defaults");
                    Ok(UiConfig::default())
                }
            }
        }
    }

    /// 原子写入（写临时文件 → rename）
    pub fn save(&self, config: &UiConfig) -> Result<()> {
        // 先备份
        if self.path.exists() {
            let bak = self.path.with_extension("bak");
            let _ = std::fs::copy(&self.path, &bak);
        }

        // 原子写入
        let tmp = self.path.with_extension("tmp");
        let content = serde_json::to_string_pretty(config)?;
        std::fs::write(&tmp, content)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}

/// IPC Commands
#[tauri::command]
pub async fn get_ui_config(store: tauri::State<'_, ConfigStore>) -> Result<UiConfig> {
    store.load()
}

#[tauri::command]
pub async fn set_ui_config(
    store: tauri::State<'_, ConfigStore>,
    config: UiConfig,
) -> Result<()> {
    store.save(&config)
}
```

### 预期收益

| 指标 | 当前 | 优化后 | 改善 |
|------|------|--------|------|
| 配置读写 | ~5ms+（同步阻塞） | <1ms（异步） | **5x** |
| 配置损坏 | 数据丢失 | 自动恢复（.bak） | **可靠性提升** |
| 主线程阻塞 | 有 | 无 | **消除** |

---

## 2. 文件系统监控（新增能力）✅

### 当前问题

- **前端无文件监控能力**
- `useFileTree.ts` 通过 `invalidate()` 定向刷新，但需要外部触发（workspace tick）
- 文件变更无法实时推送

### 下沉方案

```rust
// crates/eleve-desktop/src/file_watch.rs

use notify::{RecommendedWatcher, Watcher, RecursiveMode, Event, EventKind};
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::sync::mpsc;
use tauri::Emitter;

/// 文件监控服务
pub struct FileWatchService {
    watchers: HashMap<String, RecommendedWatcher>,
    tx: mpsc::Sender<FileEvent>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub enum FileEvent {
    Created { path: String },
    Modified { path: String },
    Deleted { path: String },
    Renamed { old_path: String, new_path: String },
}

impl FileWatchService {
    pub fn new(app: tauri::AppHandle) -> Self {
        let (tx, mut rx) = mpsc::channel::<FileEvent>(100);

        // 后台线程：接收文件事件 → 推送给前端
        tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                let _ = app.emit("file-changed", &event);
            }
        });

        Self {
            watchers: HashMap::new(),
            tx,
        }
    }

    /// 开始监控目录
    #[tauri::command]
    pub fn watch_directory(&mut self, path: String) -> Result<()> {
        if self.watchers.contains_key(&path) {
            return Ok(()); // 已监控
        }

        let tx = self.tx.clone();
        let path_buf = PathBuf::from(&path);

        let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            if let Ok(event) = res {
                let file_event = match event.kind {
                    EventKind::Create(_) => FileEvent::Created {
                        path: event.paths.first().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
                    },
                    EventKind::Modify(_) => FileEvent::Modified {
                        path: event.paths.first().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
                    },
                    EventKind::Remove(_) => FileEvent::Deleted {
                        path: event.paths.first().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
                    },
                    EventKind::Rename { .. } => {
                        // rename 事件可能有两个路径
                        let paths: Vec<_> = event.paths.iter()
                            .map(|p| p.to_string_lossy().to_string())
                            .collect();
                        if paths.len() == 2 {
                            FileEvent::Renamed { old_path: paths[0].clone(), new_path: paths[1].clone() }
                        } else {
                            FileEvent::Modified { path: paths.first().cloned().unwrap_or_default() }
                        }
                    }
                    _ => return,
                };
                let _ = tx.blocking_send(file_event);
            }
        })?;

        watcher.watch(&path_buf, RecursiveMode::Recursive)?;
        self.watchers.insert(path, watcher);

        Ok(())
    }

    /// 停止监控
    #[tauri::command]
    pub fn unwatch_directory(&mut self, path: String) -> Result<()> {
        self.watchers.remove(&path);
        Ok(())
    }
}
```

### 前端适配

```typescript
// hooks/useFileWatch.ts
export function useFileWatch(watchPaths: string[]) {
  useEffect(() => {
    // 开始监控
    for (const path of watchPaths) {
      call('watch_directory', { path });
    }

    // 监听文件变更
    const unlisten = listen('file-changed', (event) => {
      const { type, path } = event.payload;
      // 触发文件树刷新
      invalidateFileTree([path]);
    });

    return () => {
      unlisten.then(fn => fn());
      // 停止监控
      for (const path of watchPaths) {
        call('unwatch_directory', { path });
      }
    };
  }, [watchPaths]);
}
```

### 预期收益

| 指标 | 当前 | 优化后 | 改善 |
|------|------|--------|------|
| 文件变更感知 | 轮询/tick 触发 | 实时推送 | **<100ms 延迟** |
| 文件树刷新 | 全量重扫 | 定向刷新（只刷新变更目录） | **10x** |

---

## 3. 终端缓冲区下沉 ✅

### 当前问题

- **位置**: `TerminalPanel.tsx` + `store/terminal-buffer.ts` + `src-tauri/src/pty.rs`
- **问题**:
  - Tauri 壳已有 PTY 管理（`pty.rs`），但缓冲区全在 JS 内存
  - xterm.js 回滚历史多时内存飙升
  - 万行输出掉帧

### 下沉方案

**已有基础**：`src-tauri/src/pty.rs` 已有 PTY 启动/写入/读取/销毁命令。

**需要补充**：环形缓冲区管理

```rust
// crates/eleve-desktop/src/pty.rs（扩展现有模块）

use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::RwLock;

/// PTY 会话
pub struct PtySession {
    pub id: String,
    pub process: Box<dyn portable_ptty::PtyProcess>,
    /// 环形缓冲区（固定大小，内存恒定）
    pub buffer: PtyBuffer,
}

/// 环形缓冲区
pub struct PtyBuffer {
    lines: VecDeque<String>,
    max_lines: usize,
}

impl PtyBuffer {
    pub fn new(max_lines: usize) -> Self {
        Self {
            lines: VecDeque::with_capacity(max_lines),
            max_lines,
        }
    }

    pub fn push(&mut self, line: String) {
        self.lines.push_back(line);
        if self.lines.len() > self.max_lines {
            self.lines.pop_front();
        }
    }

    /// 获取可视区域
    pub fn viewport(&self, from_row: usize, count: usize) -> &[String] {
        let len = self.lines.len();
        if from_row >= len {
            &[]
        } else {
            let end = (from_row + count).min(len);
            &self.lines[from_row..end]
        }
    }
}
```

### 预期收益

| 指标 | 当前 | 优化后 | 改善 |
|------|------|--------|------|
| 终端内存 | O(历史行数) | O(固定缓冲区大小) | **恒定** |
| 万行日志 | 卡顿 | 流畅 | **10x** |
| 回滚操作 | 慢 | 瞬间 | **100x** |

---

## 4. 日志查看下沉 ✅

### 当前问题

- **位置**: `LogsPanel.tsx` + `lib/logs.ts`
- **问题**:
  - JS `FileReader` 一次性加载全量日志文件
  - GB 级日志直接 OOM
  - 搜索/过滤 O(N) 线性扫描

### 下沉方案

```rust
// crates/eleve-desktop/src/log_viewer.rs

use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};

pub struct LogViewer {
    file: File,
    line_offsets: Vec<u64>,  // 预索引行偏移
}

impl LogViewer {
    /// 预索引行偏移（一次性，快速）
    pub fn index(&mut self) -> Result<usize> {
        let mut reader = BufReader::new(&self.file);
        let mut offset = 0;
        let mut count = 0;

        loop {
            let consumed = reader.read_line(&mut String::new())?;
            if consumed == 0 { break; }
            self.line_offsets.push(offset);
            offset += consumed as u64;
            count += 1;
        }

        Ok(count)
    }

    /// 按需读取指定范围的行
    pub fn read_lines(&mut self, from: usize, count: usize) -> Result<Vec<String>> {
        if from >= self.line_offsets.len() {
            return Ok(vec![]);
        }

        let start_offset = self.line_offsets[from];
        self.file.seek(SeekFrom::Start(start_offset))?;

        let reader = BufReader::new(&self.file);
        Ok(reader.lines().take(count).filter_map(|l| l.ok()).collect())
    }

    /// 搜索
    pub fn search(&mut self, pattern: &str, max_results: usize) -> Result<Vec<usize>> {
        let mut results = Vec::new();
        let mut reader = BufReader::new(&self.file);
        reader.seek(SeekFrom::Start(0))?;

        let mut line_num = 0;
        for line in reader.lines() {
            let line = line?;
            if line.contains(pattern) {
                results.push(line_num);
                if results.len() >= max_results {
                    break;
                }
            }
            line_num += 1;
        }

        Ok(results)
    }
}
```

### 预期收益

| 指标 | 当前 | 优化后 | 改善 |
|------|------|--------|------|
| GB 级日志 | OOM | 秒开 | **可用** |
| 搜索速度 | O(N) JS 扫描 | O(N) Rust 扫描 | **5x** |
| 内存 | O(文件大小) | O(窗口大小) | **-99%** |

---

## 5. Markdown 预渲染 ⚠️

### 当前问题

- **位置**: `lib/markdown.ts`
- **问题**:
  - `markdown-it` / `remark` 在 JS 主线程解析长文本
  - 复杂表格/代码块渲染慢

### 下沉方案

```rust
// crates/eleve-desktop/src/markdown.rs

use comrak::{markdown_to_html, ComrakOptions};

#[tauri::command]
pub fn render_markdown(text: String) -> Result<String> {
    let mut options = ComrakOptions::default();
    options.extension.strikethrough = true;
    options.extension.table = true;
    options.extension.tasklist = true;
    options.extension.autolink = true;
    options.render.hardbreaks = true;

    Ok(markdown_to_html(&text, &options))
}
```

### 预期收益

| 指标 | 当前 | 优化后 | 改善 |
|------|------|--------|------|
| 渲染速度 | ~5ms/token | ~0.5ms/token | **10x** |
| 主线程阻塞 | 有 | 无 | **消除** |

**注意**：收益较小，优先级低。前端 `markdown-it` 性能已可接受。
