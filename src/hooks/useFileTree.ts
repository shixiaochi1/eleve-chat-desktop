/**
 * useFileTree — 文件树 Hook
 *
 * 统一通过后端 WS `files.list` 列出目录内容（唯一数据源）
 * 支持缓存、排序（后端目录优先+字母序）、展开/折叠
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { call } from '../utils/bridge';
import { getWsClient } from '../services/ws-client';

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileEntry[] | null;
}

interface CacheMap {
  [dirPath: string]: FileEntry[];
}

interface OpenStateMap {
  [dirPath: string]: boolean;
}

/**
 * 通过后端读取目录（WS files.list）
 * 过滤全部在后端完成（gitignore + ALWAYS_EXCLUDED，对齐 Hermes ipc.ts）：
 * 前端不再无条件清点文件——点文件是否显示由 gitignore 语义决定
 */
async function fetchDir(dirPath: string): Promise<FileEntry[]> {
  const data = await call('files_list', { path: dirPath });
  // 后端返回 { files: [...] }
  const entries = (data as { files?: unknown[] }).files ?? [];
  if (!Array.isArray(entries)) return [];

  return (entries as FileEntry[]).filter(e => !!e.name);
}

/**
 * useFileTree Hook
 */
export function useFileTree(initialPath: string | null = null) {
  const [data, setData] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openState, setOpenState] = useState<OpenStateMap>({});
  const [rootPath, setRootPath] = useState<string | null>(initialPath);
  // 非破坏刷新信号：workspace tick 递增 → TreeNode 重载已展开目录（对齐 Hermes
  // revalidateTree 非破坏语义——保留展开状态，只更新数据）
  const [refreshNonce, setRefreshNonce] = useState(0);
  // 已加载目录 → 子条目（数据源收敛到 hook 层，对齐 Hermes useProjectTree 的
  // data 树模型；TreeNode 渲染 + 键盘导航扁平化都从这里读，单一权威源）
  const [loadedDirs, setLoadedDirs] = useState<Record<string, FileEntry[]>>({});
  // 目录加载中（虚拟滚动 placeholder "加载中" 数据源，对齐 Hermes loadingChild）
  const [loadingDirs, setLoadingDirs] = useState<Record<string, boolean>>({});
  // 目录读取失败（placeholder "无法读取" 数据源，对齐 Hermes errorChild）
  const [dirErrors, setDirErrors] = useState<Record<string, string | null>>({});
  const cacheRef = useRef<CacheMap>({});
  const mountedRef = useRef(true);
  // workspace.watch 订阅 id（外部文件变更感知；单实例替换式）
  const watchIdRef = useRef<string | null>(null);
  // 🔴 2026-08-12 竞态守卫（老大反馈：点项目/切 Agent 后文件面板不显示需刷新）：
  //   setRoot 是异步（listDir await），cwd 连续变化（项目点击 + session.info 覆盖 +
  //   豁免标记）时两次 setRoot 并发 → 后发先至/先发后至乱序 → data 与 rootPath 错位
  //   显示空白。请求序号：只有最新一次请求允许写 state，旧请求结果丢弃。
  const rootSeqRef = useRef(0);
  // 🔴 定向刷新需要读最新 openState/loadedDirs（进依赖数组会让展开/加载本身误触发
  // invalidate 重建——对齐 Hermes revalidateTree 在 hook 外读 state 的模式，用 ref 镜像）
  const openStateRef = useRef<OpenStateMap>(openState);
  openStateRef.current = openState;
  const loadedDirsRef = useRef<Record<string, FileEntry[]>>(loadedDirs);
  loadedDirsRef.current = loadedDirs;

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  /**
   * 列出目录（带缓存）
   */
  const listDir = useCallback(async (dirPath: string): Promise<FileEntry[]> => {
    if (!dirPath) return [];

    // 缓存命中
    if (cacheRef.current[dirPath]) {
      return cacheRef.current[dirPath];
    }

    const entries = await fetchDir(dirPath);

    // 后端已排序（目录优先+字母序），直接缓存
    cacheRef.current[dirPath] = entries;
    return entries;
  }, []);

  /**
   * 设置根目录（刷新整个树）
   */
  const setRoot = useCallback(async (path: string | null) => {
    const seq = ++rootSeqRef.current; // 🔴 竞态守卫：本请求序号
    console.log(`[filetree] setRoot path=${path} seq=${seq}`);
    if (!path) {
      if (seq !== rootSeqRef.current) return; // 已有更新请求，丢弃旧结果
      setRootPath(null);
      setData(null);
      setError(null);
      setOpenState({});
      return;
    }

    setRootPath(path);
    // 🔴 2026-08-13 错位根治：切根立即清 data——头部路径已变（setRootPath 同步），
    // 若旧 data 继续渲染（data && !error 无条件渲染树），点击树行会进入旧路径目录
    // （老大反馈：显示 WORKSPACE 内容却是新项目/反向）。清 data → loading 态渲染，
    // listDir 完成前绝不呈现旧内容。
    setData(null);
    setLoading(true);
    setError(null);
    // 切换根目录：重置展开状态 + 目录缓存 + 已加载子树（旧树状态不能残留到新目录）
    setOpenState({});
    setLoadedDirs({});
    cacheRef.current = {};

    try {
      const entries = await listDir(path);
      console.log(`[filetree] setRoot done path=${path} seq=${seq} entries=${entries.length} latestSeq=${rootSeqRef.current}`);
      // 🔴 竞态守卫：仅最新请求可写 state（旧请求的 listDir 返回时已过时）
      if (mountedRef.current && seq === rootSeqRef.current) {
        setData(entries);
      }
    } catch (err: unknown) {
      if (mountedRef.current && seq === rootSeqRef.current) {
        setError((err as Error).message || '读取目录失败');
        setData([]);
      }
    } finally {
      // loading 归位也只看最新请求（旧请求的 finally 不得覆盖新请求的 loading=true）
      if (mountedRef.current && seq === rootSeqRef.current) {
        setLoading(false);
      }
    }
  }, [listDir]);

  // 对齐 Hermes ROOT_ERROR_RETRY_MS=3s self-heal：根目录读取失败（会话 cwd 竞态 /
  // 目录暂时不可读）→ 自动重试直到成功，树自愈而非停在"读取失败"。
  // setRoot 开始时清 error → 本 effect 清理 timer；失败再设 error → 重新起 timer。
  useEffect(() => {
    if (!rootPath || !error) return;
    const t = window.setTimeout(() => {
      void setRoot(rootPath);
    }, 3000);
    return () => window.clearTimeout(t);
  }, [rootPath, error, setRoot]);

  /**
   * 刷新当前目录
   */
  const refresh = useCallback(async () => {
    if (!rootPath) return;
    // 清除缓存
    cacheRef.current = {};
    await setRoot(rootPath);
  }, [rootPath, setRoot]);

  /**
   * 展开/折叠目录
   */
  const toggleOpen = useCallback(async (dirPath: string) => {
    setOpenState(prev => {
      const next = { ...prev };
      if (next[dirPath]) {
        delete next[dirPath];
      } else {
        next[dirPath] = true;
      }
      return next;
    });

    // 如果打开时还没缓存，预加载子目录
    if (!cacheRef.current[dirPath]) {
      try {
        await listDir(dirPath);
      } catch { /* 静默失败 */ }
    }
  }, [listDir]);

  /**
   * 获取子目录条目（虚拟滚动行数据源）
   * 成功 → 写入 loadedDirs + 清 dirErrors；失败 → dirErrors（placeholder 显示）；
   * loadingDirs 全程标记（placeholder "加载中"）。错误不再向上抛——扁平渲染
   * 由 placeholder 行呈现（对齐 Hermes loadingChild/errorChild）
   */
  const loadChildren = useCallback(async (dirPath: string): Promise<FileEntry[]> => {
    setDirErrors((prev) => (prev[dirPath] ? { ...prev, [dirPath]: null } : prev));
    setLoadingDirs((prev) => (prev[dirPath] ? prev : { ...prev, [dirPath]: true }));
    try {
      const entries = cacheRef.current[dirPath]
        ? cacheRef.current[dirPath]
        : await listDir(dirPath);
      setLoadedDirs((prev) => (prev[dirPath] === entries ? prev : { ...prev, [dirPath]: entries }));
      return entries;
    } catch (err: unknown) {
      setDirErrors((prev) => ({ ...prev, [dirPath]: err instanceof Error ? err.message : String(err) }));
      return [];
    } finally {
      setLoadingDirs((prev) => (prev[dirPath] ? { ...prev, [dirPath]: false } : prev));
    }
  }, [listDir]);

  /**
   * 非破坏刷新（对齐 Hermes revalidateTree）：
   * - 定向（change.dirs）：只重读已加载的变更目录（根或已展开目录），增量更新
   *   data/loadedDirs；不动未变更目录（不 refreshNonce）。transient 读错保留旧数据。
   * - 全量（full / 无路径可锚定 / 调用方未传）：清缓存 + 重拉根 + refreshNonce
   *   （已展开目录重载，见下方循环）。
   * workspace tick 自动刷新用；手动刷新按钮仍走 refresh()（含重置）。
   */
  const invalidate = useCallback(async (change?: { dirs: string[]; full: boolean }) => {
    if (!rootPath) return;
    const ch = change ?? { dirs: [], full: true };
    // 🔴 2026-08-13 竞态守卫（老大反馈：显示路径对但树内容是别的项目目录）：
    // setRoot 有 seq 守卫，但 invalidate 的 setData 没有——旧闭包 invalidate
    // （rootPath 快照为旧值）在途返回时会把旧 rootPath 的数据覆盖新 rootPath 的
    // data → 面板显示新路径 + 旧项目内容（双向漂移）。快照语义：自进入以来若
    // 有新的 setRoot（rootSeqRef 已递增）→ 丢弃本次写（setRoot 会写新数据）；
    // 无新 setRoot → rootPath 未变，写入正确。
    const seq = rootSeqRef.current;

    // ── 定向：只重读变更目录中已加载的（根 或 已展开/已加载目录）──
    if (!ch.full && ch.dirs.length > 0) {
      const rootNorm = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
      const targets = ch.dirs.filter((d) => {
        const norm = d.replace(/\\/g, '/').replace(/\/+$/, '');
        // 🔴 2026-08-13 统一匹配契约：loadedDirs key 是 files.list 原生路径（Windows 反斜杠），
        // 而 workspace-events 的 dirs 可能为归一格式（dirOf）或原生格式（workspace.changed 后端事件）——
        // 归一化双向匹配，两条链路都精确命中（修复 tool.complete 子目录变更不刷新的既有隐患）。
        return norm === rootNorm || Object.keys(loadedDirsRef.current).some(
          (k) => k.replace(/\\/g, '/').replace(/\/+$/, '') === norm,
        );
      });
      if (!targets.length) return;

      for (const dir of targets) {
        delete cacheRef.current[dir]; // 强制重读（绕过缓存）
        try {
          const entries = await fetchDir(dir);
          cacheRef.current[dir] = entries;
          if (!mountedRef.current) continue;
          const norm = dir.replace(/\\/g, '/').replace(/\/+$/, '');
          if (norm === rootNorm) {
            // 🔴 2026-08-13 守卫：期间有新的 setRoot → 丢弃（setRoot 会写）
            if (seq === rootSeqRef.current) {
              setData(entries);
            }
          } else {
            setLoadedDirs((prev) => (prev[dir] === entries ? prev : { ...prev, [dir]: entries }));
          }
          setDirErrors((prev) => (prev[dir] ? { ...prev, [dir]: null } : prev));
        } catch (err) {
          // 保留旧数据（对齐 Hermes：transient read error keep last-known children）
          setDirErrors((prev) => ({ ...prev, [dir]: err instanceof Error ? err.message : String(err) }));
        }
      }
      return;
    }

    // ── 全量（opaque）：清缓存 + 重拉根 + refreshNonce ──
    cacheRef.current = {};
    setError(null);
    setLoading(true);
    try {
      const entries = await listDir(rootPath);
      // 🔴 2026-08-13 守卫：期间有新的 setRoot → 丢弃（setRoot 会写新数据）
      if (mountedRef.current && seq === rootSeqRef.current) {
        setData(entries);
      }
    } catch (err: unknown) {
      if (mountedRef.current && seq === rootSeqRef.current) {
        setError((err as Error).message || '读取目录失败');
        setData([]);
      }
    } finally {
      if (mountedRef.current && seq === rootSeqRef.current) {
        setLoading(false);
      }
      setRefreshNonce((n) => n + 1);
    }
    // 已展开目录重载（对齐原 FileBrowserPanel effect 循环；定向分支已增量更新无需此步）
    for (const dir of Object.keys(openStateRef.current)) {
      if (openStateRef.current[dir] && loadedDirsRef.current[dir] !== undefined) {
        void loadChildren(dir);
      }
    }
  }, [rootPath, listDir, loadChildren]);

  // 🔴 workspace.watch 订阅（外部文件变更感知，2026-08-13 Phase 1）：
  // rootPath 变化 → 重新订阅；WS 未连 → 静默失败（手动刷新兑底），
  // 连接恢复后无条件重发（后端同 path 幂等，替换式无副作用）；卸载 → unwatch。
  // 连接恢复时同时全量刷新一次：覆盖断开期间丢失的 workspace.changed 事件
  // （广播到空连接表被丢，重连后无法补发——全量重拉是唯一可靠恢复）。
  // 不影响现有 tool.complete 刷新链路（workspace-events 同源合并）。
  useEffect(() => {
    if (!rootPath) return;
    let cancelled = false;

    const tryWatch = async () => {
      try {
        const res = await getWsClient().workspaceWatch(rootPath);
        if (!cancelled) watchIdRef.current = res.id;
      } catch {
        // WS 未连/失败 → 手动刷新兑底；连接恢复后重试（下方 state 订阅）
      }
    };
    void tryWatch();

    // WS 连接恢复 → 重发 watch（幂等；原订阅若已失效则替换）
    // + 全量刷新一次：覆盖断开期间丢失的 workspace.changed（广播到空连接表被丢）
    const unsub = getWsClient().onStateChange((s) => {
      if (s === 'connected') {
        void tryWatch();
        void invalidate({ dirs: [], full: true });
      }
    });

    return () => {
      cancelled = true;
      unsub();
      if (watchIdRef.current) {
        const id = watchIdRef.current;
        watchIdRef.current = null;
        getWsClient().workspaceUnwatch(id).catch(() => {});
      }
    };
  }, [rootPath, invalidate]);

  /**
   * 折叠全部（对齐 Hermes collapseAll）：清空展开状态，整树收起。
   * ELEVE 的 TreeNode 直接受 openState 控制（受控状态），无需 Hermes 的
   * collapseNonce remount 方案。
   */
  const collapseAll = useCallback(() => {
    setOpenState({});
  }, []);

  return {
    data,
    loading,
    error,
    refresh,
    invalidate,
    refreshNonce,
    setRoot,
    loadChildren,
    openState,
    toggleOpen,
    collapseAll,
    rootPath,
    loadedDirs,
    loadingDirs,
    dirErrors,
  };
}
