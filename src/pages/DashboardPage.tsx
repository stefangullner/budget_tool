export default function DashboardPage() {
  return (
    <div className="p-8">
      <h2 className="text-xl font-semibold text-gray-900 mb-1">Översikt</h2>
      <p className="text-sm text-gray-500 mb-8">Budget & utfall per bolag</p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {['Bolag 1', 'Bolag 2', 'Bolag 3', 'Bolag 4'].map((name) => (
          <div key={name} className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm font-medium text-gray-500">{name}</p>
            <p className="mt-2 text-2xl font-semibold text-gray-900">—</p>
            <p className="mt-1 text-xs text-gray-400">Budget ej konfigurerad</p>
          </div>
        ))}
      </div>
    </div>
  )
}
