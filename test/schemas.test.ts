import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CheckInput, MCP_TOOLS, RunInput } from "../src/shared/schemas";

describe("shared schemas (R16 b)", () => {
  it("CheckInput JSON schema is stable (REST and MCP share it)", () => {
    expect(z.toJSONSchema(CheckInput)).toMatchInlineSnapshot(`
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "additionalProperties": false,
        "properties": {
          "expect": {
            "description": "Text the page must contain",
            "maxLength": 200,
            "minLength": 1,
            "type": "string",
          },
          "url": {
            "description": "Domain or URL, e.g. example.com",
            "maxLength": 2048,
            "minLength": 1,
            "type": "string",
          },
        },
        "required": [
          "url",
        ],
        "type": "object",
      }
    `);
  });

  it("MCP tool list and input keys match the shared schemas", () => {
    expect(
      Object.fromEntries(
        Object.entries(MCP_TOOLS).map(([name, s]) => [
          name,
          Object.keys(s.shape)
        ])
      )
    ).toEqual({
      check_site: ["url", "expect"],
      start_check: ["url", "expect"],
      get_check: ["runId"],
      get_report: ["host", "id"]
    });
    expect(MCP_TOOLS.check_site).toBe(CheckInput);
    expect(MCP_TOOLS.start_check).toBe(CheckInput);
  });

  it("validates REST query params", () => {
    expect(CheckInput.safeParse({ url: "example.com" }).success).toBe(true);
    expect(CheckInput.safeParse({ url: "" }).success).toBe(false);
    expect(CheckInput.safeParse({ url: "a".repeat(2049) }).success).toBe(false);
    expect(
      CheckInput.safeParse({ url: "x.com", expect: "e".repeat(201) }).success
    ).toBe(false);
    expect(RunInput.safeParse({ runId: "nope" }).success).toBe(false);
    expect(RunInput.safeParse({ runId: crypto.randomUUID() }).success).toBe(
      true
    );
  });
});
