type ComponentItem = {
  name: string
  quantity: number
  notes?: string
}

type ComponentsContent = {
  items?: ComponentItem[]
}

export function ComponentsSection({ content }: { content: ComponentsContent | null }) {
  if (!content || !content.items || content.items.length === 0) {
    return <p className="text-[#6a6a6a]">No components listed.</p>
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-[#c1c1c1]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f2f2f2] border-b border-[#c1c1c1]">
              <th className="text-left px-4 py-3 font-semibold text-[#222222] w-8">#</th>
              <th className="text-left px-4 py-3 font-semibold text-[#222222]">Component</th>
              <th className="text-left px-4 py-3 font-semibold text-[#222222] w-24">Quantity</th>
              <th className="text-left px-4 py-3 font-semibold text-[#222222]">Notes</th>
            </tr>
          </thead>
          <tbody>
            {content.items.map((item, i) => (
              <tr
                key={i}
                className="border-b border-[#f2f2f2] last:border-0 hover:bg-[#f2f2f2]/50 transition-colors"
              >
                <td className="px-4 py-3 text-[#6a6a6a]">{i + 1}</td>
                <td className="px-4 py-3 text-[#222222] font-medium">{item.name}</td>
                <td className="px-4 py-3 text-[#222222]">{item.quantity}</td>
                <td className="px-4 py-3 text-[#6a6a6a]">{item.notes ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
