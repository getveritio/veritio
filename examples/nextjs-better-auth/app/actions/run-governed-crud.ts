"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordProjectMutation, resolveReferenceSession } from "../../src/veritio/server";

/**
 * Runs a complete create/update/delete project sequence from a Next server
 * action so the example demonstrates app-domain evidence without exposing
 * tenant or actor identity to the browser form.
 */
export async function runGovernedCrud() {
  const session = await resolveReferenceSession();
  const requestId = `ref_${randomUUID()}`;
  await recordProjectMutation({
    kind: "create",
    session,
    projectId: "project_demo",
    name: "Governed Project",
    requestId: `${requestId}:create`,
    source: "nextjs_server_action",
  });
  await recordProjectMutation({
    kind: "update",
    session,
    projectId: "project_demo",
    status: "archived",
    requestId: `${requestId}:update`,
    source: "nextjs_server_action",
  });
  await recordProjectMutation({
    kind: "delete",
    session,
    projectId: "project_demo",
    requestId: `${requestId}:delete`,
    source: "nextjs_server_action",
  });

  revalidatePath("/");
  revalidatePath("/audit");
  redirect("/audit");
}
