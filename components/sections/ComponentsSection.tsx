type ComponentItem = {
  name: string
  quantity: number
  notes?: string
}

type ComponentsContent = {
  items?: ComponentItem[]
}

/**
 * Components required.
 *
 * A bill of materials, set as a table with a serial number column — the same
 * shape as the reference's "List of Experiments". Every index page on that site
 * is an S.No table, and a components list is exactly the kind of thing a lab
 * sheet tabulates.
 */
export function ComponentsSection({ content }: { content: ComponentsContent | null }) {
  if (!content || !content.items || content.items.length === 0) {
    return <p className="text-vlab-muted">No components listed.</p>
  }

  return (
    <div className="overflow-x-auto border border-vlab-rule-strong">
      <table className="vlab-table">
        <thead>
          <tr>
            <th scope="col">S.No</th>
            <th scope="col">Component</th>
            <th scope="col">Qty</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {content.items.map((item, i) => (
            <tr key={i}>
              <th scope="row">{i + 1}</th>
              <td className="font-medium text-vlab-ink">{item.name}</td>
              <td className="tabular-nums text-vlab-ink">{item.quantity}</td>
              <td className="text-vlab-muted">{item.notes ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
