import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FullScreenPanel } from "./ui/Modal";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import { RecipientsInput } from "./RecipientsInput";
import { RichTextEditor } from "./RichTextEditor";
import { SendLaterPopover } from "./SendLaterPopover";
import { fetchSenders, scheduleEmails } from "../api/emails";

interface ComposeModalProps {
  onClose: () => void;
  onScheduled: () => void;
}

interface Attachment {
  name: string;
  dataUrl: string;
}

export function ComposeModal({ onClose, onScheduled }: ComposeModalProps) {
  const queryClient = useQueryClient();
  const { data: senders } = useQuery({ queryKey: ["senders"], queryFn: fetchSenders });

  const [senderId, setSenderId] = useState<string>("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [delaySeconds, setDelaySeconds] = useState<number | "">("");
  const [hourlyLimit, setHourlyLimit] = useState<number | "">("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sendLaterOpen, setSendLaterOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeSenderId = senderId || senders?.[0]?.id || "";
  const activeSender = senders?.find((s) => s.id === activeSenderId);

  const mutation = useMutation({
    mutationFn: scheduleEmails,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-emails"] });
      onScheduled();
    },
    onError: () => setFormError("Couldn't schedule this batch. Check your inputs and try again."),
  });

  function handleAttach(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setAttachments((prev) => [...prev, { name: file.name, dataUrl }]);
      setBody((prev) => `${prev}<br/><img src="${dataUrl}" alt="${file.name}" style="max-width:240px;border-radius:8px" />`);
    };
    reader.readAsDataURL(file);
  }

  function validate(): string | null {
    if (!activeSenderId) return "Add a sender before composing.";
    if (recipients.length === 0) return "Add at least one recipient.";
    if (!subject.trim()) return "Subject is required.";
    if (!body.trim()) return "Email body can't be empty.";
    return null;
  }

  function submit(startTime: Date) {
    const error = validate();
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    mutation.mutate({
      senderId: activeSenderId,
      subject,
      body,
      recipients,
      startTime: startTime.toISOString(),
      delayBetweenEmailsMs: (Number(delaySeconds) || 0) * 1000,
      hourlyLimit: Number(hourlyLimit) || 200,
    });
  }

  function handlePrimaryAction() {
    if (!scheduledAt) {
      setSendLaterOpen(true);
      return;
    }
    submit(scheduledAt);
  }

  return (
    <FullScreenPanel>
      <div className="mb-6 flex items-center justify-between">
        <button onClick={onClose} className="flex items-center gap-2 text-lg font-medium text-gray-800">
          <span aria-hidden>←</span> Compose New Email
        </button>
        <div className="relative flex items-center gap-3">
          <button
            title="Attach image"
            onClick={() => fileInputRef.current?.click()}
            className="relative rounded-full p-2 text-gray-500 hover:bg-gray-50"
          >
            <ClipIcon />
            {attachments.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-500 text-[10px] text-white">
                {attachments.length}
              </span>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleAttach(file);
              e.target.value = "";
            }}
          />
          <button
            title="Send later"
            onClick={() => setSendLaterOpen((v) => !v)}
            className="rounded-full p-2 text-gray-500 hover:bg-gray-50"
          >
            <ClockIcon />
          </button>
          <Button onClick={handlePrimaryAction} disabled={mutation.isPending}>
            {mutation.isPending ? "Scheduling..." : scheduledAt ? "Send" : "Send Later"}
          </Button>
          {sendLaterOpen && (
            <SendLaterPopover
              onCancel={() => setSendLaterOpen(false)}
              onConfirm={(date) => {
                setScheduledAt(date);
                setSendLaterOpen(false);
              }}
            />
          )}
        </div>
      </div>

      {scheduledAt && (
        <p className="mb-3 text-xs text-gray-500">
          Scheduled to start {scheduledAt.toLocaleString()} —{" "}
          <button className="text-brand-600 underline" onClick={() => setSendLaterOpen(true)}>
            change
          </button>
        </p>
      )}

      {formError && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{formError}</p>}

      <div className="flex items-center gap-3 border-b border-gray-100 py-3">
        <span className="shrink-0 text-sm text-gray-500">From</span>
        <select
          value={activeSenderId}
          onChange={(e) => setSenderId(e.target.value)}
          className="rounded-full bg-gray-50 px-3 py-1.5 text-sm text-gray-700"
        >
          {senders?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.email}
            </option>
          ))}
        </select>
      </div>

      <RecipientsInput recipients={recipients} onChange={setRecipients} />

      <div className="border-b border-gray-100 py-3">
        <Input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
          className="border-none bg-transparent px-0 text-sm focus:ring-0"
        />
      </div>

      <div className="flex items-center gap-6 border-b border-gray-100 py-3">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          Delay between 2 emails (sec)
          <Input
            type="number"
            min={0}
            value={delaySeconds}
            onChange={(e) => setDelaySeconds(e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="00"
            className="w-16"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          Hourly Limit
          <Input
            type="number"
            min={0}
            value={hourlyLimit}
            onChange={(e) => setHourlyLimit(e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="00"
            className="w-16"
          />
        </label>
        {activeSender && <span className="ml-auto text-xs text-gray-400">Sending via {activeSender.displayName}</span>}
      </div>

      <div className="mt-4">
        <RichTextEditor value={body} onChange={setBody} placeholder="Type Your Reply..." />
      </div>

      {attachments.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3">
          {attachments.map((a) => (
            <img key={a.name} src={a.dataUrl} alt={a.name} className="h-20 w-20 rounded-lg object-cover" />
          ))}
        </div>
      )}
    </FullScreenPanel>
  );
}

function ClipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21.44 11.05 12.25 20.24a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.67 3.67 0 0 1 5.19 5.19L9.66 17.65a1.83 1.83 0 0 1-2.6-2.6l8.49-8.48" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}
