import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class names with conflict resolution. Mirrors the shared design
 * kit's `lib/utils.ts` (clsx + tailwind-merge) so these re-authored Vue leaf
 * components resolve variant + caller classes identically to the React
 * primitives — a caller override such as `h-8` cleanly replaces the variant's
 * `h-9` instead of leaving both. See examples/_shared/veritio-ui/README.md.
 */
export function cn(...inputs: Array<ClassValue>): string {
  return twMerge(clsx(inputs));
}
