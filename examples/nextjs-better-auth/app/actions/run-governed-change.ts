"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runGovernedChangeScenario } from "../../src/veritio/server";

/**
 * Runs the project-entry provenance scenario from a server action so the browser
 * never supplies tenant, actor, or HMAC capture material.
 */
export async function runGovernedChange() {
  await runGovernedChangeScenario();

  revalidatePath("/");
  revalidatePath("/audit");
  redirect("/");
}
