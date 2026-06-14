import Link from "next/link";
import { recordProfileUpdate } from "./actions/record-profile-update";
import { getReferenceAuditTrail } from "../src/veritio/server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const trail = await getReferenceAuditTrail(5);

  return (
    <main className="shell">
      <section className="intro">
        <p className="eyebrow">Next.js App Router + Better Auth</p>
        <h1>Server-owned audit trail reference</h1>
        <p>
          Record application events through a server action while the tenant and
          actor stay behind the host boundary.
        </p>
      </section>

      <section className="grid">
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
          </dl>
        </section>
      </section>

      <section className="panel">
        <div className="section-header">
          <h2>Recent records</h2>
          <Link href="/audit">View all</Link>
        </div>
        <RecordList records={trail.records} />
      </section>
    </main>
  );
}

/**
 * Renders recent audit records without exposing raw record metadata in the
 * reference dashboard.
 */
function RecordList({
  records,
}: Readonly<{
  records: Awaited<ReturnType<typeof getReferenceAuditTrail>>["records"];
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
