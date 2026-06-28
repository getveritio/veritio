/**
 * Agent provenance recorder. A thin composition over the audit-event and
 * evidence-edge primitives that emits the agent.*, change.*, review.*, ci.*, and
 * deploy.* event families together with the evidence-graph edges that connect an
 * agent session's prompts, tool calls, file changes, reviews, builds, deploys,
 * and runtime observations.
 *
 * It owns no protocol semantics and no storage: the host injects
 * recordEvent/recordEdge sinks, so the SDK core never reads environment state.
 * The enforcing human is linked to the session through a caused_by edge (one
 * hop) instead of an audit-event field, keeping the event shape stable.
 *
 * Every event a session emits carries `metadata.sessionId === <sessionId>` (a
 * non-PII recorder convention, not an event-schema field) so a reader can group
 * a session's events with a simple group-by instead of graph traversal — the
 * downstream change/review/ci/deploy/runtime events target isolated or shared
 * entities (source_tree, pull_request, shared files) and cannot otherwise be
 * attributed to one session from the edge graph alone. Callers cannot shadow it:
 * it is applied after any caller-supplied metadata. This is currently TS-only
 * (only the TS recorder exists); the Python/Go recorders must stamp the same key
 * when implemented (see .claude/rules/02-sdk-parity.md).
 * Provider/model identity uses the canonical nested shape
 * agent:{name,version} + model:{provider,name}. See
 * docs/superpowers/specs/2026-06-16-agent-provenance-recorder-design.md.
 *
 * Record ids are deterministic functions of the caller's stable domain ids
 * (sessionId, toolCallId, ...) so re-recording the same logical event yields the
 * same id and the store can replay idempotently; callers may override any event
 * id via input.id. Edge ids derive from (from, relation, to).
 *
 * Privacy: only stable ids, content hashes, and bounded non-PII metadata should
 * travel. Metadata is redacted by KEY NAME only (createAuditEvent), and a
 * Principal's optional `display` is NOT redacted at all — callers must keep
 * display and metadata values free of raw prompts/diffs and PII (prefer stable
 * ids). Edges carry only stable actor ids (display is dropped).
 */
import {
  type AuditEventInput,
  type AuditRecord,
  type EvidenceEdgeInput,
  type EvidenceEdgeRecord,
  type EvidenceEdgeRelation,
  type EvidenceEntity,
  type EvidenceScope,
  type Principal,
} from "./index";
import { withRiskSignals, type RiskSignals } from "./risk";

export interface AgentIdentity {
  name: string;
  version?: string;
}

export interface ModelIdentity {
  provider: string;
  name: string;
}

/**
 * Host-injected persistence so the recorder never owns storage or env access.
 *
 * Ordering/atomicity contract: every record* method calls recordEvent first,
 * then recordEdge once per connecting edge, sequentially. The recorder performs
 * NO cross-sink transaction or compensation, so a host that needs the event and
 * its edges to commit atomically must wrap both sinks in one transaction;
 * otherwise an edge-sink failure can leave a committed event with missing edges.
 */
export interface ProvenanceSinks {
  recordEvent(input: AuditEventInput): Promise<AuditRecord>;
  recordEdge(input: EvidenceEdgeInput): Promise<EvidenceEdgeRecord>;
}

export type TenantScope = EvidenceScope & { tenantId: string };

export interface RecordResult {
  event: AuditRecord;
  edges: EvidenceEdgeRecord[];
}

export interface FileRef {
  id: string;
  pathHash: string;
}

export interface FileModification extends FileRef {
  afterHash: string;
  beforeHash?: string;
  hunkHashes?: string[];
  action?: "create" | "upsert" | "delete";
}

export interface StartSessionInput {
  scope: TenantScope;
  sessionId: string;
  initiatedBy: Principal;
  agentActor: Principal;
  agent: AgentIdentity;
  model: ModelIdentity;
  /** Override the deterministic event id (defaults to evt_session__<sessionId>). */
  id?: string;
  occurredAt?: string | Date;
  purpose?: string;
  retention?: string;
  dataCategories?: string[];
  repository?: { provider: string; id: string };
  branch?: string;
  policyHash?: string;
  configHash?: string;
  sandbox?: { type: string; id: string };
  promptHash?: string;
  contextHashes?: string[];
  requestId?: string;
  /** Non-PII, key-name-redacted metadata only — never raw prompt/diff text. */
  metadata?: Record<string, unknown>;
  /** Layer-1 activity episode id; stamped un-shadowably on the session event and every downstream record* event. */
  activityEpisodeId?: string;
}

