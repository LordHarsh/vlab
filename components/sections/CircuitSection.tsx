type CircuitConnection = {
  from: string
  to: string
}

type CircuitContent = {
  connections?: CircuitConnection[]
  svg_data?: string
}

export function CircuitSection({ content }: { content: CircuitContent | null }) {
  if (!content) {
    return <p className="text-[#6a6a6a]">No circuit content available.</p>
  }

  return (
    <div className="space-y-6">
      {content.svg_data && (
        <div className="border border-[#c1c1c1] rounded-xl overflow-hidden bg-white p-4 flex justify-center">
          {/* eslint-disable-next-line react/no-danger */}
          <div
            className="max-w-full"
            dangerouslySetInnerHTML={{ __html: content.svg_data }}
          />
        </div>
      )}

      {content.connections && content.connections.length > 0 && (
        <div>
          <h3 className="text-sm font-600 text-[#222222] mb-3">Connections</h3>
          <div className="overflow-x-auto rounded-xl border border-[#c1c1c1]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#f2f2f2] border-b border-[#c1c1c1]">
                  <th className="text-left px-4 py-3 font-600 text-[#222222] w-8">#</th>
                  <th className="text-left px-4 py-3 font-600 text-[#222222]">From</th>
                  <th className="text-left px-4 py-3 font-600 text-[#222222]">To</th>
                </tr>
              </thead>
              <tbody>
                {content.connections.map((conn, i) => (
                  <tr
                    key={i}
                    className="border-b border-[#f2f2f2] last:border-0 hover:bg-[#f2f2f2]/50 transition-colors"
                  >
                    <td className="px-4 py-3 text-[#6a6a6a]">{i + 1}</td>
                    <td className="px-4 py-3 text-[#222222] font-500">{conn.from}</td>
                    <td className="px-4 py-3 text-[#222222]">{conn.to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
