import { describe, expect, test } from "bun:test";
import { createVueVeritioAttrs } from "../index";

describe("createVueVeritioAttrs", () => {
  test("creates inert attrs for server-side evidence capture", () => {
    const attrs = createVueVeritioAttrs({
      action: "ui.consent.opened",
      target: { type: "dialog", id: "consent" },
    });

    expect(attrs).toEqual({
      "data-veritio-action": "ui.consent.opened",
      "data-veritio-target-type": "dialog",
      "data-veritio-target-id": "consent",
    });
    expect(Object.isFrozen(attrs)).toBe(true);
  });

  test("rejects server-only scope or credential inputs", () => {
    expect(() =>
      createVueVeritioAttrs({
        action: "ui.consent.opened",
        target: { type: "dialog", id: "consent" },
        tenantId: "org_123",
      } as never),
    ).toThrow("client evidence attributes must not include tenantId");
  });
});
