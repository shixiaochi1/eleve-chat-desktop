//! Preview console 治理层 — Rust 侧缓冲 + 批量推送（方案原则③：复杂状态下沉）
//!
//! 页面疯狂 log（每秒数百条）时，直接逐条 IPC→事件→React 渲染 = 前端卡死。
//! 本模块在 Rust 侧做治理（比 Hermes 直接灌 renderer 更优）：
//!   - 环形上限：2000 条（超限丢最旧）
//!   - 单条上限：4KB（超限截断；注入脚本侧已 1KB 截断，此处仅兜底）
//!   - 重复合并：连续同 (label, level, text) → 计数折叠进 message（前端零感知，
//!     复制/发送语义自然，UI 与 Hermes 全量对齐零偏差）
//!   - 批量推送：100ms flush 周期 → emit("preview-console", Vec<ConsoleEntry>)
//!   - per-label seq 游标：前端按 (label, seq) 增量追加，断档 → snapshot 补拉
//!   - label 注册表：仅受管 preview webview 的 label 可推送（防伪造注入）
//!
//! 线程模型：flush 用 std::thread + mpsc（非回调，符合 ELEVE 铁律：
//! 非 FFI 回调用 channel 替代）。push 命令持 tx.try_send(()) 唤醒，
//! recv_timeout(100ms) 超时即批量 drain + emit —— 高流量时每 100ms 一周期，
//! 低频时单条最多延迟 100ms。

use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

/// 环形缓冲容量上限（内存有界：2000 × ≤4KB = 最坏 ~8MB）
pub const CONSOLE_CAP: usize = 2000;
/// 单条 message 上限（UTF-8 安全截断）
pub const CONSOLE_MAX_LEN: usize = 4096;
/// 批量推送周期
pub const CONSOLE_FLUSH_MS: u64 = 100;

/// 单条 console 条目（随事件推给前端；seq 为 per-label 单调递增游标）
#[derive(Clone, Debug, Serialize)]
pub struct ConsoleEntry {
    /// 来源 preview webview label（前端按此分流到对应 tab）
    pub label: String,
    /// per-label 单调递增游标（前端增量追加 + 断档检测）
    pub seq: u64,
    /// 0=log 1=info 2=warn 3=error（注入脚本侧已归一，此处 clamp 防御）
    pub level: u8,
    /// 已截断/已合并计数折叠后的文本
    pub message: String,
    pub source: Option<String>,
    pub line: Option<u32>,
}

#[derive(Default)]
struct ConsoleInner {
    entries: VecDeque<ConsoleEntry>,
    /// per-label seq 游标（navigate/close 清空重置）
    label_seqs: HashMap<String, u64>,
    /// 受管 label 注册表（PreviewWebviewManager create/close 维护）
    registered: HashSet<String>,
    /// 重复合并：最后一条的 (label, level, 原始文本, 计数)
    last: Option<(String, u8, String, u32)>,
}

/// managed state：push 命令 + flush 线程共享
pub struct PreviewConsoleState {
    inner: Arc<Mutex<ConsoleInner>>,
    wake_tx: mpsc::Sender<()>,
    /// flush 线程专用接收端（spawn_flusher 消费一次）
    wake_rx: Mutex<Option<mpsc::Receiver<()>>>,
}

impl Default for PreviewConsoleState {
    fn default() -> Self {
        let (tx, rx) = mpsc::channel();
        Self {
            inner: Arc::new(Mutex::new(ConsoleInner::default())),
            wake_tx: tx,
            wake_rx: Mutex::new(Some(rx)),
        }
    }
}

/// 截断到 CONSOLE_MAX_LEN（char 边界安全，不劈开 UTF-8 序列）
fn truncate(mut text: String) -> String {
    if text.len() <= CONSOLE_MAX_LEN {
        return text;
    }
    let mut end = CONSOLE_MAX_LEN;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    text.push('…');
    text
}

impl PreviewConsoleState {
    /// 注册受管 label（PreviewWebviewManager::create 调用）
    pub fn register_label(&self, label: &str) {
        self.inner.lock().unwrap().registered.insert(label.to_string());
    }

    /// 注销 label + 清空该 label 全部数据（PreviewWebviewManager::close 调用）
    pub fn remove_label(&self, label: &str) {
        let mut g = self.inner.lock().unwrap();
        g.registered.remove(label);
        g.label_seqs.remove(label);
        g.entries.retain(|e| e.label != label);
        if let Some((l, _, _, _)) = &g.last {
            if l == label {
                g.last = None;
            }
        }
    }

    /// 清空某 label 缓冲（navigate 新页面新会话；不清注册表）
    pub fn clear_label(&self, label: &str) {
        let mut g = self.inner.lock().unwrap();
        g.label_seqs.remove(label);
        g.entries.retain(|e| e.label != label);
        if let Some((l, _, _, _)) = &g.last {
            if l == label {
                g.last = None;
            }
        }
    }

