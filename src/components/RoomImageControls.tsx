/**
 * 房间图控件（对齐 Hermes `GroupImageControls`，group-chat-parts.tsx:45-120）。
 *
 * 建房弹层（BotsPane）与房间设置（BotsView/RoomEditDialog）**共用同一份实现**：
 * 两处的"选图 / 生成 / 归一化 / 清除 / 预览"必须给出同一个答案，第二份实现
 * 迟早在归一化口径（裁方？边长？格式？）上分叉。
 *
 * 🔴 round-100 纠正 round-97 的注释：此前这里写着"ELEVE 没有对应的 RPC——生图面
 * 是 `image_generate` 工具而非网关 RPC，凭空造 RPC 是加接口债，故只保留上传/移除"。
 * **该判断是错的**：生图是**平台能力**，网关早有 L2 无会话旁路的 HTTP 面
 * （`POST /v1/images/generations`，`handlers/media_gen.rs:4`），前端也早有 HTTP base。
 * 所以"生成"按钮不需要任何新接口，见 `lib/media-gen.ts`。
 * 教训：**"有没有 RPC"不是判据——"这个能力由谁提供、以什么形态提供"才是。**
 */
import { useEffect, useState } from 'react';
import { ImagePlus, Sparkles, Users, X } from 'lucide-react';
import { normalizeSquareImage, pickImageFile } from '@/lib/image-file';
import { buildRoomImagePrompt, generateRoomImage, probeImageGen } from '@/lib/media-gen';

interface RoomImageControlsProps {
  /** 当前房间图 data URL；null = 无图 */
  image: string | null;
  onImage: (image: string | null) => void;
  /** 归一化边长（对齐 Hermes avatar 管线：256） */
  edge?: number;
  /** 生成用房间名（对齐 Hermes `seedName`）；缺省 → 通用名 */
  name?: string;
  /** 生成用成员名（对齐 Hermes `seedMembers`，拼进 prompt 的 "a team of …"） */
  memberHandles?: string[];
}

export default function RoomImageControls({
  image,
  onImage,
  edge = 256,
  name = '',
  memberHandles = [],
}: RoomImageControlsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 🔴 round-100：生图能力探测（对齐 Hermes `avatar-image.ts:82` 的 `{available}` probe）
  // ——无可用渠道时**禁用按钮**，而不是让用户点了等超时才报错。
  // null = 探测中（此时也不放行点击，避免竞态下点了必失败的按钮）。
  const [canGenerate, setCanGenerate] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void probeImageGen().then((ok) => {
      if (alive) setCanGenerate(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  const upload = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const raw = await pickImageFile();
      if (!raw) {
        // 取消 / 超限 / 读失败——不动现有图（绝不把"没选成"当成"清除"）
        return;
      }
      onImage(await normalizeSquareImage(raw, edge));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // 生成：prompt 由房间名 + 成员构造（**无输入框**，对齐 Hermes）；
  // 归一化口径与上传路径完全一致（同一个 normalizeSquareImage）。
  const generate = async () => {
    if (busy || canGenerate !== true) return;
    setError(null);
    setBusy(true);
    try {
      const prompt = buildRoomImagePrompt(name, memberHandles);
      const raw = await generateRoomImage(prompt);
      onImage(await normalizeSquareImage(raw, edge));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const genTitle =
    canGenerate === null
      ? '正在检查生图渠道…'
      : canGenerate
        ? '按房间名生成一张图标'
        : '暂无可用生图渠道——请先在设置里配置生图模型';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        {/* 预览：圆形（对齐 Hermes rounded-full + object-cover；归一化已裁方） */}
        <div className="size-10 shrink-0 overflow-hidden rounded-full bg-accent/30 flex items-center justify-center">
          {image ? (
            <img src={image} alt="" className="size-full object-cover" />
          ) : (
            <Users size={16} className="text-muted-foreground" />
          )}
        </div>
        <button
          type="button"
          className="px-2.5 py-1 rounded-md bg-accent/40 text-xs text-foreground hover:bg-accent/60 disabled:opacity-40"
          disabled={busy}
          onClick={() => void upload()}
        >
          <ImagePlus size={12} className="inline -mt-0.5 mr-1" />
          {image ? '更换图片' : '上传图片'}
        </button>
        <button
          type="button"
          className="px-2.5 py-1 rounded-md bg-accent/40 text-xs text-foreground hover:bg-accent/60 disabled:opacity-40"
          disabled={busy || canGenerate !== true}
          title={genTitle}
          onClick={() => void generate()}
        >
          <Sparkles size={12} className="inline -mt-0.5 mr-1" />
          {busy ? '处理中…' : '生成'}
        </button>
        {image && (
          <button
            type="button"
            className="px-2 py-1 rounded-md text-xs text-muted-foreground hover:bg-accent/40 inline-flex items-center gap-1"
            onClick={() => onImage(null)}
          >
            <X size={11} />
            移除
          </button>
        )}
      </div>
      {error && <div className="text-[11px] text-destructive">{error}</div>}
    </div>
  );
}
