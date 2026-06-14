import { describe, expect, test } from "bun:test";
import { MemoryAuditStore, createAuditRecorder } from "@veritio/core";
import { createSvelteKitVeritioAdapter } from "../index";

describe("createSvelteKitVeritioAdapter", () => {
  test("records an explicit action event through injected locals context", async () => {
    const store = new MemoryAuditStore();
    const adapter = createSvelteKitVeritioAdapter({
      recorder: createAuditRecorder({ store }),
      environment: "test",
      resolveContext(input) {
        const locals = input.locals as { tenantId: string; actorId: string };
        return {
          tenantId: locals.tenantId,
          actor: { type: "user", id: locals.actorId },
          requestId: "req_sveltekit_action",
        };
      },
    });

    await adapter.recordAction({
      locals: { tenantId: "org_123", actorId: "usr_123" },
      action: "account.preferences.updated",
      target: { type: "account", id: "acct_123" },
      dataCategories: ["preferences"],
    });

    const [record] = store.records();
    expect(record?.event.action).toBe("account.preferences.updated");
    expect(record?.event.actor).toEqual({ type: "user", id: "usr_123" });
    expect(record?.event.target).toEqual({ type: "account", id: "acct_123" });
    expect(record?.event.scope).toEqual({ tenantId: "org_123", environment: "test" });
    expect(record?.event.requestId).toBe("req_sveltekit_action");
    expect(record?.event.dataCategories).toEqual(["preferences"]);
  });

  test("fails closed when actor context is missing", async () => {
    const store = new MemoryAuditStore();
    const adapter = createSvelteKitVeritioAdapter({
      recorder: createAuditRecorder({ store }),
    });

    await expect(
      adapter.recordEndpoint({
        context: {
          tenantId: "org_123",
          actor: { type: "user", id: "" },
        },
        action: "account.export.requested",
        target: { type: "account", id: "acct_123" },
      }),
    ).rejects.toThrow("actor.id is required");
    expect(store.records()).toHaveLength(0);
  });
});
