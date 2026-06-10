# `@veritio/vue`

Vue helpers for annotating UI elements with inert Veritio evidence intent attrs.

This package does not import Vue runtime APIs and does not record audit events. Server-side framework or auth adapters must translate trusted request context into Veritio events through an injected recorder.

## Usage

```ts
import { createVueVeritioAttrs } from "@veritio/vue";

const attrs = createVueVeritioAttrs({
  action: "ui.consent.opened",
  target: { type: "dialog", id: "consent" }
});
```

```vue
<button v-bind="attrs">Manage consent</button>
```

Do not pass storage credentials, provider tokens, tenant scope, actor context, stores, or recorders into browser helpers. Veritio supports audit trail evidence workflows; it does not guarantee legal compliance.
