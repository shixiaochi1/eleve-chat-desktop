/**
 * CodeEditor — CodeMirror 6 spot-edit 编辑器（移植 Hermes code-editor.tsx）
 *
 * 定位：文件预览的内嵌编辑（非 IDE）——行号/历史/选区/括号匹配/语法高亮。
 * 无折叠 gutter/自动补全/active-line 装饰（与只读预览观感一致）。
 * 自身持有 buffer；父组件经 onChange 追踪 dirty，换文件/丢弃编辑 =
 * 换 React key 重挂载。
 *
 * 快捷键：Ctrl/⌘+S 或 Ctrl/⌘+Enter 保存；Esc 取消。
 * 主题跟随应用明暗（isDark），不丢光标。
 *
 * 与 Hermes 差异（架构干净：只移植有消费方的面）：
 * - 去 formatJson/framed/highlight/apiRef——ELEVE 无对应消费方（Hermes 用于
 *   SOUL.md/配置编辑等，ELEVE 尚未有），消费方出现再补，不预置死代码
 */

import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { useTheme } from '@/themes/context';
import { githubEditorTheme } from './code-editor-theme';

interface CodeEditorProps {
  /** Read-only: 保存进行中阻塞编辑（不卸载编辑器） */
  disabled?: boolean;
  filePath: string;
  /** 挂载时读一次；换文件/丢弃编辑 = 换 key 重挂载，不推新值 */
  initialValue: string;
  onCancel?: () => void;
  onChange: (value: string) => void;
  /** Ctrl/⌘+S 或 Ctrl/⌘+Enter */
  onSave?: () => void;
}

function baseName(filePath: string): string {
  const cleaned = filePath.replace(/[\\/]+$/, '');
  return cleaned.slice(cleaned.lastIndexOf('/') + 1).split('\\').pop() ?? cleaned;
}

export function CodeEditor({ disabled = false, filePath, initialValue, onCancel, onChange, onSave }: CodeEditorProps) {
  const { isDark } = useTheme();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageConf = useRef(new Compartment());
  const themeConf = useRef(new Compartment());
  const editableConf = useRef(new Compartment());
  const onCancelRef = useRef(onCancel);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onCancelRef.current = onCancel;
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  // 挂载时创建一次；父组件换 key 重挂载载入新 buffer
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const save = () => {
      onSaveRef.current?.();
      return true;
    };

    const state = EditorState.create({
      doc: initialValue,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
          { key: 'Mod-s', preventDefault: true, run: save },
          { key: 'Mod-Enter', preventDefault: true, run: save },
          {
            key: 'Escape',
            run: () => {
              if (!onCancelRef.current) return false;
              onCancelRef.current();
              return true;
            },
          },
        ]),
        languageConf.current.of([]),
        themeConf.current.of(githubEditorTheme(isDark)),
        editableConf.current.of(EditorState.readOnly.of(disabled)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ parent: host, state });
    viewRef.current = view;
    // 挂载即聚焦：进入编辑模式光标就位，免额外点击
    view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // 按文件扩展名懒加载语法高亮
  useEffect(() => {
    let cancelled = false;
    const description = LanguageDescription.matchFilename(languages, baseName(filePath));
    if (!description) {
      viewRef.current?.dispatch({ effects: languageConf.current.reconfigure([]) });
      return;
    }
    void description.load().then((support) => {
      if (!cancelled && viewRef.current) {
        viewRef.current.dispatch({ effects: languageConf.current.reconfigure(support) });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeConf.current.reconfigure(githubEditorTheme(isDark)),
    });
  }, [isDark]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editableConf.current.reconfigure(EditorState.readOnly.of(disabled)),
    });
  }, [disabled]);

  return <div className="h-full min-h-0 overflow-hidden" ref={hostRef} />;
}
