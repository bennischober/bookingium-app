import { trpcReact } from '@/main'

export default function BandPage() {
  const bands = trpcReact.band.getAll.useQuery()
  const utils = trpcReact.useUtils()

  const createBand = trpcReact.band.create.useMutation({
    onSuccess: () => {
      // Instantly refresh the list
      utils.band.getAll.invalidate()
    }
  })

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Bands</h1>

      <button
        onClick={() =>
          createBand.mutate({
            name: 'Test Band',
            genre: 'Rock',
            companyId: 1
          })
        }
      >
        Add Band
      </button>

      {bands.isLoading && <div>Loading...</div>}
      {bands.data && (
        <pre className="text-xs bg-secondary p-4 rounded overflow-auto">
          {JSON.stringify(bands.data, null, 2)}
        </pre>
      )}
    </div>
  )
}
