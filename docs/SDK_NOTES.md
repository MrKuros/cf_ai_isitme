# SDK notes (verified against installed node_modules, 2026-09-21)

Installed: `agents@0.24.0`, `@cloudflare/ai-chat@0.12.0`, `ai@6.0.286`, `@ai-sdk/react@3.0.289`,
`workers-ai-provider@3.3.1`, `@modelcontextprotocol/sdk@1.30.0`, `zod@4.6.5`, `wrangler@4.135.0`,
`vite@8`, `vitest@4.1.11`, `typescript@6`. Do **not** bump `workers-ai-provider` to v4 (needs ai@7).
Local docs worth reading: `node_modules/agents/docs/*.md` (workflows.md, scheduling.md, state.md,
callable-methods.md, chat-agents.md, mcp-servers.md, client-sdk.md).

## Agent base (`import { Agent, callable, getAgentByName, routeAgentRequest, type Connection, type ConnectionContext, type Schedule } from "agents"`)

```ts
class Agent<Env = Cloudflare.Env, TState = unknown, Props = Record<string, unknown>> extends DurableObject<Env>
initialState: TState;
get state(): TState;
setState(state: TState): void;                           // persists + broadcasts to clients (sync)
onStateChanged(state: TState | undefined, source: Connection | "server"): void;   // onStateUpdate is deprecated
validateStateChange(next: TState, source: Connection | "server"): void;           // sync, throw to reject
sql<T = Record<string, string | number | boolean | null>>(strings: TemplateStringsArray, ...values: (string | number | boolean | null)[]): T[];
onStart(props?): void | Promise<void>;
onConnect(connection: Connection, ctx: ConnectionContext): void | Promise<void>;   // ctx.request.cf
onMessage(connection: Connection, message: WSMessage): void | Promise<void>;
onRequest(request: Request): Response | Promise<Response>;
broadcast(msg: string | ArrayBuffer | ArrayBufferView, without?: string[]): void;
get sessionAffinity(): string;        // pass to workersai(MODEL, { sessionAffinity: this.sessionAffinity })
this.name                              // instance name (device id)
```

`request.cf` is typed `CfProperties<unknown>`; cast to `IncomingRequestCfProperties` (see `src/lib/net.ts`).

### Scheduling

```ts
schedule<T = string>(when: Date | string /*cron*/ | number /*delay s*/, callback: keyof this, payload?: T,
  options?: { retry?: RetryOptions; idempotent?: boolean }): Promise<Schedule<T>>;   // cron idempotent by default
scheduleEvery<T = string>(intervalSeconds: number, callback: keyof this, payload?: T,
  options?: { retry?: RetryOptions }): Promise<Schedule<T>>;                           // idempotent on (callback, interval, payload)
listSchedules(criteria?: ScheduleCriteria): Promise<Schedule<unknown>[]>;             // getSchedules() is deprecated (sync)
getScheduleById(id: string): Promise<Schedule<unknown> | undefined>;
cancelSchedule(id: string): Promise<boolean>;
// Callback signature: async checkWatch(payload: T, schedule: Schedule<T>)
// Schedule<T> = { id, callback, payload, retry? } & ({type:"scheduled",time} | {type:"delayed",time,delayInSeconds} | {type:"cron",time,cron} | {type:"interval",time,intervalSeconds})
```

### Callable

```ts
@callable(metadata?: { description?: string; streaming?: boolean })   // TC39 decorator (babel via agents/vite)
// client: await agent.stub.method(...args)  or  agent.call("method", [args])
```

### Routing / stubs

```ts
routeAgentRequest<Env>(request, env, options?): Promise<Response | null>;   // /agents/:kebab-binding/:name
getAgentByName<Env, T extends Agent<Env>>(namespace: DurableObjectNamespace<T>, name: string,
  options?: { locationHint?, jurisdiction?, props?, routingRetry? }): Promise<DurableObjectStub<T>>;
```

Binding `UserAgent` is reached by clients as agent `"UserAgent"` (client kebab-cases it to `user-agent`).
Plain DOs: `env.TARGET_DO.getByName(name)`; `env.PROBE_DO.getByName(name, { locationHint: "apac" })`
(`DurableObjectNamespaceGetDurableObjectOptions = { locationHint?, routingMode? }`). Local dev ignores hints.

## AIChatAgent (`import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat"`)

