import Versions from './components/Versions'
import { Button } from './components/ui/button'

function App(): React.JSX.Element {
  const ipcHandle = (): void => window.electron.ipcRenderer.send('ping')

  return (
    <main className="w-full h-full bg-background">
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <h1 className="text-2xl font-bold">Hello Electron + Shadcn</h1>
          <Button
            variant="outline"
            onClick={() => {
              console.log('Click')
              ipcHandle()
            }}
          >
            Shadcn Button
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
