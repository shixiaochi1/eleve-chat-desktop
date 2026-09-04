//! 应用状态文件存储（通用 KV，经 IPC 供前端使用）
//!
//! ## 🔴 归属判定（2026-09-04）：这是**壳的通用能力**，不是画布能力
//!
//! - 调用方既有画布（`canvas-state`），也有 zustand persist 适配器——
//!   `apiStore`（api-settings-storage）、`historyStore`（generation-history-storage）、
//!   `projectStore`（project-meta）。
//! - 文件名与格式和画布无关（`<key>.json`），画布只是一批 key 的持有者。
//! - 判断依据是**概念归属于谁**，不是「当前谁在调」——唯一/多数使用者都不是
//!   把它塞进 `canvas_commands.rs` 的理由。
//!
//! 历史上随「画布 src-tauri 搬入」一起进了 `canvas_commands.rs`，本模块按概念
//! 归属拆出。**命令名保持不变，前端 invoke 零改动。**
//!
//! ## 三个不变式
//!
//! 1. **原子写**（tmp → fsync → rename）。直接覆盖写时进程崩溃会留下截断的
//!    JSON，而水化端「读全部源、比 timestamp 取最新」会稳定选中这份最新也最坏
//!    的副本——截断文件比没有文件更糟。tmp 名**每次唯一**：并发落盘若共用固定
//!    tmp 名，两个写入会互相截断对方字节流，rename 出一个拼凑产物，比非原子
//!    写更难排查。
//! 2. **key 白名单**。key 跨越 IPC 边界直接参与路径拼接。命令是**能力**，不能
//!    假设调用方友善（与 gateway 侧 `handlers/plugin_name.rs` 同一条纪律）。
//! 3. **不占主线程**。画布快照可达 1.69MB，同步 fs 写会跑在 WebView 的 IPC
//!    线程上并卡住界面；写与 flush 一律进 `spawn_blocking`。

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::Manager; // AppHandle::path() 扩展方法

/// 当前状态目录名（通用）。
const STATE_DIR_NAME: &str = "app-state";

/// 历史目录名（2026-09-04 前）。
///
/// 改名不是重命名文件，而是纠正归属：通用 KV 目录不该叫画布的名字。
/// 首次解析时整体 rename 迁移，老数据不丢。
const LEGACY_STATE_DIR_NAME: &str = "canvas-state";

/// key 长度上限（防御性；正常 key 都在 32 字符内）。
const MAX_KEY_LEN: usize = 64;

/// 状态 key 校验：非空、长度受限、仅 ASCII 字母数字与 `-` `_`。
///
/// 🔴 与 gateway `handlers/plugin_name.rs` 同一条纪律：跨 IPC 的字符串参与
/// 路径拼接前必须收口。当前调用方都传常量，但能力不能靠调用方自觉——
/// 而且重复实现迟早分叉，分叉后宽松那一侧就是路径穿越漏洞。
fn is_valid_state_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= MAX_KEY_LEN
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// tmp 文件序号。
///
/// 🔴 必须每次唯一：并发落盘共用固定 tmp 名会让两个写入互相截断，
/// 最终 rename 出一个谁都不完整的产物。
static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// 解析状态目录（必要时做一次历史目录迁移 + create_dir_all）。
///
/// 迁移与建目录都在 `spawn_blocking` 里跑，不占 IPC 线程。
fn resolve_state_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let dir = base.join(STATE_DIR_NAME);
    let legacy = base.join(LEGACY_STATE_DIR_NAME);

    // 一次性迁移：旧目录在、新目录不在 → 整体改名。
    // 迁移失败不阻断（旧目录仍在），最坏情况是读不到这份**备份**副本——
    // 主副本是 IndexedDB，不依赖这里。
    if !dir.exists() && legacy.exists() {
        match std::fs::rename(&legacy, &dir) {
            Ok(()) => tracing::info!(
                "[app-state] 历史目录 {} → {} 迁移完成",
                LEGACY_STATE_DIR_NAME,
                STATE_DIR_NAME
            ),
            Err(e) => tracing::warn!(
                "[app-state] 历史目录 {} → {} 迁移失败：{}（保留旧目录）",
                LEGACY_STATE_DIR_NAME,
                STATE_DIR_NAME,
                e
            ),
        }
    }

    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create state dir: {}", e))?;
    Ok(dir)
}

