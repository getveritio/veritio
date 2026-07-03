# `@veritio/vue`

Browser-safe Vue helpers for annotating UI elements with inert Veritio
evidence-intent attrs (`data-veritio-action`, `data-veritio-target-type`,
`data-veritio-target-id`, `data-veritio-purpose`).

This package does not import Vue runtime APIs, has **no dependency on
`@veritio/core`**, and does not record audit events. It only declares what a
UI element *intends*; a server-side framework or auth adapter (for example
`@veritio/better-auth` behind an Express or Nitro server) must translate
trusted request context into recorded events through an injected recorder.

## Install

```sh
npm install @veritio/vue
```

## Usage

```ts
import { createVueVeritioAttrs } from "@veritio/vue";

const attrs = createVueVeritioAttrs({
  action: "ui.consent.opened",
  target: { type: "dialog", id: "consent" },
});
```

```vue
<button v-bind="attrs">Manage consent</button>
```

The returned object is frozen and contains only the `data-veritio-*` strings.
`createVeritioAttrs` is exported as a shorter alias.

## Server-only keys are rejected

Because these attrs render into the DOM, the builder **fails closed** with a
`TypeError` if the input carries any server-only key — `recorder`, `store`,
`scope`, `tenantId`, `actor`, `metadata`, `secret`, `token`, `password`,
`authorization`, API keys, connection strings, and similar. Tenant scope and
actor identity are resolved server-side at record time, never embedded in the
page.

Veritio supports audit trail evidence workflows; it is not legal advice and
does not guarantee compliance with any regulation or framework.
