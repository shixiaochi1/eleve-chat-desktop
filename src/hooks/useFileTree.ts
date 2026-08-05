/**
 * useFileTree — 文件树 Hook
 *
 * 统一通过后端 WS `files.list` 列出目录内容（唯一数据源）
 * 支持缓存、排序（后端目录优先+字母序）、展开/折叠
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { call } from '../utils/bridge';

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
    if (!path) {
      setRootPath(null);
      setData(null);
      setError(null);
      setOpenState({});
      return;
    }

    setRootPath(path);
    setLoading(true);
    setError(null);
    // 切换根目录：重置展开状态 + 目录缓存 + 已加载子树（旧树状态不能残留到新目录）
    setOpenState({});
    setLoadedDirs({});
    cacheRef.current = {};

    try {
      const entries = await listDir(path);
      if (mountedRef.current) {
        setData(entries);
      }
    } catch (err: unknown) {
      if (mountedRef.current) {
        setError((err as Error).message || '读取目录失败');
        setData([]);
      }
    } finally {
      if (mountedRef.current) {
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
   * 非破坏刷新（对齐 Hermes revalidateTree）：失效全部缓存 + 重拉根数据，
   * 保留展开状态（openState 不动）；已展开目录由 TreeNode 消费 refreshNonce
   * 重新加载。workspace tick 自动刷新用；手动刷新按钮仍走 refresh()（含重置）。
   */
  const invalidate = useCallback(async () => {
    if (!rootPath) return;
    cacheRef.current = {};
    setError(null);
    setLoading(true);
    try {
      const entries = await listDir(rootPath);
      if (mountedRef.current) {
        setData(entries);
      }
    } catch (err: unknown) {
      if (mountedRef.current) {
        setError((err as Error).message || '读取目录失败');
        setData([]);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
      setRefreshNonce((n) => n + 1);
    }
  }, [rootPath, listDir]);

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