/// key → 文件路径（含白名单校验）
fn state_file(app: &tauri::AppHandle, key: &str) -> Result<PathBuf, String> {
    if !is_valid_state_key(key) {
        return Err(format!("invalid state key: {:?}", key));
    }
    Ok(resolve_state_dir(app)?.join(format!("{}.json", key)))
}

/// 原子写：写 tmp → fsync → rename。
///
/// - **rename**：目标路径要么全旧、要么全新，不存在中间态。进程崩溃时
///   （数据已在 OS 页缓存）rename 尚未发生，旧文件完好。
/// - **sync_all**：把页缓存刷到磁盘，把保护范围从「进程崩溃」扩到「断电」。
///   代价是一次 flush，但写已挪出主线程，不占 UI。
/// - **未做的部分**：rename 自身的持久化还需要**目录级** fsync，std 无对应
///   API；且 IDB 才是主副本，这里不为备份副本过度设计。
fn write_atomic(path: &Path, data: &str) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| "state path has no parent".to_string())?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "invalid state file name".to_string())?;

    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp_path = dir.join(format!(".{}.{}.{}.tmp", file_name, std::process::id(), seq));

    let result = (|| -> Result<(), String> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path)
            .map_err(|e| format!("Failed to create tmp state file: {}", e))?;
        file.write_all(data.as_bytes())
            .map_err(|e| format!("Failed to write state file: {}", e))?;
        file.sync_all()
            .map_err(|e| format!("Failed to flush state file: {}", e))?;
        drop(file);
        std::fs::rename(&tmp_path, path)
            .map_err(|e| format!("Failed to replace state file: {}", e))
    })();

    if result.is_err() {
        // 清理 tmp，避免残留文件在目录里堆积
        let _ = std::fs::remove_file(&tmp_path);
    }
    result
}

/// 同步保存状态到文件（后端副本；主副本是 IndexedDB）
#[tauri::command]
pub async fn save_state_to_file(
    app: tauri::AppHandle,
    key: String,
    data: String,
) -> Result<(), String> {
    let path = state_file(&app, &key)?;
    let bytes = data.len();
    tauri::async_runtime::spawn_blocking(move || write_atomic(&path, &data))
        .await
        .map_err(|e| format!("save state task failed: {}", e))??;
    tracing::debug!("[app-state] saved key={} ({} bytes)", key, bytes);
    Ok(())
}

/// 从文件读取状态（IDB miss 时的回退源）
#[tauri::command]
pub async fn load_state_from_file(
    app: tauri::AppHandle,
    key: String,
) -> Result<Option<String>, String> {
    let path = state_file(&app, &key)?;
    let loaded = tauri::async_runtime::spawn_blocking(move || {
        match std::fs::read_to_string(&path) {
            Ok(data) => Ok(Some(data)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("Failed to read state file: {}", e)),
        }
    })
    .await
    .map_err(|e| format!("load state task failed: {}", e))??;

    match &loaded {
        Some(s) => tracing::debug!("[app-state] loaded key={} ({} bytes)", key, s.len()),
        None => tracing::debug!("[app-state] key={} not found", key),
    }
    Ok(loaded)
}

