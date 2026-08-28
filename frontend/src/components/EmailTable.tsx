import { EmailRow } from "../types";
import { StatusBadge } from "./ui/Badge";

interface EmailTableProps {
  rows: EmailRow[];
  isLoading: boolean;
  mode: "scheduled" | "sent";
}

export function EmailTable({ rows, isLoading, mode }: EmailTableProps) {
  if (isLoading) return <TableSkeleton />;
  if (rows.length === 0) return <EmptyState mode={mode} />;

  return (
    <div className="overflow-x-auto px-8 py-4">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-400">
            <th className="py-2 pr-4 font-medium">Email</th>
            <th className="py-2 pr-4 font-medium">Subject</th>
            <th className="py-2 pr-4 font-medium">{mode === "scheduled" ? "Scheduled time" : "Sent time"}</th>
            <th className="py-2 pr-4 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-gray-50 hover:bg-gray-50/60">
              <td className="py-3 pr-4 text-gray-800">{row.recipient}</td>
              <td className="max-w-xs truncate py-3 pr-4 text-gray-600">{row.subject}</td>
              <td className="py-3 pr-4 text-gray-500">
                {formatDate(mode === "scheduled" ? row.scheduledAt : row.sentAt ?? row.scheduledAt)}
              </td>
              <td className="py-3 pr-4">
                <StatusBadge status={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function TableSkeleton() {
  return (
    <div className="space-y-3 px-8 py-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-10 w-full animate-pulse rounded-lg bg-gray-100" />
      ))}
    </div>
  );
}

function EmptyState({ mode }: { mode: "scheduled" | "sent" }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-24 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-gray-50 text-gray-300">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </svg>
      </div>
      <p className="text-sm font-medium text-gray-700">
        {mode === "scheduled" ? "No scheduled emails yet" : "No sent emails yet"}
      </p>
      <p className="mt-1 text-xs text-gray-400">
        {mode === "scheduled" ? "Compose a new email to schedule your first send." : "Sent emails will show up here."}
      </p>
    </div>
  );
}
