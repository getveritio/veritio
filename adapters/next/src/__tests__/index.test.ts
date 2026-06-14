import { describe, expect, test } from "bun:test";
import { MemoryAuditStore, createAuditRecorder } from "@veritio/core";
import { createNextVeritioAdapter } from "../index";

describe("createNextVeritioAdapter", () => {
  test("records an explicit route handler event through an injected recorder", async () => {
    const store = new MemoryAuditStore();
    const adapter = createNextVeritioAdapter({
      recorder: createAuditRecorder({ store }),
      environment: "test",
    });

    await adapter.recordRouteHandler({
      context: {
        tenantId: "org_123",
        actor: { type: "user", id: "usr_123" },
        requestId: "req_123",
      },
      action: "project.settings.updated",
      target: { type: "project", id: "proj_123" },
      purpose: "project_management",
      metadata: { changedField: "visibility" },
    });

    const [record] = store.records();
    expect(record?.event.action).toBe("project.settings.updated");
    expect(record?.event.actor).toEqual({ type: "user", id: "usr_123" });
    expect(record?.event.target).toEqual({ type: "project", id: "proj_123" });
    expect(record?.event.scope).toEqual({ tenantId: "org_123", environment: "test" });
    expect(record?.event.requestId).toBe("req_123");
    expect(record?.event.metadata).toEqual({ changedField: "visibility" });
  });

  test("records a wrapped server action only after the handler succeeds", async () => {
    const store = new MemoryAuditStore();
    const adapter = createNextVeritioAdapter({
      recorder: createAuditRecorder({ store }),
    });

    const result = await adapter.withServerAction(
      {
        context: {
          tenantId: "org_123",
          actor: { type: "service", id: "next-server" },
        },
        action: "project.member.added",
        target: { type: "project_member", id: "mem_123" },
      },
      async () => "created",
    );

    expect(result).toBe("created");
    expect(store.records()).toHaveLength(1);
    expect(store.records()[0]?.event.action).toBe("project.member.added");
  });

  test("fails closed when tenant scope is missing", async () => {
    const store = new MemoryAuditStore();
    const adapter = createNextVeritioAdapter({
      recorder: createAuditRecorder({ store }),
    });

    await expect(
      adapter.recordServerAction({
        context: {
          tenantId: "",
          actor: { type: "user", id: "usr_123" },
        },
        action: "project.member.removed",
        target: { type: "project_member", id: "mem_123" },
      }),
    ).rejects.toThrow("tenantId is required");
    expect(store.records()).toHaveLength(0);
  });
});
