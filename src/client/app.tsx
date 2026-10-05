import { lazy, Suspense, type ReactNode } from "react";

// Every route loads on demand: the chat carries the agent/chat/toast stacks,
// the standalone pages carry none of them.
const ChatApp = lazy(() => import("./components/ChatApp"));
const CheckPage = lazy(() => import("./components/CheckPage"));
const HostPage = lazy(() => import("./components/HostPage"));
const ReportPage = lazy(() => import("./components/ReportPage"));
const TrendingPage = lazy(() => import("./components/TrendingPage"));

function Loading({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center bg-kumo-elevated text-sm text-kumo-subtle">
          Loading…
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

export default function App() {
  let parts: string[] = [];
  try {
    parts = location.pathname
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
  } catch {
    // malformed escape: fall through to the chat
  }
  if (parts[0] === "r" && parts.length === 3) {
    return (
      <Loading>
        <ReportPage host={parts[1]} id={parts[2]} />
      </Loading>
    );
  }
  if (parts[0] === "h" && parts.length === 2) {
    return (
      <Loading>
        <HostPage host={parts[1]} />
      </Loading>
    );
  }
  if (parts[0] === "trending" && parts.length === 1) {
    return (
      <Loading>
        <TrendingPage />
      </Loading>
    );
  }
  if (parts[0] === "c" && parts.length === 2) {
    const ref = new URLSearchParams(location.search).get("ref") ?? undefined;
    return (
      <Loading>
        <CheckPage host={parts[1]} refId={ref} />
      </Loading>
    );
  }
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center bg-kumo-elevated text-sm text-kumo-subtle">
          Connecting…
        </div>
      }
    >
      <ChatApp />
    </Suspense>
  );
}