export interface PromptInput {
  promptHash: string;
  id?: string;
  occurredAt?: string | Date;
  contextHashes?: string[];
  /** Non-PII, key-name-redacted metadata only — never raw prompt text. */
  metadata?: Record<string, unknown>;
  riskSignals?: RiskSignals;
}

export interface ToolCallInput {
  toolCallId: string;
  tool: string;
  status: string;
  id?: string;
  occurredAt?: string | Date;
  approval?: string;
  inputHash?: string;
  phase?: string;
  latencyMs?: number;
  reads?: FileRef[];
  modifies?: FileModification[];
  metadata?: Record<string, unknown>;
  riskSignals?: RiskSignals;
}

export interface ChangeProposalInput {
  proposalId: string;
  id?: string;
  occurredAt?: string | Date;
  baseVersion?: number;
  resultVersion?: number;
  proposalSignature?: string;
  acceptedPathHashes?: string[];
  rejectedFiles?: FileRef[];
  createdHunks?: Array<{ id: string; hash: string; fileId: string; pathHash: string }>;
  metadata?: Record<string, unknown>;
  riskSignals?: RiskSignals;
}

export interface FileChangeInput {
  sourceTreeId: string;
  files: FileModification[];
  id?: string;
  occurredAt?: string | Date;
  baseVersion?: number;
  resultVersion?: number;
  rootHash?: string;
  manifestDigest?: string;
  causedByProposalId?: string;
  changedBy?: EvidenceEntity;
  metadata?: Record<string, unknown>;
  riskSignals?: RiskSignals;
}

export interface ReviewInput {
  pullRequestId: string;
  reviewer: Principal;
  id?: string;
  occurredAt?: string | Date;
  proposalId?: string;
  approvalHash?: string;
  findingCount?: number;
  waiverCount?: number;
  decision?: "approved" | "changes_requested" | "waived";
  metadata?: Record<string, unknown>;
  riskSignals?: RiskSignals;
}

export interface CiRunInput {
  ciRunId: string;
  service: Principal;
  status: string;
  id?: string;
  occurredAt?: string | Date;
  checks?: string[];
  artifactId?: string;
  artifactHash?: string;
  derivedFromFiles?: FileRef[];
  metadata?: Record<string, unknown>;
  riskSignals?: RiskSignals;
}

export interface DeploymentInput {
  deploymentId: string;
  service: Principal;
  id?: string;
  occurredAt?: string | Date;
  artifactId?: string;
  bundleHash?: string;
  sourceHash?: string;
  policyId?: string;
  policyRequirements?: string[];
  metadata?: Record<string, unknown>;
  riskSignals?: RiskSignals;
}

export interface RuntimeEventInput {
  runtimeEventId: string;
  actor: Principal;
  action: string;
  id?: string;
  occurredAt?: string | Date;
  deploymentId?: string;
  routeHash?: string;
  observedOutcome?: string;
  metadata?: Record<string, unknown>;
  riskSignals?: RiskSignals;
}

export interface ProvenanceSession {
  readonly sessionId: string;
  recordPrompt(input: PromptInput): Promise<RecordResult>;
  recordToolCall(input: ToolCallInput): Promise<RecordResult>;
  recordChangeProposal(input: ChangeProposalInput): Promise<RecordResult>;
  recordFileChange(input: FileChangeInput): Promise<RecordResult>;
  recordReview(input: ReviewInput): Promise<RecordResult>;
  recordCiRun(input: CiRunInput): Promise<RecordResult>;
  recordDeployment(input: DeploymentInput): Promise<RecordResult>;
  recordRuntimeEvent(input: RuntimeEventInput): Promise<RecordResult>;
  link(
    from: EvidenceEntity,
    relation: EvidenceEdgeRelation,
    to: EvidenceEntity,
    metadata?: Record<string, unknown>,
    occurredAt?: string | Date,
  ): Promise<EvidenceEdgeRecord>;
}

export interface ProvenanceRecorder {
  startSession(input: StartSessionInput): Promise<{ session: ProvenanceSession; result: RecordResult }>;
}

const DEFAULT_PURPOSE = "agent_provenance";

/**
 * Drops undefined-valued keys so optional fields never enter metadata as null
 * after redaction. Mirrors the omit-undefined discipline of cleanPrincipal.
 */
