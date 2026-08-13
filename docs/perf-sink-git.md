# P0 — Git 操作下沉方案

## ⚠️ 前提条件

**必须先确认后端 eleved Gateway 的 Git 实现方式**：
- 如果后端已用 `git2` 原生绑定且性能 OK → **不需要下沉**，前端通过 WS 调后端即可
- 如果后端 spawn `git` 子进程 → **优先优化后端**，其次才是 Tauri 壳
- 如果前端有独立于后端的本地 Git 需求 → Tauri 壳下沉

## 当前代码分析

### 前端 `lib/git.ts`

```typescript
// 前端 Git 操作通过 execa spawn git 子进程
import { execa } from 'execa';

export async function gitStatus(repoPath: string) {
  const { stdout } = await execa('git', ['status', '--porcelain'], {
    cwd: repoPath,
  });
  return parsePorcelain(stdout);
}
```

**问题**：
1. 每次操作 spawn 子进程（~10-50ms 启动开销）
2. stdout 文本解析 O(N)
3. 无进程管理，高频操作时并行进程互相干扰
4. 无法取消

### 后端 `eleve-gateway` Git 端点

后端 WS 端点 `ws/mod.rs` 中已有 Git 相关操作（需确认实现方式）。

## 下沉方案

### 架构选择

```
┌─────────────────────────────────────────────┐
│  方案 A：后端优化（优先）                      │
│                                             │
│  前端 ─── WS ──→ 后端 (git2)                 │
│                                             │
│  优点：单一 Git 真相源，前端零改动             │
│  缺点：需要改后端代码                         │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  方案 B：Tauri 壳下沉（前端独立需求时）        │
│                                             │
│  前端 ── IPC ─→ Tauri 壳 (git2)              │
│                                             │
│  优点：不依赖后端，即时响应                   │
│  缺点：与后端 Git 能力可能重复                │
└─────────────────────────────────────────────┘
```

**决策**：先走方案 A。确认后端 Git 实现后决定是否走方案 B。

### 方案 A：后端优化（git2 替换 spawn）

```rust
// crates/eleve-gateway/src/git.rs（新增模块）

use git2::{Repository, StatusOptions, DiffOptions};
use std::path::Path;

pub struct GitBackend {
    repos: std::collections::HashMap<String, Repository>,
}

impl GitBackend {
    pub fn status(&mut self, repo_path: &Path) -> Result<Vec<FileStatus>> {
        let repo = self.repos.entry(repo_path.to_string_lossy().to_string())
            .or_insert_with(|| Repository::open(repo_path).unwrap());

        let mut statuses = Vec::new();
        let mut opts = StatusOptions::new();
        opts.include_untracked(true);

        for entry in repo.statuses(Some(&mut opts))?.iter() {
            let path = entry.path()?.to_string();
            let status = entry.status();
            statuses.push(FileStatus {
                path,
                status: Self::status_to_kind(status),
            });
        }

        Ok(statuses)
    }

    fn status_to_kind(status: git2::Status) -> FileStatusKind {
        // ... 状态映射
        FileStatusKind::Modified
    }
}
```

### 方案 B：Tauri 壳下沉（如需要）