/// 删除状态文件（`removeItem` 的文件侧，与 IDB 删除配对）
///
/// 🔴 此前 `idbStorage.removeItem` 只删 IDB 不删文件，而读路径是
/// 「IDB miss → 回退文件」——被显式删除的 key 会从备份副本里**复活**。
/// 删除是幂等的：文件不存在不算错误。
#[tauri::command]
pub async fn delete_state_file(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let path = state_file(&app, &key)?;
    tauri::async_runtime::spawn_blocking(move || match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Failed to delete state file: {}", e)),
    })
    .await
    .map_err(|e| format!("delete state task failed: {}", e))??;
    tracing::debug!("[app-state] deleted key={}", key);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("app-state-{}-{}-{}", tag, std::process::id(), TMP_SEQ.fetch_add(1, Ordering::Relaxed)));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn state_key_whitelist() {
        assert!(is_valid_state_key("canvas-state"));
        assert!(is_valid_state_key("project_meta"));
        assert!(is_valid_state_key("api-settings-storage"));
        assert!(is_valid_state_key("generation-history-storage"));

        assert!(!is_valid_state_key(""));
        assert!(!is_valid_state_key("a/b"), "路径穿越（POSIX 分隔）");
        assert!(!is_valid_state_key("..\\windows"), "路径穿越（Windows 分隔）");
        assert!(!is_valid_state_key(".."), "上跳");
        assert!(!is_valid_state_key("a.json"), "后缀由命令拼接，key 不该带");
        assert!(!is_valid_state_key("C:foo"), "盘符");
        assert!(!is_valid_state_key("中文"));
        assert!(!is_valid_state_key(&"a".repeat(MAX_KEY_LEN + 1)), "超长");
    }

    #[test]
    fn atomic_write_never_leaves_partial_content() {
        let dir = tmp_dir("probe");
        let path = dir.join("probe.json");

        write_atomic(&path, "{\"v\":1}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"v\":1}");

        // 覆盖写：结果必须是完整的第二版，绝不可能是两版的拼接
        write_atomic(&path, "{\"v\":2,\"pad\":\"aaaa\"}").unwrap();
        let got = std::fs::read_to_string(&path).unwrap();
        assert_eq!(got, "{\"v\":2,\"pad\":\"aaaa\"}");
        assert!(!got.contains("\"v\":1"));

        // 成功路径不残留 tmp
        let left = list_dir(&dir);
        assert_eq!(left, vec!["probe.json".to_string()]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 并发写同一个 key：tmp 名若共用固定名字，两个 writer 会互相截断，
    /// 最终留下一个拼凑产物。这里用大载荷放大竞态窗口。
    #[test]
    fn concurrent_writes_do_not_interleave() {
        let dir = tmp_dir("conc");
        let path = dir.join("race.json");

        let payload_a = "A".repeat(200_000);
        let payload_b = "B".repeat(200_000);

        let (p1, a) = (path.clone(), payload_a.clone());
        let h1 = std::thread::spawn(move || {
            for _ in 0..20 {
                write_atomic(&p1, &a).unwrap();
            }
        });
        let (p2, b) = (path.clone(), payload_b.clone());
        let h2 = std::thread::spawn(move || {
            for _ in 0..20 {
                write_atomic(&p2, &b).unwrap();
            }
        });
        h1.join().unwrap();
        h2.join().unwrap();

        let got = std::fs::read_to_string(&path).unwrap();
        assert!(
            got == payload_a || got == payload_b,
            "内容被混写：长度 {}（期望 200000）",
            got.len()
        );

        let tmp_left: Vec<String> = list_dir(&dir)
            .into_iter()
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(tmp_left.is_empty(), "残留 tmp: {:?}", tmp_left);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 写入失败时必须回收 tmp（否则每次失败都在状态目录里堆一个隐藏文件）
    #[test]
    fn failed_write_cleans_up_tmp() {
        let dir = tmp_dir("fail");
        // 目录不存在 → create_new 必失败
        let path = dir.join("missing-dir").join("x.json");
        let err = write_atomic(&path, "{}").unwrap_err();
        assert!(!err.is_empty());

        let left = list_dir(&dir);
        assert!(left.is_empty(), "失败后残留: {:?}", left);

        let _ = std::fs::remove_dir_all(&dir);
    }

    fn list_dir(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }
}
