import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Sidebar, DashboardTab } from "../components/Sidebar";
import { TopBar } from "../components/TopBar";
import { EmailTable } from "../components/EmailTable";
import { ComposeModal } from "../components/ComposeModal";
import { fetchScheduledEmails, fetchSentEmails, searchEmails } from "../api/emails";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { EmailRow, EmailSearchHit } from "../types";

const STATUSES_BY_TAB: Record<DashboardTab, EmailRow["status"][]> = {
  scheduled: ["scheduled", "processing", "rate_limited_delayed"],
  sent: ["sent", "failed"],
};

function toEmailRow(hit: EmailSearchHit): EmailRow {
  return {
    id: hit.id,
    recipient: hit.recipient,
    subject: hit.subject,
    body: hit.body,
    status: hit.status,
    scheduledAt: hit.scheduledAt,
    sentAt: hit.sentAt,
    sender: { email: hit.senderEmail },
  };
}

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

  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const isSearching = debouncedSearch.length > 0;

  // Real Elasticsearch-backed search (GET /api/emails/search), not just a
  // client-side filter of whatever page happens to already be loaded.
  const searchQuery = useQuery({
    queryKey: ["search-emails", debouncedSearch],
    queryFn: () => searchEmails(debouncedSearch),
    enabled: isSearching,
  });

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

  const rows = useMemo(() => {
    const tabStatuses = STATUSES_BY_TAB[tab];

    if (isSearching) {
      // If Elasticsearch is unreachable, searchEmails() comes back
      // `degraded: true` with no hits — fall back to filtering whatever
      // page is already loaded instead of showing a false "no results".
      if (searchQuery.data && !searchQuery.data.degraded) {
        return searchQuery.data.hits.filter((h) => tabStatuses.includes(h.status)).map(toEmailRow);
      }
      const loaded = activeQuery.data?.items ?? [];
      const q = debouncedSearch.toLowerCase();
      return loaded.filter((r) => r.recipient.toLowerCase().includes(q) || r.subject.toLowerCase().includes(q));
    }

    return activeQuery.data?.items ?? [];
  }, [isSearching, searchQuery.data, activeQuery.data, tab, debouncedSearch]);

  const isLoading = isSearching ? searchQuery.isLoading : activeQuery.isLoading;

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

        {isSearching && searchQuery.data?.degraded && (
          <p className="mx-8 mt-4 text-xs text-amber-600">
            Search is temporarily degraded — showing matches from what's already loaded instead of the full index.
          </p>
        )}

        <EmailTable rows={rows} isLoading={isLoading} mode={tab} />
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
