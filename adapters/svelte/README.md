# `@veritio/svelte`

Svelte helpers for annotating UI elements with inert Veritio evidence intent attributes.

This package does not import Svelte runtime APIs and does not record audit events. Server-side framework or auth adapters must translate trusted request context into Veritio events through an injected recorder.

## Usage

```ts
import { createSvelteVeritioAttributes } from "@veritio/svelte";

const attrs = createSvelteVeritioAttributes({
  action: "ui.dsars.requested",
  target: { type: "form", id: "dsar-request" }
});
```

```svelte
<form {...attrs}>
  <button type="submit">Request export</button>
</form>
```

Do not pass storage credentials, provider tokens, tenant scope, actor context, stores, or recorders into browser helpers. Veritio supports audit trail evidence workflows; it does not guarantee legal compliance.
