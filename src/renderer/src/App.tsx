import { trpcReact } from './main'
import Versions from './components/Versions'
import { Button } from './components/ui/button'

function App(): React.JSX.Element {
  const hello = trpcReact.greeting.useQuery({ name: 'Electron' }, { enabled: false })

  return (
    <main className="w-full h-full bg-background">
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <h1 className="text-2xl font-bold">tRPC Test</h1>

          <div className="border p-4 rounded bg-secondary">
            {hello.isFetching ? 'Loading...' : (hello.data?.text ?? 'Click button to fetch')}
          </div>

          <Button variant="outline" onClick={() => hello.refetch()}>
            Fetch Greeting
          </Button>
        </div>
      </div>
      <div className="flex justify-center items-center">
        <Versions />
      </div>
    </main>
  )
}

export default App
