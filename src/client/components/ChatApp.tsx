import { useCallback, useEffect, useRef, useState } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { Button, InputArea, PoweredByCloudflare } from "@cloudflare/kumo";
import { Toasty, useKumoToastManager } from "@cloudflare/kumo/components/toast";
import {
  BrowserIcon,
  CircleNotchIcon,
  CloudIcon,
  TrendUpIcon,
  EyeIcon,
  ListIcon,
  MoonIcon,
  PaperPlaneRightIcon,
  PulseIcon,
  StopIcon,
  SunIcon,
  TrashIcon,
  WarningIcon,
  XIcon
} from "@phosphor-icons/react";
import type { UserAgent } from "../../agents/user-agent";
import type {
  AgentBroadcast,
  AgentState,
  BrowserProbe,
  CheckOutcome,
  ExtraCheck,
  ReportSummary
} from "../../shared/types";
import { runBrowserProbe } from "../probe";
import { normalizeTarget } from "../../lib/guard";
import DiagnosisCard from "./DiagnosisCard";
import Sidebar from "./Sidebar";
import { duplicateErrorIds } from "../format";
import { Brand, Markdown, VERDICTS, VerdictDot, netLabel } from "./ui";

const DEVICE_KEY = "isitme:deviceId";
let memoryDeviceId: string | undefined;

/** Stable anonymous id, used as the UserAgent name. Matches server DEVICE_ID /^[A-Za-z0-9_-]{16,64}$/. */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    // ponytail: storage blocked (private mode) -> one identity per page load
    return (memoryDeviceId ??= crypto.randomUUID());
  }
}

const EXAMPLES = [
  "Is github.com down?",
  "Why is my bank site slow?",
  "Watch example.com every 5 minutes"
];

function ThemeToggle() {
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute("data-mode") === "dark"
  );
  const toggle = () => {
    const mode = dark ? "light" : "dark";
    setDark(!dark);
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.style.colorScheme = mode;
    try {
      localStorage.setItem("theme", mode);
    } catch {
      // not persisted
    }
  };
  return (
    <Button
      variant="ghost"
      shape="square"
      icon={dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
      onClick={toggle}
      aria-label="Toggle theme"
    />
  );
}

// ── Non-diagnose tool parts ──────────────────────────────────────────

type ToolPart = Extract<UIMessage["parts"][number], { toolCallId: string }>;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function ToolChip({ name, part }: { name: string; part: ToolPart }) {
  const base =
    "flex items-center gap-2 rounded-xl border border-kumo-line bg-kumo-base px-3 py-2 text-sm";
  if (part.state === "output-error") {
    return (
      <div className={`${base} text-kumo-danger`}>
        <WarningIcon size={14} /> {name} failed: {part.errorText}
      </div>
    );
  }
  if (part.state !== "output-available") {
    return (
      <div className={`${base} text-kumo-subtle`}>
        <CircleNotchIcon size={14} className="animate-spin" /> Working on {name}
        …
      </div>
    );
  }
  const out: unknown = part.output;
  if (name === "history" && Array.isArray(out)) {
    const rows = out as ReportSummary[];
    return (
      <div className="rounded-xl border border-kumo-line bg-kumo-base p-2">
        {rows.length === 0 && (
          <p className="px-2 py-1 text-sm text-kumo-subtle">
            No past checks yet.
          </p>
        )}
        {rows.map((r) => (
          <a
            key={r.id}
            href={`/r/${r.host}/${r.id}`}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-kumo-tint"
          >
            <VerdictDot verdict={r.verdict} />
            <span className="font-mono text-[13px] text-kumo-default">
              {r.host}
            </span>
            <span className="text-kumo-subtle">
              {VERDICTS[r.verdict]?.label}
            </span>
            <span className="ml-auto text-xs text-kumo-subtle">
              {new Date(r.createdAt).toLocaleString()}
            </span>
          </a>
        ))}
      </div>
    );
  }
  if (isObj(out) && out.ok === false) {
    return (
      <div className={`${base} text-kumo-danger`}>
        <WarningIcon size={14} /> {String(out.error ?? `${name} failed`)}
      </div>
    );
  }
  let text = "Done";
  if (isObj(out)) {
    if (name === "watch")
      text = `Watching ${out.host} every ${out.everyMinutes} min. Alerts land in the sidebar.`;
    else if (name === "unwatch")
      text = out.removed
        ? `Stopped ${out.removed} watch${out.removed === 1 ? "" : "es"}.`
        : "Nothing matched that watch.";
    else if (name === "setWebhook") text = "Webhook updated.";
  }
  return (
    <div className={`${base} text-kumo-default`}>
      <EyeIcon size={14} className="text-kumo-brand" /> {text}
    </div>
  );
}

