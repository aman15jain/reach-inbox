import { useAuth } from "../context/AuthContext";
import { Button } from "./ui/Button";
import { SlackConnectPanel } from "./SlackConnectPanel";

export type DashboardTab = "scheduled" | "sent";

interface SidebarProps {
  activeTab: DashboardTab;
  onChangeTab: (tab: DashboardTab) => void;
  scheduledCount: number;
  sentCount: number;
  onCompose: () => void;
}

export function Sidebar({ activeTab, onChangeTab, scheduledCount, sentCount, onCompose }: SidebarProps) {
  const { user, logout } = useAuth();

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-gray-100 bg-white px-4 py-5">
      <div className="mb-6 text-xl font-black tracking-tight">ONB</div>

      <div className="mb-5 flex items-center gap-2 rounded-lg px-1 py-1">
        {user?.avatarUrl ? (
          <img src={user.avatarUrl} alt={user.name} className="h-9 w-9 rounded-full object-cover" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
            {user?.name?.[0]?.toUpperCase() ?? "?"}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-900">{user?.name}</p>
          <p className="truncate text-xs text-gray-400">{user?.email}</p>
        </div>
        <button onClick={logout} title="Logout" className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
          <LogoutIcon />
        </button>
      </div>

      <Button onClick={onCompose} className="mb-6 w-full">
        Compose
      </Button>

      <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Core</p>
      <nav className="space-y-1">
        <NavItem
          label="Scheduled"
          count={scheduledCount}
          icon={<ClockIcon />}
          active={activeTab === "scheduled"}
          onClick={() => onChangeTab("scheduled")}
        />
        <NavItem
          label="Sent"
          count={sentCount}
          icon={<SendIcon />}
          active={activeTab === "sent"}
          onClick={() => onChangeTab("sent")}
        />
      </nav>

      <SlackConnectPanel />
    </aside>
  );
}

function NavItem({
  label,
  count,
  icon,
  active,
  onClick,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
        active ? "bg-brand-50 text-brand-700" : "text-gray-600 hover:bg-gray-50"
      }`}
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      <span className="text-xs text-gray-400">{count}</span>
    </button>
  );
}

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}
