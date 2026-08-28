export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
}

export interface Sender {
  id: string;
  email: string;
  displayName: string;
}

export type EmailStatus = "scheduled" | "processing" | "rate_limited_delayed" | "sent" | "failed";

export interface EmailRow {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt?: string | null;
  error?: string | null;
  sender: { email: string };
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ScheduleEmailPayload {
  senderId: string;
  subject: string;
  body: string;
  recipients: string[];
  startTime: string;
  delayBetweenEmailsMs: number;
  hourlyLimit: number;
}

export interface SlackStatus {
  connected: boolean;
  teamName: string | null;
}
