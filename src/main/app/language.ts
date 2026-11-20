// #254: the UI language is kept per computer in <userData>/ui-language.json, not in the
// database: the database is shared by sync, and two people on two computers may want
// different languages. The renderer reads it synchronously before its first module runs.

import { app, BrowserWindow, ipcMain } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getLanguage, isLanguage, setLanguage, type Language } from '../i18n/translate'

function languageFile(): string {
  return join(app.getPath('userData'), 'ui-language.json')
}

function readStoredLanguage(): Language {
  try {
    const stored: unknown = JSON.parse(readFileSync(languageFile(), 'utf8'))?.language
    return isLanguage(stored) ? stored : 'de'
  } catch {
    // No file yet (or unreadable): German, the default
    return 'de'
  }
}

/** Call once userData is set, before any window loads */
export function setUpLanguage(): void {
  setLanguage(readStoredLanguage())

  ipcMain.on('i18n:getLanguage', (event) => {
    event.returnValue = getLanguage()
  })

  // Stores the choice and reloads the window that asked; other open windows (a mail window)
  // take it on their next load, so an unsaved draft there is not thrown away
  ipcMain.handle('i18n:setLanguage', (event, language: unknown) => {
    if (!isLanguage(language)) throw new Error(`Unknown language: ${String(language)}`)
    writeFileSync(languageFile(), JSON.stringify({ language }), 'utf8')
    setLanguage(language)
    BrowserWindow.fromWebContents(event.sender)?.webContents.reload()
  })
}
