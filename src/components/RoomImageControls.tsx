/**
 * 房间图控件（对齐 Hermes `GroupImageControls`，group-chat-parts.tsx:45-120）。
 *
 * 建房弹层（BotsPane）与房间设置（BotsView/RoomEditDialog）**共用同一份实现**：
 * 两处的"选图 / 归一化 / 清除 / 预览"必须给出同一个答案，第二份实现迟早在
 * 归一化口径（裁方？边长？格式？）上分叉。
 *
 * 与 Hermes 的差异（有意）：Hermes 还提供一个"Generate"按钮，走 `image.generate`
 * RPC（含 `probe` 探测后端是否具备生图能力）。ELEVE 没有对应的 **RPC**——生图
 * 面是 `image_generate` 工具而非网关 RPC。凭空造一个 RPC 只为填一个按钮不是
 * 对齐，是加接口债；故此处只保留 **上传 / 移除**（房间图功能本体：房间能有一
 * 张图）。生图按钮作为后续候选记录在案。
 */
import { useState } from 'react';
import { ImagePlus, Users, X } from 'lucide-react';
import { normalizeSquareImage, pickImageFile } from '@/lib/image-file';

interface RoomImageControlsProps {
  /** 当前房间图 data URL；null = 无图 */
  image: string | null;
  onImage: (image: string | null) => void;
  /** 归一化边长（对齐 Hermes avatar 管线：256） */
  edge?: number;
}

export default function RoomImageControls({ image, onImage, edge = 256 }: RoomImageControlsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
