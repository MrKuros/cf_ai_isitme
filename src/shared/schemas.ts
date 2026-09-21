// Shared input schemas: REST query params, MCP tool inputs and chat tools all parse with these (R16).
import { z } from "zod";

/** Lowercase hostname or IP literal, as used for TargetDO names and report paths. */
export const HOST = /^[a-z0-9.:[\]-]{1,253}$/;

export const CheckInput = z.object({
  url: z.string().min(1).max(2048).describe("Domain or URL, e.g. example.com"),
  expect: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Text the page must contain")
});

export const ReportInput = z.object({
  host: z.string().describe("Report host, e.g. example.com"),
  id: z.string().describe("Report id")
});

export const RunInput = z.object({
  runId: z.string().uuid().describe("runId returned by start_check")
});

/** MCP tool name -> input schema. mcp.ts registers exactly these. */
export const MCP_TOOLS = {
  check_site: CheckInput,
  start_check: CheckInput,
  get_check: RunInput,
  get_report: ReportInput
} as const;
