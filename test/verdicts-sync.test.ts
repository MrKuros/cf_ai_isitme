import { describe, expect, it } from "vitest";
import { VERDICTS as APP } from "../src/client/components/ui";
import { VERDICTS as DOCS } from "../docs-site/.vitepress/theme/verdicts";

// The docs site can't import ui.tsx (React, icons, Tailwind), so verdicts.ts is
// a hand-kept copy. This is the thing that notices when it drifts.
describe("docs-site verdicts mirror the app's", () => {
  it("has the same verdicts with the same labels, headlines and tones", () => {
    expect(DOCS).toEqual(APP);
  });
});
