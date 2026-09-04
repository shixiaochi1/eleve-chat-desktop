/**
 * ReviewShipBar — 审查面板底部提交动作条（🔴 2026-09-05 对齐 Hermes
 * app/right-sidebar/review/ship-bar.tsx）
 *
 * - commit message 输入（Ctrl/⌘+Enter 提交）+ AI 起草（走 ELEVE 已有
 *   llm.oneshot RPC —— 辅助链 + 内置 API KEY，对齐 Hermes requestOneShot
 *   template commit_message；monotonic gen 代币支持中途停止）
 * - commit / commit+push 分裂按钮（VS Code 式；默认动作记忆 localStorage，
 *   对齐 $reviewCommitDefault）
 * - 无变更文件 → 不渲染（对齐 "Nothing to commit → no ship bar"）
 */
import { useState } from 'react';
import { Sparkles, Square, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  cancelCommitMessage,
  commitChanges,
  generateCommitMessage,
  useReview,
} from '@/store/review';
import { notifyError } from '@/utils/notifications';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

type CommitAction = 'commit' | 'commitPush';

const COMMIT_DEFAULT_KEY = 'eleve.reviewCommitDefault.v1';

function readCommitDefault(): CommitAction {
  try {
    return localStorage.getItem(COMMIT_DEFAULT_KEY) === 'commitPush' ? 'commitPush' : 'commit';
  } catch {
    return 'commit';
  }
}

function writeCommitDefault(action: CommitAction): void {
  try {
    localStorage.setItem(COMMIT_DEFAULT_KEY, action);
  } catch {
    /* 存储不可用 → 本次会话内存态生效 */
  }
}

export default function ReviewShipBar() {
  const { files, shipBusy, commitMsgBusy } = useReview();
  const [message, setMessage] = useState('');
  const [commitDefault, setCommitDefault] = useState<CommitAction>(readCommitDefault);

  const hasFiles = files.length > 0;
  const canCommit = hasFiles && !shipBusy && message.trim().length > 0;
  const canGenerate = hasFiles && !commitMsgBusy && !shipBusy;

  // 无变更 → 无 ship bar（对齐 Hermes）
  if (!hasFiles) return null;

  const runCommit = (action: CommitAction) => {
    void commitChanges(message, { push: action === 'commitPush' })
      .then((res) => {
        // push 失败不回滚 commit（后端契约）——如实 toast，不静默吞掉
        if (res.push_error) notifyError(new Error(res.push_error), '推送');
        setMessage('');
      })
      .catch((err) => notifyError(err, action === 'commitPush' ? '提交并推送' : '提交'));
  };

  const runGenerate = () => {
    void generateCommitMessage(message)
      .then((text) => {
        if (text) setMessage(text);
      })
      .catch((err) => notifyError(err, '生成提交信息'));
  };

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-[var(--ui-stroke-tertiary)] p-2">
      {/* message 输入（Ctrl/⌘+Enter 提交）；生成中右缘动作变停止 */}
      <div className="relative">
        <textarea
          className="max-h-40 min-h-[2rem] w-full resize-none rounded-md border border-[var(--ui-stroke-tertiary)] bg-transparent py-1.5 pl-2 pr-9 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
          disabled={commitMsgBusy}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              if (canCommit) runCommit(commitDefault);
            }
          }}
          placeholder="提交信息（Ctrl/⌘+Enter 提交）"
          rows={1}
          value={message}
        />
        <button
          aria-label={commitMsgBusy ? '停止生成' : 'AI 生成提交信息'}
          className={cn(
            'absolute right-1 top-1 grid h-6 w-7 place-items-center rounded text-muted-foreground/80 transition-colors hover:text-foreground',
            commitMsgBusy && 'text-foreground',
          )}
          disabled={!canGenerate && !commitMsgBusy}
          title={commitMsgBusy ? '停止生成' : 'AI 生成提交信息'}
          onClick={() => {
            if (commitMsgBusy) cancelCommitMessage();
            else runGenerate();
          }}
        >
          {commitMsgBusy ? <Square size={11} /> : <Sparkles size={13} />}
        </button>
      </div>

      {/* commit / commit+push 分裂按钮（VS Code 式：主按钮执行默认动作，右侧下拉切换默认） */}
      <div className="flex min-w-0">
        <button
          className={cn(
            'flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-l-md text-xs font-medium transition-colors',
            'bg-primary text-primary-foreground hover:brightness-[1.06] disabled:cursor-not-allowed disabled:opacity-50',
          )}
          disabled={!canCommit}
          onClick={() => runCommit(commitDefault)}
          title={commitDefault === 'commitPush' ? '提交并推送' : '提交'}
        >
          <Check size={13} />
          <span className="truncate">{commitDefault === 'commitPush' ? '提交并推送' : '提交'}</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="选择默认提交动作"
              className="flex h-7 w-6 items-center justify-center rounded-r-md border-l border-primary-foreground/20 bg-primary text-primary-foreground transition-colors hover:brightness-[1.06]"
            >
              <ChevronDown size={12} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              className="text-xs"
              onSelect={() => {
                setCommitDefault('commit');
                writeCommitDefault('commit');
              }}
            >
              提交{commitDefault === 'commit' && ' ✓'}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs"
              onSelect={() => {
                setCommitDefault('commitPush');
                writeCommitDefault('commitPush');
              }}
            >
              提交并推送{commitDefault === 'commitPush' && ' ✓'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
