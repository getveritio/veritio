import { describe, expect, test } from "bun:test";
import { MemoryAuditStore, createAuditRecorder } from "@veritio/core";
import { createTanStackStartVeritioAdapter } from "../index";

describe("createTanStackStartVeritioAdapter", () => {
  test("records an explicit server function event from injected request context", async () => {
    const store = new MemoryAuditStore();
    const adapter = createTanStackStartVeritioAdapter({
      recorder: createAuditRecorder({ store }),
      environment: "test",
      resolveContext(input) {
        return {
          tenantId: input.params?.orgId ?? "",
          actor: { type: "service", id: "tanstack-start" },
          requestId: "req_server_fn",
        };
      },
    });

    await adapter.recordServerFunction({
      params: { orgId: "org_123" },
      action: "billing.plan.changed",
      target: { type: "subscription", id: "sub_123" },
      lawfulBasis: "contract",
      retention: "security_1y",
    });

    const [record] = store.records();
    expect(record?.event.action).toBe("billing.plan.changed");
    expect(record?.event.actor).toEqual({ type: "service", id: "tanstack-start" });
    expect(record?.event.target).toEqual({ type: "subscription", id: "sub_123" });
    expect(record?.event.scope).toEqual({ tenantId: "org_123", environment: "test" });
    expect(record?.event.requestId).toBe("req_server_fn");
    expect(record?.event.lawfulBasis).toBe("contract");
    expect(record?.event.retention).toBe("security_1y");
  });

  test("does not record when a wrapped server function fails", async () => {
    const store = new MemoryAuditStore();
    const adapter = createTanStackStartVeritioAdapter({
      recorder: createAuditRecorder({ store }),
    });

    await expect(
      adapter.withServerFunction(
        {
          context: {
            tenantId: "org_123",
            actor: { type: "user", id: "usr_123" },
          },
          action: "profile.settings.updated",
          target: { type: "user_profile", id: "usr_123" },
        },
        async () => {
          throw new Error("mutation failed");
        },
      ),
    ).rejects.toThrow("mutation failed");

    expect(store.records()).toHaveLength(0);
  });
});
