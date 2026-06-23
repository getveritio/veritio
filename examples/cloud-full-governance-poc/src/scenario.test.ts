import { describe, expect, test } from "bun:test";
import { auditTemplateSets } from "@veritio/core";
import {
  buildFullGovernanceScenario,
  fullGovernanceActions,
  fullGovernanceRelations,
  hostedCloudActions,
  hostedCloudAuthorities,
  sdkGovernanceTemplateActions,
} from "./scenario";

describe("cloud full governance POC", () => {
  test("covers every non-agent non-code SDK template action", () => {
    const scenario = buildFullGovernanceScenario({
      tenantId: "tenant_full_governance",
      runId: "run_full_governance",
    });
    const actions = scenario.events.map((event) => event.action);
    const expected: string[] = [
      ...auditTemplateSets.auth,
      ...auditTemplateSets.organization,
      ...auditTemplateSets.data,
    ].sort();

    expect(actions.filter((action) => expected.includes(action)).sort()).toEqual(expected);
    expect([...sdkGovernanceTemplateActions].map(String).sort()).toEqual(expected);
    expect([...new Set(actions)].sort()).toEqual([...fullGovernanceActions].map(String).sort());
    expect(actions.some((action) => action.startsWith("agent."))).toBe(false);
    expect(actions.some((action) => action.startsWith("change."))).toBe(false);
    expect(actions.some((action) => action.startsWith("review."))).toBe(false);
    expect(actions.some((action) => action.startsWith("ci."))).toBe(false);
    expect(actions.some((action) => action.startsWith("deploy."))).toBe(false);
  });

  test("covers hosted Cloud project, scoped-key, ingest, read, audit, and retention actions", () => {
    const scenario = buildFullGovernanceScenario({
      tenantId: "tenant_full_governance",
      runId: "run_full_governance",
    });
    const actions = new Set(scenario.events.map((event) => event.action));
    const keyAuthorities = new Set(
      scenario.events
        .filter((event) => event.action === "scoped.key.created")
        .map((event) => event.metadata?.authority),
    );

    for (const action of hostedCloudActions) {
      expect(actions.has(action)).toBe(true);
    }
    for (const authority of hostedCloudAuthorities) {
      expect(keyAuthorities.has(authority)).toBe(true);
    }
  });

  test("covers the broad non-code graph vocabulary without agent session entities", () => {
    const scenario = buildFullGovernanceScenario({
      tenantId: "tenant_full_governance",
      runId: "run_full_governance",
    });
    const relations = [...new Set(scenario.edges.map((edge) => edge.relation))].sort();
    const entityTypes = new Set(
      scenario.edges.flatMap((edge) => [edge.from.type, edge.to.type]),
    );

    expect(relations).toEqual([...fullGovernanceRelations].sort());
    expect(entityTypes.has("agent_session")).toBe(false);
    expect(entityTypes.has("file")).toBe(false);
    expect(entityTypes.has("commit")).toBe(false);
    expect(entityTypes.has("pull_request")).toBe(false);
  });

  test("uses country/region auth metadata and deterministic canonical JSON hash", () => {
    const first = buildFullGovernanceScenario({
      tenantId: "tenant_full_governance",
      runId: "run_full_governance",
    });
    const second = buildFullGovernanceScenario({
      tenantId: "tenant_full_governance",
      runId: "run_full_governance",
    });
    const authEvent = first.events.find((event) => event.action === "auth.session.created");

    expect(first.canonicalPlanHash).toBe(second.canonicalPlanHash);
    expect(first.canonicalPlanHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(authEvent?.metadata?.securityContext).toMatchObject({
      location: { country: "US", region: "CA" },
      provider: "better-auth",
      method: "password",
    });
  });

  test("covers every audit classifier visibility and surface value", () => {
    const scenario = buildFullGovernanceScenario({
      tenantId: "tenant_full_governance",
      runId: "run_full_governance",
    });
    const visibilities = new Set(scenario.events.map((event) => event.metadata?.logVisibility));
    const surfaces = new Set(scenario.events.map((event) => event.metadata?.logSurface));

    expect(visibilities).toEqual(new Set(["internal", "external", "partner", "system"]));
    expect(surfaces).toEqual(new Set(["api", "app", "worker", "cli", "webhook"]));
  });
});
