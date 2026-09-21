import { getAgentByName } from "agents";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { hashIp } from "../lib/net";
import { HOST, MCP_TOOLS } from "../shared/schemas";
import { REPORT_TTL_DAYS } from "../shared/types";

const reply = (result: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  isError
});

/** Served at /mcp. Tools and their input schemas: MCP_TOOLS in src/shared/schemas.ts. */
export class IsItMeMcp extends McpAgent<Env> {
  server = new McpServer({ name: "isitme", version: "1.1.0" });

  /** One UserAgent per MCP session, so start_check and get_check meet. */
  private async agent() {
    return getAgentByName(
      this.env.UserAgent,
      `mcp-${await hashIp(this.ctx.id.toString())}`
    );
  }

  async init() {
    this.server.registerTool(
      "check_site",
      {
        description:
          "Check whether a website is down for everyone, down in some regions, or only failing for the caller. Probes DNS, Cloudflare's edge, 5 regions, and Radar outage data, then returns a verdict summary with signals and a report path. Waits up to 2 minutes; use start_check + get_check to avoid waiting.",
        inputSchema: MCP_TOOLS.check_site.shape
      },
      async ({ url, expect }) => {
        const outcome = await (
          await this.agent()
        ).checkNow(url, {}, "mcp", {
          expect
        });
        return reply(outcome, !outcome.ok);
      }
    );

    this.server.registerTool(
      "start_check",
      {
        description:
          "Start the same check as check_site without waiting. Returns { runId, host }; poll get_check with the runId.",
        inputSchema: MCP_TOOLS.start_check.shape
      },
      async ({ url, expect }) => {
        const res = await (
          await this.agent()
        ).startCheck(url, {}, "mcp", {
          expect
        });
        return reply(res, !res.ok);
      }
    );

    this.server.registerTool(
      "get_check",
      {
        description:
          'Poll a run started by start_check in this session. Returns { status: "running" } or the finished verdict summary.',
        inputSchema: MCP_TOOLS.get_check.shape
      },
      async ({ runId }) => {
        const run = await (await this.agent()).getRun(runId);
        return run
          ? reply(run, "ok" in run && !run.ok)
          : reply({ error: "unknown runId for this session" }, true);
      }
    );

    this.server.registerTool(
      "get_report",
      {
        description:
          "Fetch a full report (all evidence: DNS, edge, regions, Radar, browser and visitor checks) by host and id, e.g. from a check's reportPath /r/<host>/<id>.",
        inputSchema: MCP_TOOLS.get_report.shape
      },
      async ({ host, id }) => {
        const h = host.trim().toLowerCase();
        if (!HOST.test(h)) return reply({ error: "bad host" }, true);
        const status =
          await this.env.TARGET_DO.getByName(h).getReportStatus(id);
        if (!status) return reply({ error: "not found" }, true);
        if ("expired" in status)
          return reply(
            { error: "expired", retentionDays: REPORT_TTL_DAYS },
            true
          );
        return reply(status.report);
      }
    );
  }
}
