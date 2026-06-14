import { describe, expect, test } from "bun:test";
import { createReactVeritioAttributes } from "../index";

describe("createReactVeritioAttributes", () => {
  test("creates inert data attributes for server-side evidence capture", () => {
    const attributes = createReactVeritioAttributes({
      action: "ui.export.clicked",
      target: { type: "button", id: "export" },
      purpose: "data_subject_workflow",
    });

    expect(attributes).toEqual({
      "data-veritio-action": "ui.export.clicked",
      "data-veritio-target-type": "button",
      "data-veritio-target-id": "export",
      "data-veritio-purpose": "data_subject_workflow",
    });
    expect(Object.isFrozen(attributes)).toBe(true);
  });

  test("rejects server-only recorder or credential inputs", () => {
    expect(() =>
      createReactVeritioAttributes({
        action: "ui.export.clicked",
        target: { type: "button", id: "export" },
        recorder: {},
      } as never),
    ).toThrow("client evidence attributes must not include recorder");
  });
});
