import { api } from "./client";
import { EmailRow, PaginatedResult, ScheduleEmailPayload, Sender, SlackStatus } from "../types";

export async function fetchSenders(): Promise<Sender[]> {
  const { data } = await api.get<Sender[]>("/senders");
  return data;
}

export async function fetchScheduledEmails(page = 1): Promise<PaginatedResult<EmailRow>> {
  const { data } = await api.get<PaginatedResult<EmailRow>>("/emails/scheduled", { params: { page } });
  return data;
}

export async function fetchSentEmails(page = 1): Promise<PaginatedResult<EmailRow>> {
  const { data } = await api.get<PaginatedResult<EmailRow>>("/emails/sent", { params: { page } });
  return data;
}

export async function uploadLeadsFile(file: File): Promise<{ count: number; emails: string[] }> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<{ count: number; emails: string[] }>("/emails/upload-leads", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function scheduleEmails(payload: ScheduleEmailPayload): Promise<{ batchId: string; scheduled: number }> {
  const { data } = await api.post("/emails/schedule", payload);
  return data;
}

export async function fetchSlackStatus(): Promise<SlackStatus> {
  const { data } = await api.get<SlackStatus>("/slack/status");
  return data;
}

export async function connectSlack(): Promise<string> {
  const { data } = await api.get<{ url: string }>("/slack/connect");
  return data.url;
}

export async function disconnectSlack(): Promise<void> {
  await api.post("/slack/disconnect");
}