function compact(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      out[key] = item;
    }
  }
  return out;
}

/**
 * Maps a file action to its evidence-graph relation so deletions are recorded
 * with the dedicated `deleted` relation rather than collapsing into `modified`.
 */
function fileRelation(action: FileModification["action"]): EvidenceEdgeRelation {
  if (action === "create") {
    return "created";
  }
  if (action === "delete") {
    return "deleted";
  }
  return "modified";
}

/**
 * Maps a principal to an evidence-graph actor entity, carrying actorType only
 * when it is one of the graph's supported actor kinds and never the display
 * name, so only stable actor ids travel on edges.
 */
function actorEntity(principal: Principal): EvidenceEntity {
  if (
    principal.type === "user" ||
    principal.type === "service" ||
    principal.type === "system" ||
    principal.type === "ai_agent"
  ) {
    return { type: "actor", id: principal.id, actorType: principal.type };
  }
  return { type: "actor", id: principal.id };
}

/**
 * Derives a deterministic edge id from its endpoints and relation so the same
 * logical edge replays idempotently through an idempotency-keyed store.
 */
function edgeIdFor(from: EvidenceEntity, relation: EvidenceEdgeRelation, to: EvidenceEntity): string {
  return `edge_${from.type}:${from.id}__${relation}__${to.type}:${to.id}`;
}

/**
 * Persists one edge through the injected sink with a deterministic id, omitting
 * occurredAt when the caller did not supply one so the primitive can stamp it.
 */
async function persistEdge(
  sinks: ProvenanceSinks,
  scope: TenantScope,
  occurredAt: string | Date | undefined,
  from: EvidenceEntity,
  relation: EvidenceEdgeRelation,
  to: EvidenceEntity,
  metadata: Record<string, unknown>,
): Promise<EvidenceEdgeRecord> {
  const input: EvidenceEdgeInput = { id: edgeIdFor(from, relation, to), scope, from, relation, to, metadata };
  if (occurredAt !== undefined) {
    input.occurredAt = occurredAt;
  }
  return sinks.recordEdge(input);
}

/**
 * Creates a provenance recorder bound to host-injected event/edge sinks. The
 * recorder validates nothing the primitives do not already validate; it only
 * shapes family events and the connecting edges.
 */
export function createProvenanceRecorder(sinks: ProvenanceSinks): ProvenanceRecorder {
  return {
    async startSession(input) {
      const sessionMetadata = compact({
        agent: compact({ name: input.agent.name, version: input.agent.version }),
        model: { provider: input.model.provider, name: input.model.name },
        repository: input.repository,
        branch: input.branch,
        policyHash: input.policyHash,
        configHash: input.configHash,
        sandbox: input.sandbox,
        promptHash: input.promptHash,
        contextHashes: input.contextHashes,
        ...input.metadata,
        // Stamped last so a caller's metadata can never shadow the session id or episode id.
        sessionId: input.sessionId,
        activityEpisodeId: input.activityEpisodeId,
      });

      const eventInput: AuditEventInput = {
        id: input.id ?? `evt_session__${input.sessionId}`,
        scope: input.scope,
        actor: input.agentActor,
        action: "agent.session.started",
        target: { type: "agent_session", id: input.sessionId },
        purpose: input.purpose ?? DEFAULT_PURPOSE,
        metadata: sessionMetadata,
      };
      if (input.occurredAt !== undefined) {
        eventInput.occurredAt = input.occurredAt;
      }
      if (input.retention !== undefined) {
        eventInput.retention = input.retention;
      }
      if (input.dataCategories !== undefined) {
        eventInput.dataCategories = input.dataCategories;
      }
      const event = await sinks.recordEvent(eventInput);

      const edges: EvidenceEdgeRecord[] = [];
      const sessionEntity: EvidenceEntity = { type: "agent_session", id: input.sessionId };
      edges.push(
        await persistEdge(
          sinks,
          input.scope,
          input.occurredAt,
          sessionEntity,
          "caused_by",
          actorEntity(input.initiatedBy),
          {
            role: "enforced_by",
          },
        ),
      );
      if (input.requestId) {
        edges.push(
          await persistEdge(
            sinks,
            input.scope,
            input.occurredAt,
            sessionEntity,
            "caused_by",
            {
              type: "resource",
              id: input.requestId,
              resourceType: "change_request",
            },
            {},
          ),
        );
      }

      const ctx: SessionContext = { purpose: input.purpose ?? DEFAULT_PURPOSE };
      if (input.retention !== undefined) {
        ctx.retention = input.retention;
      }
      if (input.dataCategories !== undefined) {
        ctx.dataCategories = input.dataCategories;
      }
      if (input.activityEpisodeId !== undefined) {
        ctx.activityEpisodeId = input.activityEpisodeId;
      }
      const session = makeSession(sinks, input.scope, input.sessionId, input.agentActor, ctx);
      return { session, result: { event, edges } };
    },
  };
}

