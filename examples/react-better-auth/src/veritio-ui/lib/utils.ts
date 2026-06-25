import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class names with conflict resolution. Copied 1:1 from
 * veritio-cloud/src/lib/utils.ts so example primitives resolve variant +
 * caller classes identically to the hosted product. See README SYNC NOTE.
 */
export function cn(...inputs: Array<ClassValue>) {
  return twMerge(clsx(inputs));
}
