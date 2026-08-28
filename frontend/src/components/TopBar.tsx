interface TopBarProps {
  value: string;
  onChange: (value: string) => void;
  onRefresh: () => void;
}

export function TopBar({ value, onChange, onRefresh }: TopBarProps) {
  return (
    <div className="flex items-center gap-3 border-b border-gray-100 px-8 py-4">
      <div className="relative flex-1">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
          <SearchIcon />
        </span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search"
          className="w-full rounded-lg bg-gray-50 py-2 pl-9 pr-3 text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
        />
      </div>
      <button onClick={onRefresh} title="Refresh" className="rounded p-2 text-gray-400 hover:bg-gray-50 hover:text-gray-600">
        <RefreshIcon />
      </button>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}
