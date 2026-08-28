import { EmailStatus } from "../../types";

const STATUS_STYLES: Record<EmailStatus, string> = {
  scheduled: "bg-amber-50 text-amber-700",
  processing: "bg-blue-50 text-blue-700",
  rate_limited_delayed: "bg-orange-50 text-orange-700",
  sent: "bg-brand-50 text-brand-700",
  failed: "bg-red-50 text-red-700",
};

const STATUS_LABELS: Record<EmailStatus, string> = {
  scheduled: "Scheduled",
  processing: "Sending",
  rate_limited_delayed: "Rate limited",
  sent: "Sent",
  failed: "Failed",
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
