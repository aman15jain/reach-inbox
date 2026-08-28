import { ReactNode } from "react";

export function FullScreenPanel({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-white">
      <div className="mx-auto max-w-5xl px-8 py-6">{children}</div>
    </div>
  );
}
