import { getAgentByName, routeAgentRequest } from "agents";
import { UserAgent } from "./agents/user-agent";
import { browserVantage, parseBrowserProbe } from "./lib/browser-probe";
import { TargetDO } from "./agents/target-do";
import { ProbeDO } from "./agents/probe-do";
import { ProviderDO } from "./agents/provider-do";
import { TrendsDO } from "./agents/trends-do";
import { IsItMeMcp } from "./agents/mcp";
import { DiagnoseWorkflow } from "./workflow/diagnose";
import { clientIp, hashIp, netInfo, publicNetInfo } from "./lib/net";
import { badgeSvg } from "./lib/badge";
import { pickLang } from "./lib/lang";
import { supportBundle } from "./lib/bundle";
import { CheckInput, HOST, RunInput } from "./shared/schemas";
import { REPORT_TTL_DAYS, type ExtraCheck } from "./shared/types";

export {
  UserAgent,
  TargetDO,
  ProbeDO,
  ProviderDO,
  TrendsDO,
  IsItMeMcp,
  DiagnoseWorkflow
};

const mcp = IsItMeMcp.serve("/mcp", { binding: "MCP_OBJECT" });

const DEVICE_ID = /^[A-Za-z0-9_-]{16,64}$/;

const json = (body: unknown, status = 200) => Response.json(body, { status });

const withCors = (res: Response) => {
  res.headers.set("access-control-allow-origin", "*");
  return res;
};

/** Decoded, lowercased host path segment, or null when it isn't a hostname. */
function hostParam(raw: string): string | null {
  try {
    const h = decodeURIComponent(raw).toLowerCase();
    return HOST.test(h) ? h : null;
  } catch {
    return null;
  }
}

