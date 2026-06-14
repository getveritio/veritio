---
paths:
  - "adapters/react/**/*.{ts,tsx}"
  - "adapters/vue/**/*.{ts,vue}"
  - "adapters/svelte/**/*.{ts,svelte}"
  - "adapters/sveltekit/**/*.{ts,svelte}"
  - "examples/**/*.{ts,tsx,jsx,svelte,vue}"
---

# Minimize useEffect

This rule applies to adapter and example UI code, not SDK core. SDK core stays framework-agnostic and must not depend on React/Vue/Svelte lifecycle.

`useEffect` (and equivalent Vue/Svelte reactive lifecycle hooks) is a recurring source of bugs (render loops, stale closures, duplicated server state, hydration drift). Treat every `useEffect` as a code smell until proven necessary.

## Policy

- **Do not add `useEffect` without justification.** Before writing one, run through the alternatives below. If an alternative works, use it.
- **When reviewing or touching code that contains `useEffect`**, evaluate whether it can be replaced. If it can, refactor it as part of the change.

## Alternatives (preferred over useEffect)

| Need | Use instead |
|---|---|
| Derived / computed value from props/state | Compute inline, or `useMemo` if expensive (Vue `computed`, Svelte derived) |
| Server data (reads) | Loader or a query library (`useQuery`) |
| Server writes (mutations) | `useMutation` or an action handler |
| Reacting to user events | Event handlers directly — not effect chains |
| Resetting state when a key changes | React `key` prop on the component |
| Initializing state once | `useState(() => initialValue)` lazy initializer |
| Global / shared client state | A store or context — not effect-synced useState |

## When useEffect IS appropriate

Effects are for synchronizing with **external systems** that live outside the framework:

- DOM event listeners (`addEventListener`, `ResizeObserver`, `IntersectionObserver`)
- WebSocket subscriptions and timers
- Imperative library setup/teardown (charts, maps, animation libs)
- Imperative DOM focus/scroll after commit

If the effect doesn't involve an external system, it almost certainly shouldn't be a `useEffect`.

## Hygiene (when an effect is truly needed)

- Never disable exhaustive-deps lint. Fix the dependency issue.
- One effect = one external concern. Keep effects small and focused.
- Always clean up subscriptions, timers, and observers in the return function.
- Ensure idempotency — Strict Mode runs setup/cleanup twice in dev.
- Avoid bare `setState` inside effects; it usually signals derived state that should be computed inline.
