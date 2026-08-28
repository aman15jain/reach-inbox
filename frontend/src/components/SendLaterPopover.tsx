import { useState } from "react";
import { Button } from "./ui/Button";

interface SendLaterPopoverProps {
  onCancel: () => void;
  onConfirm: (date: Date) => void;
}

function preset(label: string, date: Date) {
  return { label, date };
}

function buildPresets(): Array<{ label: string; date: Date }> {
  const tomorrow9am = new Date();
  tomorrow9am.setDate(tomorrow9am.getDate() + 1);
  tomorrow9am.setHours(9, 0, 0, 0);

  const at = (hour: number, minute = 0) => {
    const d = new Date(tomorrow9am);
    d.setHours(hour, minute, 0, 0);
    return d;
  };

  return [
    preset("Tomorrow", tomorrow9am),
    preset("Tomorrow, 10:00 AM", at(10)),
    preset("Tomorrow, 11:00 AM", at(11)),
    preset("Tomorrow, 3:00 PM", at(15)),
  ];
}

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

export function SendLaterPopover({ onCancel, onConfirm }: SendLaterPopoverProps) {
  const [picked, setPicked] = useState<Date | null>(null);
  const presets = buildPresets();

  return (
    <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded-xl border border-gray-100 bg-white p-4 shadow-lg">
      <p className="mb-3 text-sm font-semibold text-gray-800">Send Later</p>
      <input
        type="datetime-local"
        value={picked ? toLocalInputValue(picked) : ""}
        min={toLocalInputValue(new Date())}
        onChange={(e) => setPicked(e.target.value ? new Date(e.target.value) : null)}
        className="mb-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
      />
      <div className="mb-3 space-y-1">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => setPicked(p.date)}
            className={`block w-full rounded-lg px-2 py-1.5 text-left text-sm ${
              picked?.getTime() === p.date.getTime() ? "bg-brand-50 text-brand-700" : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!picked} onClick={() => picked && onConfirm(picked)}>
          Done
        </Button>
      </div>
    </div>
  );
}