    /// 注入脚本入口：label 必须已注册（防远程页面伪造 label 污染其它 tab）
    pub fn push(&self, label: &str, level: u8, text: String, source: Option<String>, line: Option<u32>) -> bool {
        let mut g = self.inner.lock().unwrap();
        if !g.registered.contains(label) {
            return false;
        }
        let level = level.min(3);
        let text = truncate(text);

        // 重复合并：连续同 (label, level, 原始文本) → 计数折叠进 message（前端零感知）
        let merge = g
            .last
            .as_ref()
            .map(|(l, lv, raw, _)| l == label && *lv == level && raw == &text)
            .unwrap_or(false);
        if merge {
            let count = g.last.as_ref().map(|(_, _, _, c)| *c).unwrap_or(0) + 1;
            if let Some(mut e) = g.entries.pop_back() {
                e.message = format!("{} (×{})", text, count);
                g.entries.push_back(e);
            }
            g.last = Some((label.to_string(), level, text, count));
            drop(g);
            let _ = self.wake_tx.send(());
            return true;
        }

        let seq = {
            let s = g.label_seqs.entry(label.to_string()).or_insert(0);
            *s += 1;
            *s
        };
        g.entries.push_back(ConsoleEntry {
            label: label.to_string(),
            seq,
            level,
            message: text.clone(),
            source,
            line,
        });
        // 环形上限：超限丢最旧
        if g.entries.len() > CONSOLE_CAP {
            g.entries.pop_front();
        }
        g.last = Some((label.to_string(), level, text, 1));

        drop(g);
        let _ = self.wake_tx.send(());
        true
    }

    /// 当前是否为空（snapshot 空批也返回当前 seq 供前端对齐）
    pub fn snapshot(&self, label: &str) -> (Vec<ConsoleEntry>, u64) {
        let g = self.inner.lock().unwrap();
        let entries = g.entries.iter().filter(|e| e.label == label).cloned().collect();
        let seq = g.label_seqs.get(label).copied().unwrap_or(0);
        (entries, seq)
    }

    /// 批量 drain（100ms flush 周期调用）；空返回 None（不发事件）
    fn drain(&self) -> Option<Vec<ConsoleEntry>> {
        let mut g = self.inner.lock().unwrap();
        if g.entries.is_empty() {
            return None;
        }
        Some(g.entries.drain(..).collect())
    }

