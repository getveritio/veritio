import { createFileRoute } from "@tanstack/react-router";
import { resolveReferenceSession, runGovernedLifecycleScenario } from "../../../server/veritio";

/**
 * Runs the multi-step governed lifecycle scenario from the TanStack Start
 * server boundary so tenant, actor, and graph scope remain host-owned.
 */
export const Route = createFileRoute("/api/scenarios/governed-lifecycle")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const session = await resolveReferenceSession(request);
        return Response.json(await runGovernedLifecycleScenario(session));
      },
    },
  },
});
