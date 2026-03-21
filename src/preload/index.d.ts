import { ElectronAPI } from '@electron-toolkit/preload'

export interface DocumentAPI {
  uploadDocument: (eventId: number, sourcePath: string, targetFileName: string) => Promise<{
    success: boolean
    relativePath?: string
    fileName?: string
    fileSize?: number
    error?: string
  }>
  openDocument: (filePath: string) => Promise<{ success: boolean; error?: string }>
  revealDocumentInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>
  showOpenDialog: () => Promise<{
    canceled: boolean
    filePaths: string[]
    error?: string
  }>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DocumentAPI
  }
}
