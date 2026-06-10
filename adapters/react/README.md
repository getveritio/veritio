# `@veritio/react`

React helpers for annotating UI elements with inert Veritio evidence intent attributes.

This package does not import React runtime APIs and does not record audit events. Server-side framework or auth adapters must translate trusted request context into Veritio events through an injected recorder.

## Usage

```tsx
import { createReactVeritioAttributes } from "@veritio/react";

const attrs = createReactVeritioAttributes({
  action: "ui.export.clicked",
  target: { type: "button", id: "export" },
  purpose: "data_subject_workflow"
});

export function ExportButton() {
  return <button {...attrs}>Export</button>;
}
```

Do not pass storage credentials, provider tokens, tenant scope, actor context, stores, or recorders into browser helpers. Veritio supports audit trail evidence workflows; it does not guarantee legal compliance.
