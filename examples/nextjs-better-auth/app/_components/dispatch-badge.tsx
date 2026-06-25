import { Badge } from "../../src/veritio-ui/react/badge";
import type { DispatchResult } from "../../src/server/cloud-ingest";

/**
 * Honest dispatch status pill, shared by the change feed (server) and the entry
 * card's last-result banner (client). It has no client hooks, so it renders in
 * either context: dispatched (emerald --success), failed/retrying (warning), or
 * captured locally (muted) when the cloud is not configured.
 */
export function DispatchBadge({ dispatch }: Readonly<{ dispatch: DispatchResult }>) {
  if (dispatch.status === "dispatched") {
    return (
      <Badge variant="success" className="text-[10px]">
        Dispatched to Cloud
      </Badge>
    );
  }
  if (dispatch.status === "failed") {
    return (
      <Badge variant="warning" className="text-[10px]">
        Dispatch failed · retrying
      </Badge>
    );
  }
  return (
    <Badge variant="muted" className="text-[10px]">
      Captured locally
    </Badge>
  );
}
