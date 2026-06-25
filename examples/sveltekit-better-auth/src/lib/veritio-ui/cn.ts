/**
 * Minimal class-name joiner for the re-authored Svelte design-kit leaves.
 *
 * The React kit composes classes with clsx + tailwind-merge; the Svelte
 * examples (per the design-kit README) re-author their own leaf components
 * against the SAME class strings and only need a falsy-pruning joiner — there
 * are no conflicting Tailwind utilities to merge in these small primitives.
 * Keeping this dependency-free avoids pulling clsx/tailwind-merge into a Svelte
 * example that does not otherwise need them.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
