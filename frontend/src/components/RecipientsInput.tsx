import { useRef, useState } from "react";
import { uploadLeadsFile } from "../api/emails";

interface RecipientsInputProps {
  recipients: string[];
  onChange: (recipients: string[]) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function RecipientsInput({ recipients, onChange }: RecipientsInputProps) {
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function addFromDraft() {
    const candidate = draft.trim().replace(/,$/, "");
    if (candidate && EMAIL_RE.test(candidate) && !recipients.includes(candidate)) {
      onChange([...recipients, candidate]);
    }
    setDraft("");
  }

  function removeRecipient(email: string) {
    onChange(recipients.filter((r) => r !== email));
  }

  async function handleFile(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const { emails } = await uploadLeadsFile(file);
      const merged = Array.from(new Set([...recipients, ...emails]));
      onChange(merged);
    } catch {
      setUploadError("Couldn't parse that file. Try a CSV or plain text file with one email per line.");
    } finally {
      setUploading(false);
    }
  }

  const visible = expanded ? recipients : recipients.slice(0, 3);
  const hiddenCount = recipients.length - visible.length;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 py-3">
        <span className="mt-1.5 shrink-0 text-sm text-gray-500">To</span>
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {visible.map((email) => (
            <span
              key={email}
              className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs text-brand-700"
            >
              {email}
              <button onClick={() => removeRecipient(email)} className="text-brand-400 hover:text-brand-600">
                ×
              </button>
            </span>
          ))}
          {hiddenCount > 0 && (
            <button
              onClick={() => setExpanded(true)}
              className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs text-brand-700"
            >
              +{hiddenCount}
            </button>
          )}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "," || e.key === " ") {
                e.preventDefault();
                addFromDraft();
              }
            }}
            onBlur={addFromDraft}
            placeholder={recipients.length === 0 ? "recipient@example.com" : "Add another..."}
            className="min-w-[180px] flex-1 border-none bg-transparent py-1 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none"
          />
        </div>
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="flex shrink-0 items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
        >
          <UploadIcon />
          {uploading ? "Parsing..." : "Upload List"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.txt"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
      </div>
      {uploadError && <p className="mt-1 text-xs text-red-500">{uploadError}</p>}
      {recipients.length > 0 && <p className="mt-1 text-xs text-gray-400">{recipients.length} recipient(s) detected</p>}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}
