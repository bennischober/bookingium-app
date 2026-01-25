import { trpcReact } from './main'
import Versions from './components/Versions'
import { Button } from './components/ui/button'

function App(): React.JSX.Element {
  const bands = trpcReact.band.getAll.useQuery(undefined, {
    enabled: false
  })

  return (
    <main className="w-full h-full bg-background">
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <h1 className="text-2xl font-bold">tRPC Test</h1>

          <div className="border p-4 rounded bg-secondary max-w-2xl overflow-auto">
            {bands.isFetching ? (
              'Loading...'
            ) : bands.data ? (
              <pre className="text-xs">{JSON.stringify(bands.data, null, 2)}</pre>
            ) : (
              'No data'
            )}
          </div>

          <Button variant="outline" onClick={() => bands.refetch()}>
            Fetch Bands
          </Button>
        </div>

        <Versions />
      </div>
    </main>
  )
}

export default App