```ts
class AIChatAgent<Env, State = unknown, Props = ...> extends Agent<Env, State, Props>
messages: UIMessage[];
maxPersistedMessages: number | undefined;
onChatMessage(onFinish: GenerateTextOnFinishCallback<ToolSet>, options?: OnChatMessageOptions): Promise<Response | undefined>;
type OnChatMessageOptions = { requestId: string; abortSignal?: AbortSignal; clientTools?: ClientToolSchema[]; body?: Record<string, unknown> };
saveMessages(messages: UIMessage[] | ((cur) => UIMessage[] | Promise<UIMessage[]>), options?): Promise<{ requestId, status, error? }>;
onChatResponse(result): void | Promise<void>;   // after a turn is persisted
```

AIChatAgent does not override `onConnect`; overriding it in a subclass is fine (verify chat still streams in dev).

Pattern (ai@6):

```ts
const workersai = createWorkersAI({ binding: this.env.AI });
const result = streamText({
  model: workersai(MODEL, { sessionAffinity: this.sessionAffinity }),
  system,
  messages: pruneMessages({ messages: await convertToModelMessages(this.messages), toolCalls: "before-last-2-messages" }),
  tools: { diagnose: tool({ description, inputSchema: z.object({ url: z.string() }),
    execute: async ({ url }, { toolCallId, abortSignal }) => ... }) },
  stopWhen: stepCountIs(5),
  abortSignal: options?.abortSignal
});
return result.toUIMessageStreamResponse();
```

`execute(input, { toolCallId, messages, abortSignal, experimental_context })` — toolCallId is how a run is tied to a tool part.

## React client

```ts
import { useAgent } from "agents/react";
const agent = useAgent<UserAgent, AgentState>({ agent: "UserAgent", name: deviceId,
  onStateUpdate: (state, source) => ..., onMessage: (e: MessageEvent) => ..., onOpen, onClose });
// returns PartySocket & { state: State | undefined, setState, call, stub, ready, identified, connectionError, getHttpUrl }
import { useAgentChat } from "@cloudflare/ai-chat/react";
const { messages, sendMessage, clearHistory, status, stop, addToolOutput } = useAgentChat({ agent });
import { isToolUIPart, getToolName } from "ai";
// part.state: "input-streaming" | "input-available" | "output-available" | "output-error"; part.toolCallId; part.output
```

## Workflows (`import { AgentWorkflow, type AgentWorkflowEvent, type AgentWorkflowStep } from "agents/workflows"`)

```ts
class AgentWorkflow<AgentType extends Agent = Agent, Params = unknown, ProgressType = DefaultProgress, Env = Cloudflare.Env>
  extends WorkflowEntrypoint<Env, AgentWorkflowParams<Params>>
get agent(): DurableObjectStub<AgentType>;           // RPC back to the originating agent
get workflowId(): string;
protected reportProgress(progress: ProgressType): Promise<void>;   // -> agent.onWorkflowProgress (non-durable)
protected broadcastToClients(message: unknown): void;
async run(event: AgentWorkflowEvent<Params>, step: AgentWorkflowStep)   // event.payload: Params

interface AgentWorkflowStep extends WorkflowStep {
  reportComplete<T>(result?: T): Promise<void>;     // -> onWorkflowComplete (durable)
  reportError(error: Error | string): Promise<void>; // -> onWorkflowError (durable); unhandled throws are auto-reported
  sendEvent<T>(event: T): Promise<void>;            // -> onWorkflowEvent
  updateAgentState(state): Promise<void>; mergeAgentState(partial): Promise<void>; resetAgentState(): Promise<void>;
}
// WorkflowStep (workerd types):
step.do<T extends Rpc.Serializable<T>>(name, config?: { retries?: { limit, delay: "2 seconds" | number, backoff?: "constant"|"linear"|"exponential" }, timeout?: "30 seconds" | number }, cb: () => Promise<T>): Promise<T>;
step.sleep(name, "5 seconds"); step.sleepUntil(name, date);
step.waitForEvent<T>(name, { type: string; timeout?: "15 seconds" | number }): Promise<{ payload: Readonly<T>; timestamp: Date; type: string }>;  // throws on timeout
```

Agent side:

