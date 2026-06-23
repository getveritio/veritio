"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runGovernedLifecycleScenario } from "../../src/veritio/server";

/**
 * Runs the broader helper-driven lifecycle scenario from a Next server action
 * so the UI can create auth, org, consent, export, retention, and graph evidence
 * without exposing tenant or actor identity to browser form fields.
 */
export async function runGovernedLifecycle() {
  await runGovernedLifecycleScenario();

  revalidatePath("/");
  revalidatePath("/audit");
  redirect("/audit");
}