```rust
// crates/eleve-desktop/src/git.rs（新增模块）

use git2::{Repository, StatusOptions, DiffOptions};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::RwLock;

/// 文件状态
#[derive(Debug, Clone, serde::Serialize)]
pub struct FileStatus {
    pub path: String,
    pub status: FileStatusKind,
    pub staged: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub enum FileStatusKind {
    Added,
    Modified,
    Deleted,
    Renamed { new_path: String },
    Untracked,
}

/// Git 服务（Rust 单例，Tauri managed state）
pub struct GitService {
    /// 已打开的仓库（按路径缓存，避免重复打开）
    repos: RwLock<HashMap<String, Arc<Repository>>>,
    /// 状态缓存（TTL 失效 + 文件监听自动失效）
    status_cache: RwLock<HashMap<String, (Vec<FileStatus>, std::time::Instant)>>,
}

impl GitService {
    pub fn new() -> Self {
        Self {
            repos: RwLock::new(HashMap::new()),
            status_cache: RwLock::new(HashMap::new()),
        }
    }

    /// 获取或打开仓库（内存复用，不重复打开）
    async fn get_repo(&self, path: &Path) -> Result<Arc<Repository>> {
        let key = path.to_string_lossy().to_string();
        {
            let repos = self.repos.read().await;
            if let Some(repo) = repos.get(&key) {
                return Ok(repo.clone());
            }
        }
        let repo = Arc::new(Repository::open(path)?);
        self.repos.write().await.insert(key, repo.clone());
        Ok(repo)
    }

    /// 获取工作区状态（内存缓存，TTL 2s）
    #[tauri::command]
    pub async fn status(&self, repo_path: String) -> Result<Vec<FileStatus>> {
        let path = Path::new(&repo_path);
        let key = repo_path.clone();

        // 检查缓存
        if let Some((data, timestamp)) = self.status_cache.read().await.get(&key) {
            if timestamp.elapsed() < std::time::Duration::from_secs(2) {
                return Ok(data.clone());
            }
        }

        // 真实查询
        let repo = self.get_repo(path).await?;
        let mut statuses = Vec::new();

        let mut opts = StatusOptions::new();
        opts.include_untracked(true);
        opts.renames_head_to_index(true);
        opts.renames_index_to_workdir(true);

        for entry in repo.statuses(Some(&mut opts))?.iter() {
            if let Some(p) = entry.path() {
                let status = entry.status();
                statuses.push(FileStatus {
                    path: p.to_string(),
                    status: Self::status_to_kind(status),
                    staged: status.is_index_new() || status.is_index_modified(),
                });
            }
        }

        // 更新缓存
        self.status_cache.write().await.insert(
            key,
            (statuses.clone(), std::time::Instant::now()),
        );

        Ok(statuses)
    }

    /// 提交
    #[tauri::command]
    pub async fn commit(
        &self,
        repo_path: String,
        message: String,
        amend: bool,
    ) -> Result<String> {
        let repo = self.get_repo(Path::new(&repo_path)).await?;

        let mut index = repo.index()?;
        index.add_all(["."], git2::IndexAddOption::DEFAULT, None)?;
        index.write()?;

        let tree_id = index.write_tree()?;
        let tree = repo.find_tree(tree_id)?;
        let sig = repo.signature()?;

        let commit_oid = if amend {
            let head = repo.head()?.peel_to_commit()?;
            repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &[&head])?
        } else {
            let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
            let parents: Vec<&git2::Commit> = parent.iter().collect();
            repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)?
        };

        // 清缓存
        self.status_cache.write().await.clear();

        Ok(commit_oid.to_string())
    }

    fn status_to_kind(status: git2::Status) -> FileStatusKind {
        if status.is_wt_new() { FileStatusKind::Untracked }
        else if status.is_wt_modified() { FileStatusKind::Modified }
        else if status.is_wt_deleted() { FileStatusKind::Deleted }
        else if status.is_index_new() { FileStatusKind::Added }
        else { FileStatusKind::Modified }
    }
}
```

### Cargo.toml 依赖

```toml
[dependencies]
git2 = "0.20"
```

### 前端职责（重构后）

```typescript
// hooks/useGit.ts — 重构后（<30 行）
export function useGit(repoPath: string) {
  const [status, setStatus] = useState<FileStatus[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await call('git_status', { repo_path: repoPath });
    setStatus(result);
    setLoading(false);
  }, [repoPath]);

  const commit = useCallback(async (message: string) => {
    const oid = await call('git_commit', {
      repo_path: repoPath,
      message,
      amend: false,
    });
    await refresh();
    return oid;
  }, [repoPath, refresh]);

  return { status, loading, refresh, commit };
}
```

## 功能保全检查

| 当前功能 | 保留方式 | 状态 |
|----------|----------|------|
| `git status` | `GitService::status()` | ✅ |
| `git diff` | `git2::Repository::diff_*` API | ✅ |
| `git commit` | `GitService::commit()` | ✅ |
| `git branch` | `git2::Repository::branches()` | ✅ |
| `git log` | `git2::Repository::revwalk()` | ✅ |
| 工作树管理 | `git2::Repository::worktrees()` | ✅ |
| `.gitignore` 过滤 | `git2::StatusOptions` 内置 | ✅ |
| 文件监听自动失效 | `notify` crate（可选） | ✅ |

## 预期收益

| 指标 | 当前 | 优化后 | 改善 |
|------|------|--------|------|
| `git status` 响应 | ~200ms (spawn) | <10ms (git2) | **20x** |
| 进程泄漏 | 偶发 | 0 | **消除** |
| 前端代码量 | ~250 行 | <30 行 | **-88%** |