```ts
runWorkflow<P>(workflowName: "DIAGNOSE_WORKFLOW", params: P, options?: { id?: string; metadata?: Record<string, unknown>; agentBinding?: string; retention? }): Promise<string>;  // returns instance id
sendWorkflowEvent(workflowName, workflowId, event: { type: string; payload: unknown }): Promise<void>;
terminateWorkflow(workflowId): Promise<void>;
getWorkflow(workflowId): WorkflowInfo | undefined; getWorkflows(criteria?): WorkflowPage;
onWorkflowProgress(workflowName: string, workflowId: string, progress: unknown): Promise<void>;
onWorkflowComplete(workflowName: string, workflowId: string, result?: unknown): Promise<void>;
onWorkflowError(workflowName: string, workflowId: string, error: string): Promise<void>;
onWorkflowEvent(workflowName: string, workflowId: string, event: unknown): Promise<void>;
```

Constraints: the agent must be addressed by name (it is); callbacks route by `constructor.name`. Verified: the
vite build emits `var UserAgent = class extends AIChatAgent` (not minified), so `.name` survives.

## MCP (`import { McpAgent } from "agents/mcp"`)

```ts
abstract class McpAgent<Env, State = unknown, Props = ...> extends Agent<Env, State, Props>
abstract server: McpServer | Server | Promise<...>;     // McpServer from "@modelcontextprotocol/sdk/server/mcp.js" (1.30.0)
abstract init(): Promise<void>;
static serve(path: string, { binding?: string /* default "MCP_OBJECT" */, corsOptions?, transport?, jurisdiction? }?): { fetch(request, env, ctx): Promise<Response> };  // streamable HTTP
static serveSSE(path, opts?); static mount(path, opts?);
```

`createMcpHandler(server)` (stateless, no DO) also exists in `agents/mcp`, but we use McpAgent per plan.
In `init()`: `this.server.registerTool("check_site", { description, inputSchema: { url: z.string() } }, async ({ url }) => ({ content: [{ type: "text", text }] }))` (verified: `registerTool`; `tool()` is deprecated; zod ^3.25 || ^4 accepted).

## Workers subrequest status codes (R3)

Checked 2026-09-21 with `npm run dev:local` (local workerd via the vite plugin), `GET /api/v1/check?url=...`, then the saved report's `evidence.edge`:

| Target                   | Local workerd result                                                                                                                                                                                           | Probe mapping                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `expired.badssl.com`     | `fetch` **throws** `internal error; reference = <id>` (no status). The real reason is only on stderr: `kj/compat/tls.c++:269: failed: TLS peer's certificate is not trusted; reason = certificate has expired` | `errorClass: "unknown"` (the JS error has no TLS text), no retry |
| `wrong.host.badssl.com`  | Same opaque throw; stderr says `reason = Hostname mismatch`                                                                                                                                                    | `errorClass: "unknown"`                                          |
| `httpbin.org/status/403` | Real `403` from `server: gunicorn/19.9.0`, no challenge markers                                                                                                                                                | `ok: true`, no `blocked`                                         |
| `httpbin.org/delay/9`    | First attempt aborts at 8 s (`TimeoutError`), the 15 s retry answers 200 in ~12 s                                                                                                                              | `ok: true`, `retried: true` (verdict SLOW)                       |

- Locally, a bad certificate never shows up as 525/526 and never as TLS text, so TLS*ERROR can't be produced in local dev: it lands as an unknown failure (INCONCLUSIVE/DOWN*\*).
- The 525/526 → `tls`, 530 → `dns`, 520-524 + `cf-ray` → `cdnOrigin` mapping follows Cloudflare's documented edge codes and is unit-tested with mocked responses only. **Production behaviour is unverified until deploy**: re-run the four URLs above against the deployed Worker and record whether the edge synthesizes 526 or throws. If it throws the same opaque `internal error`, TLS detection needs another signal (e.g. an `http://` control fetch of the same host).

## Config / tooling

- `wrangler types env.d.ts` works offline; it types DO namespaces from `src/server.ts` exports. Re-run after changing wrangler.jsonc.
- `RADAR_TOKEN` is optional, declared in `src/env-secrets.d.ts` (wrangler types can't see it without .dev.vars).
- Rate limiter: `env.RATE_LIMITER.limit({ key }) -> { success }`. Config `simple.period` must be 10 or 60.
- Analytics: `env.ANALYTICS.writeDataPoint({ blobs, doubles, indexes })`.
- Tests: `npm test` (plain vitest, `vitest.config.ts`, does not load the Cloudflare vite plugin). Only pure modules are unit-tested.
- `vite build` output goes to `dist/` (gitignored).
