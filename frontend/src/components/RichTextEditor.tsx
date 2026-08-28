import { useRef } from "react";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

const TOOLBAR_COMMANDS: Array<{ command: string; label: string; icon: string }> = [
  { command: "undo", label: "Undo", icon: "↺" },
  { command: "redo", label: "Redo", icon: "↻" },
  { command: "bold", label: "Bold", icon: "B" },
  { command: "italic", label: "Italic", icon: "I" },
  { command: "underline", label: "Underline", icon: "U" },
  { command: "insertUnorderedList", label: "Bullet list", icon: "•≡" },
  { command: "insertOrderedList", label: "Numbered list", icon: "1≡" },
  { command: "formatBlock:blockquote", label: "Quote", icon: "❝" },
  { command: "strikeThrough", label: "Strikethrough", icon: "S̶" },
];

export function RichTextEditor({ value, onChange, placeholder }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  function exec(command: string) {
    editorRef.current?.focus();
    const [cmd, arg] = command.split(":");
    document.execCommand(cmd, false, arg);
    onChange(editorRef.current?.innerHTML ?? "");
  }

  return (
    <div className="flex min-h-[320px] flex-col rounded-xl bg-gray-50">
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        className="editable-placeholder flex-1 px-4 py-4 text-sm leading-relaxed text-gray-800 outline-none"
        dangerouslySetInnerHTML={value ? undefined : { __html: "" }}
      />
      <div className="flex flex-wrap items-center gap-1 rounded-full bg-white px-3 py-2 mx-3 mb-3 shadow-sm border border-gray-100 w-fit">
        {TOOLBAR_COMMANDS.map((btn) => (
          <button
            key={btn.command}
            type="button"
            title={btn.label}
            onClick={() => exec(btn.command)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-xs text-gray-500 hover:bg-gray-100"
          >
            {btn.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