interface SessionContext {
  purpose: string;
  retention?: string;
  dataCategories?: string[];
  activityEpisodeId?: string;
}

/**
 * Builds a session bound to one tenant scope, agent_session id, and executing
 * agent actor. Every method emits one family event plus the edges that wire its
 * target entity into the per-tenant evidence graph.
 */
function makeSession(
  sinks: ProvenanceSinks,
  scope: TenantScope,
  sessionId: string,
  agentActor: Principal,
  ctx: SessionContext,
): ProvenanceSession {
  const sessionEntity: EvidenceEntity = { type: "agent_session", id: sessionId };

  function buildEvent(
    id: string,
    occurredAt: string | Date | undefined,
    actor: Principal,
    action: string,
    target: { type: string; id: string },
    metadata: Record<string, unknown>,
    riskSignals?: RiskSignals,
  ): AuditEventInput {
    // Stamp the session id (and the Layer-1 activity episode id, when the session
    // declared one) on every event the session emits, AFTER the caller's metadata
    // so neither can be shadowed; risk signals are normalized onto metadata.riskSignals.
    const stamped: Record<string, unknown> = { ...metadata, sessionId };
    if (ctx.activityEpisodeId !== undefined) {
      stamped.activityEpisodeId = ctx.activityEpisodeId;
    }
    const finalMetadata = riskSignals !== undefined ? withRiskSignals(stamped, riskSignals) : stamped;
    const eventInput: AuditEventInput = {
      id,
      scope,
      actor,
      action,
      target,
      purpose: ctx.purpose,
      metadata: finalMetadata,
    };
    if (occurredAt !== undefined) {
      eventInput.occurredAt = occurredAt;
    }
    if (ctx.retention !== undefined) {
      eventInput.retention = ctx.retention;
    }
    if (ctx.dataCategories !== undefined) {
      eventInput.dataCategories = ctx.dataCategories;
    }
    return eventInput;
  }

  function edge(
    occurredAt: string | Date | undefined,
    from: EvidenceEntity,
    relation: EvidenceEdgeRelation,
    to: EvidenceEntity,
    metadata: Record<string, unknown>,
  ): Promise<EvidenceEdgeRecord> {
    return persistEdge(sinks, scope, occurredAt, from, relation, to, metadata);
  }

  return {
    sessionId,

    async recordPrompt(input) {
      const event = await sinks.recordEvent(
        buildEvent(
          input.id ?? `evt_prompt__${sessionId}__${input.promptHash}`,
          input.occurredAt,
          agentActor,
          "agent.prompt.recorded",
          { type: "agent_session", id: sessionId },
          compact({
            promptHash: input.promptHash,
            contextHashes: input.contextHashes,
            ...input.metadata,
          }),
          input.riskSignals,
        ),
      );
      return { event, edges: [] };
    },

    async recordToolCall(input) {
      const toolEntity: EvidenceEntity = { type: "tool_call", id: input.toolCallId };
      const event = await sinks.recordEvent(
        buildEvent(
          input.id ?? `evt_tool__${input.toolCallId}`,
          input.occurredAt,
          agentActor,
          "agent.tool.called",
          toolEntity,
          compact({
            tool: input.tool,
            status: input.status,
            approval: input.approval,
            inputHash: input.inputHash,
            phase: input.phase,
            latencyMs: input.latencyMs,
            ...input.metadata,
          }),
          input.riskSignals,
        ),
      );

      const edges: EvidenceEdgeRecord[] = [];
      edges.push(await edge(input.occurredAt, sessionEntity, "created", toolEntity, { tool: input.tool }));
      for (const read of input.reads ?? []) {
        edges.push(
          await edge(input.occurredAt, toolEntity, "read", { type: "file", id: read.id, pathHash: read.pathHash }, {}),
        );
      }
      for (const mod of input.modifies ?? []) {
        edges.push(
          await edge(
            input.occurredAt,
            toolEntity,
            fileRelation(mod.action),
            { type: "file", id: mod.id, pathHash: mod.pathHash },
            compact({ beforeHash: mod.beforeHash, afterHash: mod.afterHash }),
          ),
        );
      }
      return { event, edges };
    },

    async recordChangeProposal(input) {
      const proposalEntity: EvidenceEntity = {
        type: "resource",
        id: input.proposalId,
        resourceType: "change_proposal",
      };
      const event = await sinks.recordEvent(
        buildEvent(
          input.id ?? `evt_proposal__${input.proposalId}`,
          input.occurredAt,
          agentActor,
          "change.proposal.created",
          { type: "change_proposal", id: input.proposalId },
          compact({
            baseVersion: input.baseVersion,
            resultVersion: input.resultVersion,
            proposalSignature: input.proposalSignature,
            acceptedPathHashes: input.acceptedPathHashes,
            ...input.metadata,
          }),
          input.riskSignals,
        ),
      );

      const edges: EvidenceEdgeRecord[] = [];
      edges.push(await edge(input.occurredAt, proposalEntity, "part_of", sessionEntity, {}));
      for (const rejected of input.rejectedFiles ?? []) {
        edges.push(
          await edge(
            input.occurredAt,
            proposalEntity,
            "read",
            { type: "file", id: rejected.id, pathHash: rejected.pathHash },
            {
              decision: "rejected",
            },
          ),
        );
      }
      for (const hunk of input.createdHunks ?? []) {
        // diff_hunk nodes are keyed by hunk HASH so the proposal's created edge
        // and recordFileChange's part_of edge resolve to the same graph node.
        edges.push(
          await edge(
            input.occurredAt,
            proposalEntity,
            "created",
            { type: "diff_hunk", id: hunk.hash },
            {
              hunkId: hunk.id,
              fileId: hunk.fileId,
            },
          ),
        );
      }
      return { event, edges };
    },

    async recordFileChange(input) {
      const changedBy = input.changedBy ?? sessionEntity;
      const event = await sinks.recordEvent(
        buildEvent(
          input.id ?? `evt_filechange__${input.sourceTreeId}__${input.resultVersion ?? "x"}`,
          input.occurredAt,
          agentActor,
          "change.files.changed",
          { type: "source_tree", id: input.sourceTreeId },
          compact({
            baseVersion: input.baseVersion,
            resultVersion: input.resultVersion,
            rootHash: input.rootHash,
            manifestDigest: input.manifestDigest,
            files: input.files.map((file) =>
              compact({
                pathHash: file.pathHash,
                beforeHash: file.beforeHash,
                afterHash: file.afterHash,
                hunkHashes: file.hunkHashes,
                action: file.action ?? "upsert",
              }),
            ),
            ...input.metadata,
          }),
          input.riskSignals,
        ),
      );

      const edges: EvidenceEdgeRecord[] = [];
      for (const file of input.files) {
        const fileEntity: EvidenceEntity = { type: "file", id: file.id, pathHash: file.pathHash };
        edges.push(
          await edge(
            input.occurredAt,
            changedBy,
            fileRelation(file.action),
            fileEntity,
            compact({ beforeHash: file.beforeHash, afterHash: file.afterHash, resultVersion: input.resultVersion }),
          ),
        );
        for (const hunkHash of file.hunkHashes ?? []) {
          edges.push(
            await edge(input.occurredAt, { type: "diff_hunk", id: hunkHash }, "part_of", fileEntity, { hunkHash }),
          );
        }
        if (input.causedByProposalId) {
          edges.push(
            await edge(
              input.occurredAt,
              fileEntity,
              "caused_by",
              {
                type: "resource",
                id: input.causedByProposalId,
                resourceType: "change_proposal",
              },
              {},
            ),
          );
        }
      }
      return { event, edges };
    },

    async recordReview(input) {
      // The edge relation must reflect the decision: a changes-requested review is
      // NOT an approval, so it links via `reviewed_by` (recording that the human
      // reviewed it) — never `approved_by`, which would falsely assert approval of
      // rejected work.
      const reviewRelation: EvidenceEdgeRelation =
        input.decision === "waived"
          ? "waived_by"
          : input.decision === "changes_requested"
            ? "reviewed_by"
            : "approved_by";
      const action =
        input.decision === "changes_requested"
          ? "review.finding.created"
          : input.decision === "waived"
            ? "review.waiver.recorded"
            : "review.approval.recorded";
      const event = await sinks.recordEvent(
        buildEvent(
          input.id ?? `evt_review__${input.pullRequestId}`,
          input.occurredAt,
          input.reviewer,
          action,
          { type: "pull_request", id: input.pullRequestId },
          compact({
            approvalHash: input.approvalHash,
            findingCount: input.findingCount,
            waiverCount: input.waiverCount,
            decision: input.decision,
            ...input.metadata,
          }),
          input.riskSignals,
        ),
      );

      const edges: EvidenceEdgeRecord[] = [];
      if (input.proposalId) {
        edges.push(
          await edge(
            input.occurredAt,
            { type: "resource", id: input.proposalId, resourceType: "change_proposal" },
            reviewRelation,
            actorEntity(input.reviewer),
            compact({ approvalHash: input.approvalHash }),
          ),
        );
      }
      return { event, edges };
    },

    async recordCiRun(input) {
      const ciEntity: EvidenceEntity = { type: "ci_run", id: input.ciRunId };
      const event = await sinks.recordEvent(
        buildEvent(
          input.id ?? `evt_ci__${input.ciRunId}`,
          input.occurredAt,
          input.service,
          "ci.job.completed",
          ciEntity,
          compact({
            status: input.status,
            checks: input.checks,
            artifactHash: input.artifactHash,
            ...input.metadata,
          }),
          input.riskSignals,
        ),
      );

      const edges: EvidenceEdgeRecord[] = [];
      if (input.artifactId) {
        const artifactEntity: EvidenceEntity = { type: "artifact", id: input.artifactId };
        edges.push(
          await edge(input.occurredAt, artifactEntity, "built_by", ciEntity, compact({ status: input.status })),
        );
        for (const file of input.derivedFromFiles ?? []) {
          edges.push(
            await edge(
              input.occurredAt,
              artifactEntity,
              "derived_from",
              { type: "file", id: file.id, pathHash: file.pathHash },
              {},
            ),
          );
        }
      }
      return { event, edges };
    },

    async recordDeployment(input) {
      const deploymentEntity: EvidenceEntity = { type: "deployment", id: input.deploymentId };
      const event = await sinks.recordEvent(
        buildEvent(
          input.id ?? `evt_deploy__${input.deploymentId}`,
          input.occurredAt,
          input.service,
          "deploy.deployed",
          deploymentEntity,
          compact({ bundleHash: input.bundleHash, sourceHash: input.sourceHash, ...input.metadata }),
          input.riskSignals,
        ),
      );

      const edges: EvidenceEdgeRecord[] = [];
      if (input.artifactId) {
        edges.push(
          await edge(
            input.occurredAt,
            { type: "artifact", id: input.artifactId },
            "deployed_as",
            deploymentEntity,
            compact({
              bundleHash: input.bundleHash,
            }),
          ),
        );
      }
      if (input.policyId) {
        edges.push(
          await edge(
            input.occurredAt,
            deploymentEntity,
            "satisfies_policy",
            { type: "policy", id: input.policyId },
            compact({
              requirements: input.policyRequirements,
            }),
          ),
        );
      }
      return { event, edges };
    },

    async recordRuntimeEvent(input) {
      const runtimeEntity: EvidenceEntity = { type: "runtime_event", id: input.runtimeEventId };
      const event = await sinks.recordEvent(
        buildEvent(
          input.id ?? `evt_runtime__${input.runtimeEventId}`,
          input.occurredAt,
          input.actor,
          input.action,
          runtimeEntity,
          compact({
            deploymentId: input.deploymentId,
            routeHash: input.routeHash,
            observedOutcome: input.observedOutcome,
            ...input.metadata,
          }),
          input.riskSignals,
        ),
      );

      const edges: EvidenceEdgeRecord[] = [];
      if (input.deploymentId) {
        edges.push(
          await edge(
            input.occurredAt,
            { type: "deployment", id: input.deploymentId },
            "observed_in",
            runtimeEntity,
            compact({
              routeHash: input.routeHash,
            }),
          ),
        );
      }
      return { event, edges };
    },

    async link(from, relation, to, metadata, occurredAt) {
      return edge(occurredAt, from, relation, to, metadata ?? {});
    },
  };
}