async function limited(env: Env, key: string) {
  const { success } = await env.RATE_LIMITER.limit({ key });
  return !success;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const { pathname } = url;
    const ip = clientIp(request);

    if (pathname.startsWith("/agents/")) {
      // Only per-device UserAgents are reachable from browsers; api-/mcp- names are server-side agents.
      const [, , agent, name = ""] = pathname.split("/");
      if (
        agent !== "user-agent" ||
        !DEVICE_ID.test(name) ||
        /^(api|mcp)-/i.test(name)
      ) {
        return new Response("Not found", { status: 404 });
      }
      // Device ids are free to mint, so new sockets are limited per IP.
      if (
        request.headers.get("upgrade")?.toLowerCase() === "websocket" &&
        (await limited(env, `ws:${ip}`))
      ) {
        return new Response("Too many connections", { status: 429 });
      }
      return (
        (await routeAgentRequest(request, env)) ||
        new Response("Not found", { status: 404 })
      );
    }

    if (pathname === "/mcp" || pathname.startsWith("/mcp/")) {
      if (await limited(env, `mcp:${ip}`))
        return json({ error: "rate limited" }, 429);
      return mcp.fetch(request, env, ctx);
    }

    if (pathname === "/api/v1/check" && request.method === "GET") {
      if (await limited(env, `api:${ip}`))
        return withCors(json({ ok: false, error: "rate limited" }, 429));
      const q = url.searchParams;
      const input = CheckInput.safeParse({
        url: q.get("url") ?? undefined,
        expect: q.get("expect") || undefined
      });
      if (!input.success) {
        const error = q.get("url")
          ? input.error.issues[0].message
          : "missing ?url=";
        return withCors(json({ ok: false, error }, 400));
      }
      const { url: target, expect } = input.data;
      // The explanation follows the caller's Accept-Language; the verdict stays English.
      const lang = pickLang(
        request.headers.get("accept-language") ?? undefined
      );
      const agent = await getAgentByName(
        env.UserAgent,
        `api-${await hashIp(ip)}`
      );
      if (q.get("wait") === "0") {
        const res = await agent.startCheck(target, netInfo(request), "api", {
          expect,
          lang
        });
        if (!res.ok) return withCors(json(res, 400));
        return withCors(
          json(
            {
              ok: true,
              runId: res.runId,
              host: res.host,
              pollPath: `/api/v1/runs/${res.runId}`
            },
            202
          )
        );
      }
      const outcome = await agent.checkNow(target, netInfo(request), "api", {
        expect,
        lang
      });
      return withCors(json(outcome, outcome.ok ? 200 : 400));
    }

    const run = pathname.match(/^\/api\/v1\/runs\/([^/]+)$/);
    if (run && request.method === "GET") {
      if (await limited(env, `api:${ip}`))
        return withCors(json({ ok: false, error: "rate limited" }, 429));
      const input = RunInput.safeParse({ runId: run[1] });
      if (!input.success)
        return withCors(json({ ok: false, error: "bad run id" }, 400));
      // Same per-IP agent that started it: a run is only visible to its caller.
      const agent = await getAgentByName(
        env.UserAgent,
        `api-${await hashIp(ip)}`
      );
      const poll = await agent.getRun(input.data.runId);
      return withCors(
        poll ? json(poll) : json({ ok: false, error: "not found" }, 404)
      );
    }

    const hostApi = pathname.match(/^\/api\/host\/([^/]+)$/);
    if (hostApi && request.method === "GET") {
      if (await limited(env, `report:${ip}`))
        return json({ error: "rate limited" }, 429);
      const host = hostParam(hostApi[1]);
      if (!host) return json({ error: "bad host" }, 400);
      const res = json(await env.TARGET_DO.getByName(host).hostHistory());
      res.headers.set("cache-control", "public, max-age=60");
      return withCors(res);
    }

    if (pathname === "/api/trends" && request.method === "GET") {
      if (await limited(env, `report:${ip}`))
        return json({ error: "rate limited" }, 429);
      // One global singleton: serve it from the colo cache so the DO sees ~1 read/min/colo.
      const key = new Request(`${url.origin}/api/trends`);
      const cache = await caches.open("trends");
      const hit = await cache.match(key);
      if (hit) return withCors(new Response(hit.body, hit));
      const res = json(await env.TRENDS_DO.getByName("global").list());
      res.headers.set("cache-control", "public, max-age=60");
      ctx.waitUntil(cache.put(key, res.clone()));
      return withCors(res);
    }

    const badge = pathname.match(/^\/badge\/([^/]+)\.svg$/);
    if (badge && request.method === "GET") {
      if (await limited(env, `badge:${ip}`))
        return new Response("rate limited", { status: 429 });
      const host = hostParam(badge[1]);
      if (!host) return new Response("bad host", { status: 400 });
      // Cache-only: reads the latest stored verdict, never probes (R19).
      const { latest } = await env.TARGET_DO.getByName(host).hostHistory();
      return withCors(
        new Response(badgeSvg(latest, Date.now()), {
          headers: {
            "content-type": "image/svg+xml; charset=utf-8",
            "cache-control": "public, max-age=60"
          }
        })
      );
    }

    const report = pathname.match(/^\/api\/report\/([^/]+)\/([^/]+?)(\.txt)?$/);
    if (report && request.method === "GET") {
      const txt = Boolean(report[3]);
      const text = (body: string, status = 200) =>
        new Response(body, {
          status,
          headers: { "content-type": "text/plain; charset=utf-8" }
        });
      if (await limited(env, `report:${ip}`))
        return txt
          ? text("rate limited", 429)
          : json({ error: "rate limited" }, 429);
      const host = hostParam(report[1]);
      if (!host)
        return txt ? text("bad host", 400) : json({ error: "bad host" }, 400);
      const status = await env.TARGET_DO.getByName(host).getReportStatus(
        report[2]
      );
      if (!status)
        return txt ? text("not found", 404) : json({ error: "not found" }, 404);
      if ("expired" in status)
        return txt
          ? text(
              `This report expired (reports are kept ${REPORT_TTL_DAYS} days).`,
              410
            )
          : json({ error: "expired", retentionDays: REPORT_TTL_DAYS }, 410);
      return txt
        ? text(supportBundle(status.report, url.origin))
        : json(status.report);
    }

    if (pathname === "/api/extra-check" && request.method === "POST") {
      if (await limited(env, `extra:${ip}`))
        return json({ error: "rate limited" }, 429);
      const raw = await request.text();
      if (raw.length > 16_384) return json({ error: "too large" }, 413);
      let body: { host?: unknown; reportId?: unknown; browser?: unknown };
      try {
        body = JSON.parse(raw);
      } catch {
        return json({ error: "bad json" }, 400);
      }
      const { host, reportId, browser } = body;
      if (
        typeof host !== "string" ||
        !HOST.test(host) ||
        typeof reportId !== "string"
      ) {
        return json({ error: "bad request" }, 400);
      }
      const parsed = parseBrowserProbe(browser);
      if (!parsed.ok) return json({ error: parsed.error }, 400);
      const check: ExtraCheck = {
        id: crypto.randomUUID(),
        at: Date.now(),
        user: publicNetInfo(netInfo(request)),
        browser: browserVantage(parsed.probe)
      };
      const res = await env.TARGET_DO.getByName(host).appendExtraCheck(
        reportId,
        check,
        await hashIp(ip)
      );
      if (!res) return json({ error: "report not found" }, 404);
      if (res === "full")
        return json({ error: "report has enough checks" }, 409);
      ctx.waitUntil(
        getAgentByName(env.UserAgent, res.ownerId).then((owner) =>
          owner.onExtraCheck(host, reportId, check)
        )
      );
      return json({ ok: true, check });
    }

    if (pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    return new Response("Not found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
