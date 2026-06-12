'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import { useCallback } from 'react';

interface TiptapEditorProps {
  content?: string;
  onUpdate?: (html: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  minHeight?: string;
  onCtrlEnter?: () => void;
}

export default function TiptapEditor({ content = '', onUpdate, onBlur, placeholder, minHeight = '80px', onCtrlEnter }: TiptapEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'text-blue-600 underline cursor-pointer' },
      }),
      ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
    ],
    content,
    onUpdate: ({ editor: ed }) => {
      onUpdate?.(ed.getHTML());
    },
    onBlur: () => onBlur?.(),
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none px-3 py-2 text-sm text-slate-700 focus:outline-none',
        style: `min-height: ${minHeight}`,
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && onCtrlEnter) {
          event.preventDefault();
          onCtrlEnter();
          return true;
        }
        return false;
      },
    },
  });

  const setLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL', previousUrl);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  if (!editor) return null;

  const Btn = ({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: React.ReactNode; title: string }) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
        active ? 'bg-slate-200 text-slate-900' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800'
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="tiptap-editor border border-slate-200 rounded-lg overflow-hidden hover:border-slate-300 focus-within:ring-2 focus-within:ring-slate-400">
      <div className="flex gap-1 px-2 py-1.5 bg-slate-50 border-b border-slate-100">
        <Btn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
          <span className="text-xs font-bold">B</span>
        </Btn>
        <Btn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
          <span className="text-xs italic font-serif">I</span>
        </Btn>
        <Btn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline">
          <span className="text-xs underline">U</span>
        </Btn>
        <Btn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
          <span className="text-xs line-through">S</span>
        </Btn>
        <div className="w-px bg-slate-200 mx-0.5" />
        <Btn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
        </Btn>
        <Btn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6h11M10 12h11M10 18h11" /><text x="2" y="8" fontSize="7" fill="currentColor" stroke="none" fontFamily="sans-serif">1</text><text x="2" y="14" fontSize="7" fill="currentColor" stroke="none" fontFamily="sans-serif">2</text><text x="2" y="20" fontSize="7" fill="currentColor" stroke="none" fontFamily="sans-serif">3</text></svg>
        </Btn>
        <div className="w-px bg-slate-200 mx-0.5" />
        <Btn active={editor.isActive('link')} onClick={setLink} title="Link">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" /><path strokeLinecap="round" strokeLinejoin="round" d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
        </Btn>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
