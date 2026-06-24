import Link from "next/link";
import { runGovernedChange } from "./actions/run-governed-change";
import { recordProfileUpdate } from "./actions/record-profile-update";
import { runGovernedCrud } from "./actions/run-governed-crud";
import { runGovernedLifecycle } from "./actions/run-governed-lifecycle";
import { getReferenceEvidenceTrail, getReferenceGovernedProvenance } from "../src/veritio/server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const trail = await getReferenceEvidenceTrail(5);
  const provenance = await getReferenceGovernedProvenance();

  return (
    <main className="shell">
      <section className="intro">
        <p className="eyebrow">Next.js App Router + Better Auth</p>
        <h1>Server-owned governed CRUD reference</h1>
        <p>
          Record Better Auth lifecycle and app-domain CRUD events while tenant
          and actor identity stay behind the host boundary.
        </p>
      </section>

      <section className="grid">
        <form action={runGovernedCrud} className="panel form-panel">
          <div>
            <h2>Run governed CRUD</h2>
            <p>Create, archive, and delete the demo project with event and graph evidence.</p>
          </div>
          <button type="submit">Run sequence</button>
        </form>

        <form action={runGovernedLifecycle} className="panel form-panel">
          <div>
            <h2>Run lifecycle graph</h2>
            <p>Record auth, org, consent, subject request, export, retention, and processor evidence.</p>
          </div>
          <button type="submit">Run lifecycle</button>
        </form>

        <form action={runGovernedChange} className="panel form-panel">
          <div>
            <h2>Run governed change</h2>
            <p>Record a project-entry recalculation, entity revision, explain path, diff, and rollback revision.</p>
          </div>
          <button type="submit">Run change</button>
        </form>

        <form action={recordProfileUpdate} className="panel form-panel">
          <div>
            <h2>Record profile update</h2>
            <p>Only the profile resource id is submitted by the form.</p>
          </div>
          <label htmlFor="profileId">Profile ID</label>
          <input
            id="profileId"
            name="profileId"
            defaultValue="profile_demo"
            maxLength={80}
            pattern="[A-Za-z0-9_.:-]+"
            required
          />
          <button type="submit">Record event</button>
        </form>

        <section className="panel">
          <h2>Server boundary</h2>
          <dl className="facts">
            <div>
              <dt>Tenant</dt>
              <dd>{trail.session.tenantId}</dd>
            </div>
            <div>
              <dt>Actor</dt>
              <dd>{trail.session.actorUserId}</dd>
            </div>
            <div>
              <dt>Chain</dt>
              <dd>{trail.verification.ok ? "valid" : trail.verification.reason}</dd>
            </div>
            <div>
              <dt>Graph</dt>
              <dd>{trail.edgeVerification.ok ? "valid" : trail.edgeVerification.reason}</dd>
            </div>
          </dl>
        </section>
      </section>

      <section className="panel">
        <div className="section-header">
          <h2>Changes</h2>
          <span className="badge">current protocol</span>
        </div>
        {provenance.changes.length === 0 ? (
          <p className="empty">Run the governed change scenario to create Change views.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Change</th>
                  <th>Activity</th>
                  <th>Output revision</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {provenance.changes.map((change) => (
                  <tr key={change.id}>
                    <td>
                      <strong>{change.title}</strong>
                      <br />
                      <code>{change.id}</code>
                    </td>
                    <td>{change.activityIds.join(", ")}</td>
                    <td>{change.outputRevisionIds.map((id, index) => <code key={`${id}-${index}`}>{id}</code>)}</td>
                    <td>{change.supportingRecordIds.length} records</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid">
        <section className="panel">
          <h2>Entity timeline</h2>
          {provenance.entityTimeline.revisions.length === 0 ? (
            <p className="empty">No project-entry revisions captured yet.</p>
          ) : (
            <ol className="timeline">
              {provenance.entityTimeline.revisions.map((revision) => (
                <li key={revision.id}>
                  <code>{revision.id}</code>
                  <span>{revision.changedPaths.join(", ")}</span>
                  <small>{revision.occurredAt}</small>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="panel">
          <h2>Explain value</h2>
          {provenance.explain ? (
            <dl className="facts">
              <div>
                <dt>Change</dt>
                <dd><code>{provenance.explain.changeId}</code></dd>
              </div>
              <div>
                <dt>Known coverage</dt>
                <dd>{provenance.explain.knownCoverage.join(", ")}</dd>
              </div>
              <div>
                <dt>Not captured</dt>
                <dd>{provenance.explain.notCaptured.join(", ")}</dd>
              </div>
            </dl>
          ) : (
            <p className="empty">No explainable change yet.</p>
          )}
        </section>
      </section>

      <section className="panel">
        <h2>Revision diff</h2>
        {provenance.diff ? (
          <div className="diff-grid">
            {Object.entries(provenance.diff.after).map(([key, value]) => (
              <div key={key} className="diff-cell">
                <span>{key}</span>
                <code>{formatDiffValue(value)}</code>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty">No captured revision diff yet.</p>
        )}
      </section>

      <section className="panel">
        <div className="section-header">
          <h2>Recent records</h2>
          <Link href="/audit">View all</Link>
        </div>
        <RecordList records={trail.records} />
      </section>

      <section className="panel">
        <h2>Recent graph edges</h2>
        {trail.edgeRecords.length === 0 ? (
          <p className="empty">No graph edges yet.</p>
        ) : (
          <ol className="records">
            {trail.edgeRecords.map((record) => (
              <li key={record.hash}>
                <span className="sequence">#{record.sequence}</span>
                <span>{record.edge.relation}</span>
                <code>
                  {record.edge.from.id} → {record.edge.to.resourceType}:{record.edge.to.id}
                </code>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

/**
 * Formats captured governed-field values without exposing object internals as
 * `[object Object]`.
 */
function formatDiffValue(value: unknown): string {
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}

/**
 * Renders recent audit records without exposing raw record metadata in the
 * reference dashboard.
 */
function RecordList({
  records,
}: Readonly<{
  records: Awaited<ReturnType<typeof getReferenceEvidenceTrail>>["records"];
}>) {
  if (records.length === 0) {
    return <p className="empty">No audit records yet.</p>;
  }

  return (
    <ol className="records">
      {records.map((record) => (
        <li key={record.hash}>
          <span className="sequence">#{record.sequence}</span>
          <span>{record.event.action}</span>
          <code>{record.event.target.type}:{record.event.target.id}</code>
        </li>
      ))}
    </ol>
  );
}