// ── Chat ─────────────────────────────────────────────────────────────

function EmptyState({
  onPick,
  disabled
}: {
  onPick: (t: string) => void;
  disabled: boolean;
}) {
  const vantages = [
    {
      icon: BrowserIcon,
      title: "Your browser",
      body: "Can you reach it from your own network?"
    },
    {
      icon: CloudIcon,
      title: "Cloudflare edge ×5",
      body: "Is it up from five regions of the world?"
    },
    {
      icon: PulseIcon,
      title: "Radar + crowd",
      body: "Is your ISP or their network having an outage?"
    }
  ];
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center py-10 text-center sm:py-16">
      <h1 className="text-4xl leading-[1.05] font-semibold tracking-tight text-balance text-kumo-default sm:text-5xl">
        Is it down,
        <br />
        or is it <span className="brand-me">me</span>?
      </h1>
      <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-pretty text-kumo-subtle">
        Name a site. IsItMe checks it from three vantage points at once and
        tells you, in plain English, whose problem it is.
      </p>
      <div className="mt-8 grid w-full gap-3 text-left sm:grid-cols-3">
        {vantages.map(({ icon: I, title, body }, i) => (
          <div
            key={title}
            className="vantage rounded-xl border border-kumo-line bg-kumo-base p-4"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <I size={20} className="text-kumo-brand" />
            <div className="mt-2 text-sm font-medium text-kumo-default">
              {title}
            </div>
            <div className="mt-0.5 text-xs leading-relaxed text-kumo-subtle">
              {body}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((p) => (
          <button
            key={p}
            type="button"
            disabled={disabled}
            onClick={() => onPick(p)}
            className="rounded-full border border-kumo-line bg-kumo-base px-3.5 py-1.5 text-sm text-kumo-default transition-colors hover:border-kumo-brand hover:text-kumo-brand disabled:opacity-50"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

/** `/?q=host` (from check and report pages) starts a diagnosis once connected. */
function takeQuery(): string | null {
  const q = new URLSearchParams(location.search).get("q");
  if (!q) return null;
  history.replaceState(null, "", "/");
  // The link is attacker-chosen and gets sent as the user's own chat message: a bare host or nothing.
  if (/\s/.test(q)) return null;
  const t = normalizeTarget(q);
  return "error" in t ? null : `Is ${t.host} down?`;
}

function ChatApp() {
  const [deviceId] = useState(getDeviceId);
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const pendingQ = useRef(takeQuery());
  const [drawer, setDrawer] = useState(false);
  const [liveChecks, setLiveChecks] = useState<Record<string, ExtraCheck[]>>(
    {}
  );
  const [localProbes, setLocalProbes] = useState<Record<string, BrowserProbe>>(
    {}
  );
  const toasts = useKumoToastManager();
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const probed = useRef(new Set<string>());
  const drawerRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = drawerRef.current;
    if (drawer && !d?.open) d?.showModal();
    else if (!drawer && d?.open) d.close();
  }, [drawer]);

  const agent = useAgent<UserAgent, AgentState>({
    agent: "UserAgent",
    name: deviceId,
    onOpen: useCallback(() => setConnected(true), []),
    onClose: useCallback(() => setConnected(false), []),
    onMessage: useCallback(
      (e: MessageEvent) => {
        let msg: AgentBroadcast;
        try {
          msg = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (msg.type === "alert") {
          const a = msg.alert;
          toasts.add({
            title: `${a.host}: ${a.kind === "recovered" ? "back up" : VERDICTS[a.to].label}`,
            description: a.from
              ? `Was ${VERDICTS[a.from].label}. ${a.summary}`
              : a.summary,
            timeout: 0
          });
        } else if (msg.type === "extra-check") {
          const { reportId, host, check } = msg;
          setLiveChecks((prev) => ({
            ...prev,
            [reportId]: [...(prev[reportId] ?? []), check]
          }));
          toasts.add({
            title: `Someone checked ${host} from their side`,
            description: `${netLabel(check.user)}: ${check.browser?.reachable ? "reachable" : "not reachable"}`
          });
        }
      },
      [toasts]
    )
  });
  const state = agent.state;

  const {
    messages,
    sendMessage,
    clearHistory,
    stop,
    isStreaming,
    status,
    error
  } = useAgentChat({ agent });
  // isStreaming is false while "submitted" (waiting for the first token), which is when feedback matters most.
  const busy = isStreaming || status === "submitted";

  // The browser is the third vantage: probe as soon as the server asks for it.
  useEffect(() => {
    for (const run of state?.runs ?? []) {
      if (
        run.status !== "running" ||
        !run.wantsBrowser ||
        run.trigger !== "chat" ||
        probed.current.has(run.id)
      ) {
        continue;
      }
      probed.current.add(run.id);
      void runBrowserProbe(run.url)
        .then((p) => {
          setLocalProbes((prev) => ({ ...prev, [run.id]: p }));
          return agent.stub.submitBrowserProbe(run.id, p);
        })
        .catch(() => {});
    }
  }, [state?.runs, agent]);

  useEffect(() => {
    if (!messages.length) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const getReport = useCallback(
    (id: string) => agent.stub.getReport(id),
    [agent]
  );
  const unwatch = useCallback(
    (id: string) => void agent.stub.unwatch(id).catch(() => {}),
    [agent]
  );
  const mute = useCallback(
    (id: string, minutes: number | null) => {
      const fail = () =>
        toasts.add({
          title: "Couldn't change mute",
          description: "Try again."
        });
      agent.stub
        .muteWatch(id, minutes ?? 0)
        .then((r) => {
          if (!r.ok) fail();
        })
        .catch(fail);
    },
    [agent, toasts]
  );
  const getUptime = useCallback(
    (id: string) => agent.stub.getUptime(id, 7),
    [agent]
  );
  const markRead = useCallback(
    () => void agent.stub.markAlertsRead().catch(() => {}),
    [agent]
  );
  const exportData = useCallback(async () => {
    try {
      const bundle = await agent.stub.exportData();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(bundle, null, 2)], {
          type: "application/json"
        })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "isitme-export.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toasts.add({ title: "Export failed", description: "Try again." });
    }
  }, [agent, toasts]);

  const send = (text = input) => {
    const t = text.trim();
    if (!t || busy || !connected) return;
    setInput("");
    sendMessage({ role: "user", parts: [{ type: "text", text: t }] });
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  // Send once when the socket first opens.
  useEffect(() => {
    if (!connected || !pendingQ.current) return;
    const q = pendingQ.current;
    pendingQ.current = null;
    send(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const unread = state?.alerts.filter((a) => !a.read).length ?? 0;
  const last = messages[messages.length - 1];

  return (
    <div className="flex h-full flex-col bg-kumo-elevated">
      <header className="z-10 border-b border-kumo-line bg-kumo-base">
        <div className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
          <Brand />
          <span
            className={`ml-1 flex items-center gap-1.5 text-xs ${connected ? "text-kumo-subtle" : "text-kumo-danger"}`}
            title={connected ? "Connected" : "Reconnecting…"}
          >
            <span
              className={`size-1.5 rounded-full ${connected ? "bg-kumo-success" : "bg-kumo-danger"}`}
            />
            <span className={connected ? "hidden sm:inline" : ""}>
              {connected
                ? state?.user?.colo
                  ? `connected via ${state.user.colo}`
                  : "connected"
                : "reconnecting…"}
            </span>
          </span>
          <div className="ml-auto flex items-center gap-1">
            <a
              href="/trending"
              aria-label="Trending outages"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default"
            >
              <TrendUpIcon size={16} />
              <span className="hidden sm:inline">Trending</span>
            </a>
            {messages.length > 0 && (
              <Button
                variant="ghost"
                shape="square"
                icon={<TrashIcon size={16} />}
                onClick={clearHistory}
                aria-label="Clear chat"
                title="Clear chat"
              />
            )}
            <ThemeToggle />
            <div className="relative lg:hidden">
              <Button
                variant="ghost"
                shape="square"
                icon={<ListIcon size={16} />}
                onClick={() => setDrawer(true)}
                aria-label={
                  unread
                    ? `Open sidebar, ${unread} unread alert${unread === 1 ? "" : "s"}`
                    : "Open sidebar"
                }
              />
              {unread > 0 && (
                <span className="pointer-events-none absolute top-1 right-1 size-2 rounded-full bg-kumo-danger" />
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-5">
              {messages.length === 0 && (
                <EmptyState
                  onPick={(t) => send(t)}
                  disabled={!connected || busy}
                />
              )}

              {messages.map((m) => {
                const dupes = duplicateErrorIds(m.parts);
                return m.parts.map((part, i) => {
                  const key = `${m.id}-${i}`;
                  if (isToolUIPart(part)) {
                    if (dupes.has(part.toolCallId)) return null;
                    const name = getToolName(part);
                    if (name === "diagnose") {
                      const run = state?.runs.find(
                        (r) => r.toolCallId === part.toolCallId
                      );
                      const outcome =
                        part.state === "output-available"
                          ? (part.output as CheckOutcome)
                          : part.state === "output-error"
                            ? ({
                                ok: false,
                                error: part.errorText
                              } as CheckOutcome)
                            : undefined;
                      const runId = run?.id ?? outcome?.runId;
                      return (
                        <DiagnosisCard
                          key={key}
                          run={run}
                          outcome={outcome}
                          getReport={getReport}
                          liveChecks={runId ? liveChecks[runId] : undefined}
                          localProbe={runId ? localProbes[runId] : undefined}
                        />
                      );
                    }
                    return <ToolChip key={key} name={name} part={part} />;
                  }
                  if (part.type !== "text" || !part.text.trim()) return null;
                  if (m.role === "user") {
                    return (
                      <div key={key} className="flex justify-end">
                        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-kumo-contrast px-4 py-2.5 leading-relaxed whitespace-pre-wrap text-kumo-inverse">
                          {part.text}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={key}
                      className="max-w-[92%] text-[15px] leading-relaxed text-kumo-default"
                    >
                      <Markdown animating={isStreaming && m === last}>
                        {part.text}
                      </Markdown>
                    </div>
                  );
                });
              })}

              {busy && last?.role === "user" && (
                <div className="flex items-center gap-2 text-sm text-kumo-subtle">
                  <CircleNotchIcon size={14} className="animate-spin" />{" "}
                  Thinking…
                </div>
              )}
              {error && (
                <div className="flex items-start gap-2 rounded-xl bg-kumo-danger-tint px-3 py-2 text-sm text-kumo-danger">
                  <WarningIcon size={16} className="mt-0.5 shrink-0" />
                  {error.message || "Something went wrong. Try again."}
                </div>
              )}
              <div ref={endRef} />
            </div>
          </div>

          <div className="border-t border-kumo-line bg-kumo-base">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="mx-auto max-w-3xl px-4 pt-3 pb-2 sm:px-5"
            >
              <div className="flex items-end gap-2 rounded-xl border border-kumo-line bg-kumo-base p-2.5 shadow-sm transition-shadow focus-within:border-transparent focus-within:ring-2 focus-within:ring-kumo-ring">
                <InputArea
                  ref={textareaRef}
                  value={input}
                  onValueChange={setInput}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${el.scrollHeight}px`;
                  }}
                  placeholder={
                    connected ? "Is github.com down?" : "Reconnecting…"
                  }
                  aria-label="Message"
                  disabled={!connected}
                  rows={1}
                  className="max-h-40 flex-1 resize-none bg-transparent! shadow-none! ring-0! outline-none! focus:ring-0!"
                />
                {busy ? (
                  <Button
                    type="button"
                    variant="secondary"
                    shape="square"
                    aria-label="Stop"
                    icon={<StopIcon size={18} />}
                    onClick={stop}
                  />
                ) : (
                  <Button
                    type="submit"
                    variant="primary"
                    shape="square"
                    aria-label="Send"
                    disabled={!input.trim() || !connected}
                    icon={<PaperPlaneRightIcon size={18} />}
                  />
                )}
              </div>
            </form>
            <div className="flex justify-center pb-2.5">
              <PoweredByCloudflare href="https://developers.cloudflare.com/agents/" />
            </div>
          </div>
        </main>

        <div className="hidden w-80 shrink-0 overflow-y-auto border-l border-kumo-line bg-kumo-base lg:block">
          <Sidebar
            state={state}
            onUnwatch={unwatch}
            onMarkAlertsRead={markRead}
            onExport={exportData}
            onMute={mute}
            getUptime={getUptime}
          />
        </div>
      </div>

      <dialog
        ref={drawerRef}
        aria-label="Sidebar"
        onClose={() => setDrawer(false)}
        className="drawer m-0 ml-auto h-full max-h-none w-[min(20rem,88vw)] overflow-y-auto bg-kumo-base p-0 shadow-xl backdrop:bg-black/40 lg:hidden"
      >
        <div className="flex justify-end px-3 pt-3">
          <Button
            variant="ghost"
            shape="square"
            icon={<XIcon size={16} />}
            onClick={() => setDrawer(false)}
            aria-label="Close sidebar"
          />
        </div>
        <Sidebar
          state={state}
          onUnwatch={unwatch}
          onMarkAlertsRead={markRead}
          onExport={exportData}
          onMute={mute}
          getUptime={getUptime}
        />
      </dialog>
    </div>
  );
}

/** The chat at "/". Lazily loaded: the agent, chat and toast stacks are most of the bundle. */
export default function ChatAppPage() {
  return (
    <Toasty>
      <ChatApp />
    </Toasty>
  );
}
