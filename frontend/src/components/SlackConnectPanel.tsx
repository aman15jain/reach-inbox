import { useState } from "react";
import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { connectSlack, disconnectSlack, fetchSlackStatus } from "../api/emails";
import { Button } from "./ui/Button";

export function SlackConnectPanel() {
  const queryClient = useQueryClient();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusQuery = useQuery({ queryKey: ["slack-status"], queryFn: fetchSlackStatus });

  const disconnectMutation = useMutation({
    mutationFn: disconnectSlack,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["slack-status"] }),
  });

  async function handleConnect() {
    setError(null);
    setConnecting(true);
    try {
      const url = await connectSlack();
      // Full-page redirect into Slack's real OAuth consent screen — this
      // flow only works as a top-level navigation, not an XHR.
      window.location.href = url;
    } catch (err) {
      setConnecting(false);
      if (axios.isAxiosError(err) && err.response?.status === 503) {
        setError("Slack isn't configured on the server yet.");
      } else {
        setError("Couldn't start Slack connection. Please try again.");
      }
    }
  }

  if (statusQuery.isLoading) {
    return <div className="mt-4 h-14 animate-pulse rounded-lg bg-gray-50" />;
  }

  const connected = statusQuery.data?.connected ?? false;

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Notifications</p>

      {connected ? (
        <div className="rounded-lg bg-gray-50 px-3 py-2.5">
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />
            <span className="font-medium">Slack Connected</span>
          </div>
          {statusQuery.data?.teamName && <p className="mt-0.5 truncate pl-4 text-xs text-gray-400">{statusQuery.data.teamName}</p>}
          <button
            onClick={() => disconnectMutation.mutate()}
            disabled={disconnectMutation.isPending}
            className="mt-1.5 pl-4 text-xs text-gray-400 underline hover:text-gray-600 disabled:opacity-50"
          >
            {disconnectMutation.isPending ? "Disconnecting..." : "Disconnect"}
          </button>
        </div>
      ) : (
        <Button variant="outline" onClick={handleConnect} disabled={connecting} className="w-full">
          <SlackIcon />
          {connecting ? "Connecting..." : "Connect Slack"}
        </Button>
      )}

      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
    </div>
  );
}

function SlackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="2" width="9" height="9" rx="2" fill="#36C5F0" />
      <rect x="13" y="2" width="9" height="9" rx="2" fill="#2EB67D" />
      <rect x="2" y="13" width="9" height="9" rx="2" fill="#ECB22E" />
      <rect x="13" y="13" width="9" height="9" rx="2" fill="#E01E5A" />
    </svg>
  );
}
