import Link from "next/link";
import { getReferenceEvidenceTrail } from "../../src/veritio/server";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const trail = await getReferenceEvidenceTrail(100);

  return (
    <main className="shell">
      <section className="section-header">
        <div>
          <p className="eyebrow">Tenant {trail.session.tenantId}</p>
          <h1>Audit trail</h1>
        </div>
        <Link href="/">Record another event</Link>
      </section>

      <section className="panel">
        <dl className="facts facts-inline">
          <div>
            <dt>Records</dt>
            <dd>{trail.records.length}</dd>
          </div>
          <div>
            <dt>Hash chain</dt>
            <dd>{trail.verification.ok ? "valid" : trail.verification.reason}</dd>
          </div>
          <div>
            <dt>Graph chain</dt>
            <dd>{trail.edgeVerification.ok ? "valid" : trail.edgeVerification.reason}</dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        {trail.records.length === 0 ? (
          <p className="empty">No audit records yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Seq</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Target</th>
                  <th>Hash</th>
                </tr>
              </thead>
              <tbody>
                {trail.records.map((record) => (
                  <tr key={record.hash}>
                    <td>{record.sequence}</td>
                    <td>{record.event.action}</td>
                    <td>{record.event.actor.id}</td>
                    <td>
                      {record.event.target.type}:{record.event.target.id}
                    </td>
                    <td>
                      <code>{record.hash.slice(0, 16)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Activity graph</h2>
        {trail.edgeRecords.length === 0 ? (
          <p className="empty">No graph edges yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Seq</th>
                  <th>From</th>
                  <th>Relation</th>
                  <th>To</th>
                  <th>Hash</th>
                </tr>
              </thead>
              <tbody>
                {trail.edgeRecords.map((record) => (
                  <tr key={record.hash}>
                    <td>{record.sequence}</td>
                    <td>{record.edge.from.id}</td>
                    <td>{record.edge.relation}</td>
                    <td>
                      {record.edge.to.resourceType}:{record.edge.to.id}
                    </td>
                    <td>
                      <code>{record.hash.slice(0, 16)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