    /// 启动 flush 线程：recv_timeout(100ms) 超时 → drain + emit
    ///
    /// 信号通道容量 1：push 高频时 try_send 失败无害（超时周期兜底）；
    /// 线程持有 AppHandle，随 app 生命周期存活（退出时进程结束，无需显式停止）。
    pub fn spawn_flusher(&self, app: tauri::AppHandle) {
        let rx = self.wake_rx.lock().unwrap().take().expect("spawn_flusher called twice");
        let state = Arc::new(Self {
            inner: self.inner.clone(),
            wake_tx: self.wake_tx.clone(),
            wake_rx: Mutex::new(None),
        });
        std::thread::spawn(move || {
            loop {
                match rx.recv_timeout(Duration::from_millis(CONSOLE_FLUSH_MS)) {
                    Ok(()) => continue, // 窗口内仍有新 push，继续积累
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        if let Some(batch) = state.drain() {
                            let _ = app.emit("preview-console", batch);
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });
    }
}

/// push 命令（注入脚本入口；调用方 webview 身份校验在命令层）
#[tauri::command]
pub fn preview_console_push(
    webview: tauri::Webview,
    state: tauri::State<'_, PreviewConsoleState>,
    label: String,
    level: u8,
    text: String,
    source: Option<String>,
    line: Option<u32>,
) -> Result<(), String> {
    // 安全边界：调用方 webview label 必须与参数一致（远程页面无法伪造 ——
    // 参数可伪造，但调用方身份由 Tauri IPC 注入，不可伪造）
    if webview.label() != label {
        return Err("preview_console_push: caller label mismatch".into());
    }
    if !state.push(&label, level, text, source, line) {
        return Err("preview_console_push: label not registered".into());
    }
    Ok(())
}

/// snapshot 命令（前端断档补拉：当前剩余条目 + 当前 seq）
#[tauri::command]
pub fn preview_console_snapshot(
    state: tauri::State<'_, PreviewConsoleState>,
    label: String,
) -> Result<(Vec<ConsoleEntry>, u64), String> {
    Ok(state.snapshot(&label))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> PreviewConsoleState {
        let s = PreviewConsoleState::default();
        s.register_label("preview-0");
        s
    }

    #[test]
    fn push_and_seq_increment_per_label() {
        let s = state();
        assert!(s.push("preview-0", 0, "a".into(), None, None));
        assert!(s.push("preview-0", 1, "b".into(), Some("http://x".into()), Some(3)));
        let (entries, seq) = s.snapshot("preview-0");
        assert_eq!(seq, 2);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].seq, 1);
        assert_eq!(entries[0].level, 0);
        assert_eq!(entries[1].seq, 2);
        assert_eq!(entries[1].level, 1);
        assert_eq!(entries[1].source.as_deref(), Some("http://x"));
        assert_eq!(entries[1].line, Some(3));
    }

    #[test]
    fn unregistered_label_rejected() {
        let s = state();
        assert!(!s.push("evil", 0, "x".into(), None, None));
        assert!(s.snapshot("evil").0.is_empty());
    }

    #[test]
    fn level_clamped_to_3() {
        let s = state();
        assert!(s.push("preview-0", 99, "x".into(), None, None));
        let (entries, _) = s.snapshot("preview-0");
        assert_eq!(entries[0].level, 3);
    }

    #[test]
    fn utf8_truncation_at_4kb_boundary() {
        let s = state();
        // 4KB 边界上放多字节字符（"中" = 3 bytes），截断不得劈开 UTF-8
        let mut text = "中".repeat(CONSOLE_MAX_LEN / 3 + 100);
        text.push_str("尾");
        assert!(s.push("preview-0", 0, text.clone(), None, None));
        let (entries, _) = s.snapshot("preview-0");
        let msg = &entries[0].message;
        assert!(msg.len() <= CONSOLE_MAX_LEN + 4, "len={}", msg.len()); // 截断符余量
        assert!(msg.ends_with('…'));
        assert!(msg.is_char_boundary(msg.len()));
    }

    #[test]
    fn short_text_untouched() {
        let s = state();
        assert!(s.push("preview-0", 0, "hello".into(), None, None));
        let (entries, _) = s.snapshot("preview-0");
        assert_eq!(entries[0].message, "hello");
    }

    #[test]
    fn repeated_merge_folds_count() {
        let s = state();
        for _ in 0..3 {
            assert!(s.push("preview-0", 2, "same".into(), None, None));
        }
        assert!(s.push("preview-0", 2, "other".into(), None, None));
        let (entries, seq) = s.snapshot("preview-0");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].message, "same (×3)");
        assert_eq!(entries[1].message, "other");
        // 合并不消费新 seq（seq 只对真实新条目递增，前端收到的 seq 序列保持连续 1,2）
        assert_eq!(seq, 2);
    }

    #[test]
    fn merge_breaks_on_label_or_level_change() {
        let s = state();
        s.register_label("preview-1");
        assert!(s.push("preview-0", 2, "same".into(), None, None));
        assert!(s.push("preview-1", 2, "same".into(), None, None)); // 不同 label 不合并
        assert!(s.push("preview-0", 1, "same".into(), None, None)); // 不同 level 不合并
        let (entries, _) = s.snapshot("preview-0");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].message, "same");
        assert_eq!(entries[1].message, "same");
    }

    #[test]
    fn ring_cap_drops_oldest() {
        let s = state();
        for i in 0..(CONSOLE_CAP + 50) {
            assert!(s.push("preview-0", 0, format!("msg-{}", i), None, None));
        }
        let (entries, seq) = s.snapshot("preview-0");
        assert_eq!(entries.len(), CONSOLE_CAP);
        assert_eq!(seq as usize, CONSOLE_CAP + 50);
        assert_eq!(entries[0].message, format!("msg-{}", 50)); // 最旧的 50 条被丢
    }

    #[test]
    fn drain_empties_and_batches() {
        let s = state();
        for i in 0..5 {
            assert!(s.push("preview-0", 0, format!("m{}", i), None, None));
        }
        let batch = s.drain();
        assert_eq!(batch.as_ref().map(|b| b.len()), Some(5));
        assert!(s.drain().is_none()); // 二次 drain 为空
        assert!(s.snapshot("preview-0").0.is_empty());
    }

    #[test]
    fn clear_label_resets_seq_but_keeps_registration() {
        let s = state();
        assert!(s.push("preview-0", 0, "a".into(), None, None));
        s.clear_label("preview-0");
        assert!(s.snapshot("preview-0").0.is_empty());
        assert!(s.push("preview-0", 0, "b".into(), None, None)); // 注册仍在，可继续推
        let (entries, seq) = s.snapshot("preview-0");
        assert_eq!(entries[0].seq, 1); // seq 从头开始（新会话）
        assert_eq!(seq, 1);
    }

    #[test]
    fn remove_label_drops_data_and_registration() {
        let s = state();
        assert!(s.push("preview-0", 0, "a".into(), None, None));
        s.remove_label("preview-0");
        assert!(s.snapshot("preview-0").0.is_empty());
        assert!(!s.push("preview-0", 0, "b".into(), None, None)); // 注销后拒绝
    }

    #[test]
    fn per_label_seqs_independent() {
        let s = state();
        s.register_label("preview-1");
        assert!(s.push("preview-0", 0, "a0".into(), None, None));
        assert!(s.push("preview-1", 0, "a1".into(), None, None));
        assert!(s.push("preview-0", 0, "b0".into(), None, None));
        let (e0, s0) = s.snapshot("preview-0");
        let (e1, s1) = s.snapshot("preview-1");
        assert_eq!(e0.iter().map(|e| e.seq).collect::<Vec<_>>(), vec![1, 2]);
        assert_eq!(e1.iter().map(|e| e.seq).collect::<Vec<_>>(), vec![1]);
        assert_eq!(s0, 2);
        assert_eq!(s1, 1);
    }
}
