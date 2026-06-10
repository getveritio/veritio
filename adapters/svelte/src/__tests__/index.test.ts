import { describe, expect, test } from "bun:test";
import { createSvelteVeritioAttributes } from "../index";

describe("createSvelteVeritioAttributes", () => {
  test("creates inert attributes for server-side evidence capture", () => {
    const attributes = createSvelteVeritioAttributes({
      action: "ui.dsars.requested",
      target: { type: "form", id: "dsar-request" },
    });

    expect(attributes).toEqual({
      "data-veritio-action": "ui.dsars.requested",
      "data-veritio-target-type": "form",
      "data-veritio-target-id": "dsar-request",
    });
    expect(Object.isFrozen(attributes)).toBe(true);
  });

  test("rejects server-only token inputs", () => {
    expect(() =>
      createSvelteVeritioAttributes({
        action: "ui.dsars.requested",
        target: { type: "form", id: "dsar-request" },
        apiToken: "secret",
      } as never),
    ).toThrow("client evidence attributes must not include apiToken");
  });
});
