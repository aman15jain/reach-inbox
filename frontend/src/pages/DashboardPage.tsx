import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Sidebar, DashboardTab } from "../components/Sidebar";
import { TopBar } from "../components/TopBar";
import { EmailTable } from "../components/EmailTable";
import { ComposeModal } from "../components/ComposeModal";
import { fetchScheduledEmails, fetchSentEmails } from "../api/emails";

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<DashboardTab>("scheduled");
  const [search, setSearch] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [slackBanner, setSlackBanner] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const scheduledQuery = useQuery({ queryKey: ["scheduled-emails"], queryFn: () => fetchScheduledEmails() });
  const sentQuery = useQuery({ queryKey: ["sent-emails"], queryFn: () => fetchSentEmails() });

  const activeQuery = tab === "scheduled" ? scheduledQuery : sentQuery;

  // The Slack OAuth callback (backend, not this app) redirects here with
  // ?slack=connected|error after the user authorizes on Slack's side.
  useEffect(() => {
    const slackResult = searchParams.get("slack");
    if (!slackResult) return;

    if (slackResult === "connected") {
      setSlackBanner({ type: "success", message: "Slack connected successfully." });
      queryClient.invalidateQueries({ queryKey: ["slack-status"] });
    } else if (slackResult === "error") {
      setSlackBanner({ type: "error", message: "Slack connection failed. Please try again." });
    }

    const next = new URLSearchParams(searchParams);
    next.delete("slack");
    setSearchParams(next, { replace: true });
    // Intentionally runs once on mount: this only reacts to the query
    // param the OAuth redirect lands with, not to ongoing param changes.
  }, []);

  const filteredRows = useMemo(() => {
    const rows = activeQuery.data?.items ?? [];
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) => r.recipient.toLowerCase().includes(q) || r.subject.toLowerCase().includes(q));
  }, [activeQuery.data, search]);

  return (
    <div className="flex h-screen bg-white">
      <Sidebar
        activeTab={tab}
        onChangeTab={setTab}
        scheduledCount={scheduledQuery.data?.total ?? 0}
        sentCount={sentQuery.data?.total ?? 0}
        onCompose={() => setComposeOpen(true)}
      />
      <main className="flex-1 overflow-y-auto">
        <TopBar value={search} onChange={setSearch} onRefresh={() => activeQuery.refetch()} />

        {slackBanner && (
          <div
            className={`mx-8 mt-4 flex items-center justify-between rounded-lg px-3 py-2 text-xs ${
              slackBanner.type === "success" ? "bg-brand-50 text-brand-700" : "bg-red-50 text-red-600"
            }`}
          >
            {slackBanner.message}
            <button onClick={() => setSlackBanner(null)} className="ml-3 opacity-60 hover:opacity-100">
              ×
            </button>
          </div>
        )}

        <EmailTable rows={filteredRows} isLoading={activeQuery.isLoading} mode={tab} />
      </main>

      {composeOpen && (
        <ComposeModal
          onClose={() => setComposeOpen(false)}
          onScheduled={() => {
            setComposeOpen(false);
            setTab("scheduled");
          }}
        />
      )}
    </div>
  );
}
