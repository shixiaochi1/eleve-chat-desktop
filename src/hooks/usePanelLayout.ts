import { useCallback, useEffect, useRef, useState } from 'react';
import { useMediaQuery } from './use-media-query';
import { isDesktop } from '../utils/bridge';

/**
 * usePanelLayout — 三栏布局状态（图标栏 + 侧边面板 + 右抽屉）
 *
 * 🔴 2026-08-13 Phase 2 拆分（施工方案_文件事件下沉与前端减负）：
 *   从 App.tsx 纯移动抽取（diff 无逻辑变更）。只拆组织，不动状态归属——
 *   布局状态单一权威源仍在本 hook，App 经返回值消费。
 *
 * 职责：
 * - 左侧面板（activePanel / panelWidth / 窄窗响应式折叠）
 * - 右抽屉（rightOpen / rightAnchor / rightTab / terminalMounted 常驻挂载）
 * - 右抽屉打开 = 窗口向右加宽（不挤压消息区，Tauri setSize/setMinSize 物理换算）
 */
export function usePanelLayout() {
  // ── 三栏布局 state ──
  const [activePanel, setActivePanel] = useState<string | null>('agents'); // 默认显示统一侧栏（Agent + 会话）
  const [panelWidth, setPanelWidth] = useState<number>(260);  // 侧边面板宽度（可拖动）

  // ── Responsive: auto-collapse left sidebar when window < 800px ──
  // 🔴 2026-08-06 修复（老大反馈：最小化再切回，侧边栏自动隐藏）：
  //   最小化时 WebView2 窗口宽度报告为 0/极小 → matchMedia 判定 isNarrow=true →
  //   误折叠。加 document.hidden 过滤（最小化/隐藏期间不折叠）；恢复时
  //   collapsedPanelRef 记住折叠前的面板并还原（旧代码只清标志不还原 → 侧栏丢失）。
  const isNarrow = useMediaQuery('(max-width: 799px)');
  const [responsiveCollapsed, setResponsiveCollapsed] = useState<boolean>(false);
  const collapsedPanelRef = useRef<string | null>(null);
  useEffect(() => {
    if (isNarrow && !document.hidden && activePanel) {
      collapsedPanelRef.current = activePanel;
      setActivePanel(null);
      setResponsiveCollapsed(true);
    } else if (!isNarrow && responsiveCollapsed) {
      setResponsiveCollapsed(false);
      if (collapsedPanelRef.current) {
        setActivePanel(collapsedPanelRef.current);
        collapsedPanelRef.current = null;
      }
    }
  }, [isNarrow, activePanel, responsiveCollapsed]);

  // ── 右侧抽屉 state（持久化，对齐 Hermes $paneStates/$rightRailActiveTabId）──
  const [rightOpen, setRightOpen] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('eleve.rightPane.v1');
      return raw ? (JSON.parse(raw) as { open?: boolean }).open === true : false;
    } catch {
      return false;
    }
  });
  const [rightAnchor, setRightAnchor] = useState<{ winW: number; rightW: number }>(() => {
    // 🔴 2026-08-06 v4 确定性推导：右抽屉宽度锚点（PaneShell 内部派生 = 锚点 + 窗口变化量）
    // winW = 锚定时的窗口内容宽（CSS 像素）；rightW = 锚定时的右抽屉宽
    // 🔴 2026-08-08 v6：锚点持久化（eleve.rightPane.v1 附带 winW/rightW）——
    //   重启后恢复上次右抽屉宽度，不再回落默认 280；winW 随窗口恢复尺寸自动补偿
    try {
      const raw = localStorage.getItem('eleve.rightPane.v1');
      const a = raw ? (JSON.parse(raw) as { winW?: number; rightW?: number }) : null;
      return {
        winW: typeof a?.winW === 'number' && a.winW > 0 ? a.winW : (typeof window !== 'undefined' ? window.innerWidth : 900),
        rightW: typeof a?.rightW === 'number' ? Math.max(320, Math.min(800, a.rightW)) : 280,
      };
    } catch {
      return {
        winW: typeof window !== 'undefined' ? window.innerWidth : 900,
        rightW: 280,
      };
    }
  });
  const [rightTab, setRightTab] = useState<string>(() => {
    try {
      const raw = localStorage.getItem('eleve.rightPane.v1');
      const tab = raw ? (JSON.parse(raw) as { tab?: string }).tab : undefined;
      return tab === 'files' || tab === 'terminal' || tab === 'preview' || tab === 'artifacts' ? tab : 'files';
    } catch {
      return 'files';
    }
  });
  // 🔴 2026-08-09 v2（对齐 Hermes PersistentTerminal mounted 语义）：
  // 首次“抽屉打开且终端 tab”才挂载 TerminalPanel——xterm open 必须有真实尺寸
  // （display:none 0×0 open → canvas 空、终端“什么都没有”）；之后保持挂载，
  // PTY 存活于隐藏（Tauri 侧 pty 不销毁，重开由 reviveBuffer 恢复屏幕）
  const [terminalMounted, setTerminalMounted] = useState(false);
  useEffect(() => {
    if (rightOpen && rightTab === 'terminal') setTerminalMounted(true);
  }, [rightOpen, rightTab]);
  useEffect(() => {
    try {
      localStorage.setItem('eleve.rightPane.v1', JSON.stringify({ open: rightOpen, tab: rightTab, winW: rightAnchor.winW, rightW: rightAnchor.rightW }));
    } catch { /* 存储不可用静默降级 */ }
  }, [rightOpen, rightTab, rightAnchor]);
  const handleToggleFiles = useCallback(() => setRightOpen(prev => !prev), []);

  // 🔴 2026-08-06 老大要求：右抽屉打开 = 窗口向右加宽（不挤压消息区）
  // - 窗口最小宽度 = 图标栏 52 + 左面板 panelWidth + 聊天区最小 480
  //   + (抽屉开 ? 右抽屉实际宽 : 0) + padding/gap 32（SIDE_CHROME）
  // - 开抽屉瞬间若窗口不足 → setSize 向右加宽（聊天区补到最小，右抽屉保持）
  // - widenedRef 防重复加宽：之后右抽屉/面板宽度变化只同步 min-size 不再 setSize
  // 🔴 2026-08-08 v6 重启挤压根治三修正：
  //   ① minSize 用实际右抽屉宽（原写死 240 → rightW=280/更大时窗口可缩到聊天区 < 480）
  //   ② 物理/CSS 像素统一：setSize/setMinSize 输入物理 = CSS×scaleFactor+border；
  //      锚点 winW 恒用 CSS（window.innerWidth）。原混用（after.width 物理写入锚点、
  //      布局/渲染读 CSS）→ 系统缩放率 ≠ 100% 时 rightW 错位被压到下限 → 重启挤压
  //   ③ 启动 1s 后重锚：窗口恢复/OS minSize 拉大等启动期窗口变化归零，不进入右抽屉增量
  const MIN_CHAT_WIDTH = 480;
  const SIDE_CHROME = 32; // pl-2/pr-2 padding 16 + grid gap-2 16
  const widenedRef = useRef(false);
  useEffect(() => {
    if (!isDesktop()) return;
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const { PhysicalSize } = await import('@tauri-apps/api/dpi');
        const win = getCurrentWindow();
        const scale = await win.scaleFactor();
        const size = await win.innerSize();
        // 🔴 物理宽 = 内容宽 + 边框差（setSize/setMinSize 是物理单位，calc 布局用内容宽）
        const border = Math.max(0, (await win.outerSize()).width - size.width);
        const rightW = rightOpen ? rightAnchor.rightW : 0;
        const minW = 52 + panelWidth + MIN_CHAT_WIDTH + SIDE_CHROME + rightW;
        // 🔴 before 必须 setMinSize 前读（OS clamp 拉大后 innerWidth 已是新值，
        //   1s 后比较恒等 → 重锚失效 → 拉大量仍算进右抽屉 → 挤压）
        const before = window.innerWidth;
        await win.setMinSize(new PhysicalSize(Math.round(minW * scale) + border, 400));
        if (rightOpen) {
          if (!widenedRef.current) {
            widenedRef.current = true;
            // 🔴 物理/CSS 换算：need 是 CSS 公式，setSize 输入物理 = CSS×scale+border
            if (before < minW) {
              await win.setSize(new PhysicalSize(Math.round(minW * scale) + border, size.height));
            }
          }
        } else {
          widenedRef.current = false;
        }
        // 🔴 启动 1s 后重锚（窗口恢复/minSize 拉大归零，不进入右抽屉增量 → 聊天区恒 ≥ 480）
        await new Promise((r) => setTimeout(r, 1000));
        if (cancelled) return;
        if (window.innerWidth !== before) {
          setRightAnchor((prev) => ({ winW: window.innerWidth, rightW: prev.rightW }));
        }
      } catch (err) {
        console.warn('[App] window size sync failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [rightOpen, panelWidth, rightAnchor.rightW]);

  return {
    activePanel,
    setActivePanel,
    panelWidth,
    setPanelWidth,
    responsiveCollapsed,
    rightOpen,
    setRightOpen,
    rightAnchor,
    setRightAnchor,
    rightTab,
    setRightTab,
    terminalMounted,
    handleToggleFiles,
    MIN_CHAT_WIDTH,
  };
}
