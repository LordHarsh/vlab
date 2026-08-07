type CircuitConnection = {
  from: string
  to: string
}

type CircuitContent = {
  connections?: CircuitConnection[]
}

/**
 * Circuit diagram — the connection schedule.
 *
 * A wiring table is the standard way a lab manual states a circuit in text, so
 * it uses the same S.No table as every other index on the site.
 */
export function CircuitSection({ content }: { content: CircuitContent | null }) {
  if (!content) {
    return <p className="text-vlab-muted">No circuit content available.</p>
  }

  if (!content.connections || content.connections.length === 0) {
    return <p className="text-vlab-muted">No connections listed.</p>
  }

  return (
    <div>
      <h2 className="mb-3 font-chrome text-[14px] font-bold uppercase tracking-[0.07em] text-vlab-800">
        Connections
      </h2>
      <div className="overflow-x-auto border border-vlab-rule-strong">
        <table className="vlab-table">
          <thead>
            <tr>
              <th scope="col">S.No</th>
              <th scope="col">From</th>
              <th scope="col">To</th>
            </tr>
          </thead>
          <tbody>
            {content.connections.map((conn, i) => (
              <tr key={i}>
                <th scope="row">{i + 1}</th>
                <td className="font-medium text-vlab-ink">{conn.from}</td>
                <td className="text-vlab-ink">{conn.to}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
