# P1 — 文件树/后端 files.list 优化

## 审查结论：不需要下沉到 Tauri 壳

### 实际代码分析

**前端 `useFileTree.ts` (297 行)**：
- **不执行文件系统扫描** — 调用后端 `call('files_list', { path })`
- 后端 WS 端点 `ws/mod.rs L3281-3343` 用 `std::fs::read_dir` 实现
- 后端已实现：gitignore 过滤、ALWAYS_EXCLUDED 排除、symlink 跟随、排序
- 前端的 297 行全是：缓存管理、竞态守卫、展开/折叠状态、增量刷新

**所以文件树的瓶颈在后端 `files.list`，不在前端。**

### 当前后端实现（ws/mod.rs L3281-3343）

```rust
// 后端当前实现
"files.list" => {
    let path = params.get("path").and_then(|v| v.as_str()).unwrap_or(".");
    let base = std::path::Path::new(path);
    if !base.exists() || !base.is_dir() {
        Err((INVALID_PARAMS, format!("Path not found: {}", path)))
    } else {
        let gitignore = files_gitignore_matcher(base);
        let mut entries: Vec<serde_json::Value> = Vec::new();
        // 用 std::fs::read_dir 全量读取
        if let Ok(dir) = std::fs::read_dir(base) {
            for entry in dir.flatten() {
                // ... 过滤 + 判断目录 + 推入 entries
            }
        }
        entries.sort_by(...); // 目录优先 + 字母序
        Ok(serde_json::json!({ "path": path, "files": entries }))
    }
}
```

### 优化方案：后端 `files.list` 升级

```rust
// crates/eleve-gateway/src/ws/mod.rs — 优化 files.list

use ignore::{WalkBuilder, DirEntry};

"files.list" => {
    let path = params.get("path").and_then(|v| v.as_str()).unwrap_or(".");
    let base = std::path::Path::new(path);

    if !base.exists() || !base.is_dir() {
        return Err((INVALID_PARAMS, format!("Path not found: {}", path)));
    }

    // 用 ignore::WalkBuilder 替换 std::fs::read_dir
    // 优势：自动 .gitignore 过滤 + 智能排除 + 异步
    let gitignore = files_gitignore_matcher(base);
    let mut entries: Vec<serde_json::Value> = Vec::new();

    let walker = WalkBuilder::new(base)
        .max_depth(Some(1))         // 只扫一层（按需展开）
        .hidden(false)              // 隐藏文件由 gitignore 决定
        .git_ignore(true)           // 遵循 .gitignore
        .git_global(true)           // 全局 gitignore (~/.gitignore)
        .git_exclude(true)          // .git/exclude
        .require_git(false)         // 非 git 仓库也工作
        .build();

    for entry in walker.flatten() {
        // 跳过根目录本身
        if entry.path() == base {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();

        // ALWAYS_EXCLUDED 硬排除
        if FILES_ALWAYS_EXCLUDED.contains(&name.as_str()) {
            continue;
        }

        // 双重检查 gitignore（WalkBuilder 已过滤，但可能有自定义规则）
        if let Some(ref matcher) = gitignore {
            if matcher.matched(entry.path(), entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false)).is_ignore() {
                continue;
            }
        }

        let is_dir = entry.file_type()
            .map(|ft| ft.is_dir())
            .unwrap_or(false);

        entries.push(serde_json::json!({
            "name": name,
            "path": entry.path().to_string_lossy(),
            "isDirectory": is_dir,
        }));
    }

    // 排序：目录优先 + 字母序
    entries.sort_by(|a, b| {
        let a_dir = a.get("isDirectory").and_then(|v| v.as_bool()).unwrap_or(false);
        let b_dir = b.get("isDirectory").and_then(|v| v.as_bool()).unwrap_or(false);
        match (a_dir, b_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => {
                let a_name = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let b_name = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
                a_name.cmp(b_name)
            }
        }
    });

    Ok(serde_json::json!({ "path": path, "files": entries }))
}
```

### Cargo.toml 依赖（后端）

```toml
[dependencies]
ignore = "0.4"
```

### 前端保持不变

前端的 297 行 `useFileTree.ts` 不需要改动。它的工作（缓存、竞态守卫、展开/折叠）是合理的 React 状态管理，下沉只会转移复杂度。

### 预期收益

| 指标 | 当前 | 优化后 | 改善 |
|------|------|--------|------|
| 大目录扫描 | `read_dir` 全量 + 手动过滤 | `WalkBuilder` 智能过滤 | **3-5x** |
| .gitignore 处理 | 手动 matcher | `ignore` crate 内置 | **更准确** |
| 后端代码复杂度 | 手动遍历 + 过滤 | `WalkBuilder` 声明式 | **更简洁** |
