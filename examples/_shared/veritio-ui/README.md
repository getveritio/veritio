# `@veritio/example-ui` — shared example design kit

A small, build-step-free design kit so the Veritio OSS **example apps** match the
hosted Cloud's visual language: OKLCH monochrome-zinc tokens, Geist + Geist Mono,
shadcn **new-york** primitives, `--radius: 0.65rem`, the signature `.bg-dotgrid`
texture, and the **emerald-only rule** (green is reserved for `--success` and the
brand mark; `--primary` is near-black ink, not a hue).

This kit is **copied / imported by examples**, not published to npm and not a
runtime dependency of the SDK. There is no build step — examples consume the
source files directly.

## SYNC NOTE — source of truth

The source of truth is **`veritio-cloud/src/styles.css`** (plus that repo's
`components.json`, `src/lib/utils.ts`, and `src/components/ui/*`). When the cloud
tokens, fonts, radius, or primitives change, **re-copy them here** so the examples
do not drift from the product. Each file in this kit names the cloud file it
mirrors. Do not invent a different palette or add accent hues.

## Manifest — files in this kit

| File | What it is | Mirrors (cloud) |
| --- | --- | --- |
| `styles.css` | Drop-in Tailwind v4 stylesheet: `@import "tailwindcss"`, `@theme inline` mapping, full `:root` + `.dark` OKLCH-zinc token set, Geist font wiring, `--radius`, `--success`, and `.bg-dotgrid`. | `src/styles.css` |
| `lib/utils.ts` | `cn()` helper (clsx + tailwind-merge). | `src/lib/utils.ts` |
| `react/button.tsx` | shadcn new-york Button (CVA + Radix Slot `asChild`). | `src/components/ui/button.tsx` |
| `react/card.tsx` | Card / CardHeader / CardTitle / CardDescription / CardContent / CardFooter. | `src/components/ui/card.tsx` |
| `react/badge.tsx` | Badge (status pills; `success` is the only emerald variant). | `src/components/ui/badge.tsx` |
| `react/input.tsx` | Input (bordered zinc field + focus ring). | `src/components/ui/input.tsx` |
| `components.json` | shadcn config: new-york / neutral / cssVariables / lucide. | `components.json` |
| `README.md` | This manifest. | — |

The `react/*` primitives import `cn` from `../lib/utils` (relative), so the kit
works dropped into any example regardless of its `@/` alias setup. They are
React 19 + `lucide-react` compatible (no icons are imported by the kit itself;
add `lucide-react` only if your example renders icons).

## Dependencies a consuming example must add

Versions below match `veritio-cloud/package.json` so example output stays
pixel-identical to the product. Newer compatible versions are fine; keep the
major versions aligned.

### Required for `styles.css` (all examples — React, Vue, Svelte)

```
tailwindcss@^4.3.1
@tailwindcss/vite@^4.3.1
```

Wire the plugin in the example's `vite.config.*`:

```ts
import tailwindcss from '@tailwindcss/vite'
// plugins: [tailwindcss(), /* framework plugin(s) */]
```

### Additionally required for the `react/*` primitives (React-family examples)

```
clsx@^2.1.1
tailwind-merge@^3.6.0
class-variance-authority@^0.7.1
@radix-ui/react-slot@^1.2.5
react@^19          react-dom@^19
```

Add `lucide-react@^1.18.0` only if the example renders lucide icons.

### Fonts (Geist + Geist Mono)

`styles.css` references the font **names** `"Geist"` / `"Geist Mono"`; the
example must actually load the faces. Pick ONE:

- **Recommended — self-hosted `geist` package** (no CDN dependency, works
  offline, matches the family the cloud renders):

  ```
  geist@^1
  ```

  Import the CSS once in the app entry (alongside `styles.css`):

  ```ts
  import 'geist/font/sans'
  import 'geist/font/mono'
  ```

  > The `geist/font/sans` and `geist/font/mono` CSS entries register the
  > `"Geist"` / `"Geist Mono"` family names that `styles.css` already expects.

- **CDN — Google Fonts** (this is exactly what `veritio-cloud` does today; use
  for the closest match to the live product or to avoid a font dep). Add to the
  example's HTML `<head>`:

  ```html
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Geist:wght@300..700&family=Geist+Mono:wght@400..600&display=swap"
  />
  ```

If neither is added, the kit gracefully falls back to the system sans/mono stack
declared in `--font-sans` / `--font-mono`.

## React-family import snippet (Next, React, TanStack Start)

Import the stylesheet **once** (app entry / root), then use primitives anywhere:

```ts
// app entry (e.g. main.tsx / __root.tsx)
import '../../_shared/veritio-ui/styles.css'
import 'geist/font/sans' // optional, see Fonts above
import 'geist/font/mono'
```

```tsx
// any component
import { Button } from '../../_shared/veritio-ui/react/button'
import { Card, CardHeader, CardTitle, CardContent } from '../../_shared/veritio-ui/react/card'
import { Badge } from '../../_shared/veritio-ui/react/badge'

export function Example() {
  return (
    <Card className="bg-dotgrid">
      <CardHeader>
        <CardTitle>Evidence stream</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center gap-2">
        <Badge variant="success">verified</Badge>
        <Button>Record event</Button>
      </CardContent>
    </Card>
  )
}
```

> Adjust the relative path (`../../_shared/...`) to your example's depth, or add
> an `@veritio/example-ui` alias in the example's `tsconfig`/Vite config pointing
> at this directory.

## Vue / Svelte examples

Vue and Svelte examples import **only `styles.css`** and **re-author their own
leaf components** (button, card, badge, input) in their native template syntax —
but against the **same CSS variables** (`bg-primary`, `text-muted-foreground`,
`bg-card`, `border`, `rounded-xl`, `bg-success/15`, `.bg-dotgrid`, etc.) and the
same class strings used in the `react/*` files above. Do **not** port the React
`.tsx` primitives; do **not** introduce a different palette. Copy the class
strings from the matching `react/*` file so the rendered result is identical.

```ts
// vue/svelte app entry
import '../../_shared/veritio-ui/styles.css'
```
