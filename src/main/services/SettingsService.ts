import { injectable, inject } from 'tsyringe'
import { existsSync } from 'fs'
import { cp, mkdir, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { SettingsRepository } from '../repositories/SettingsRepository'
import {
  AppSettings,
  type DataLocationsDto,
  type UpdateAppSettingsInput
} from '../api/schemas/settings.schema'
import { getDbPath, getSqlite } from '../db'
import { getStorageBasePath } from '../utils/fileStorage'
import { DOCUMENTS_DIR } from '../utils/documentStorage'

function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/** "Bookingium-Sicherung 2026-10-19 14-30" (local time, sorts by date) */
export function backupFolderName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `Bookingium-Sicherung ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}-${pad(date.getMinutes())}`
}

const RESTORE_NOTE = `Bookingium – Sicherung

Inhalt
  bookingum.db   die Datenbank (alle Einträge)
  storage/       Dokumente und Logos

Wiederherstellen
  1. Bookingium beenden.
  2. Im Datenordner (Einstellungen › Daten › „Datenordner öffnen“) die Datei
     data/bookingum.db durch die bookingum.db dieser Sicherung ersetzen und
     dort vorhandene bookingum.db-wal und bookingum.db-shm löschen.
  3. Den Ordner storage durch den storage-Ordner dieser Sicherung ersetzen.
  4. Bookingium starten.
`

@injectable()
export class SettingsService {
  constructor(@inject(SettingsRepository) private settingsRepository: SettingsRepository) {}

  /** Stored settings merged over the defaults; unreadable values fall back */
  get(): AppSettings {
    const stored = Object.fromEntries(
      Object.entries(this.settingsRepository.getAll()).map(([key, raw]) => [key, parseValue(raw)])
    )
    const parsed = AppSettings.safeParse(stored)
    return parsed.success ? parsed.data : AppSettings.parse({})
  }

  update(input: UpdateAppSettingsInput): AppSettings {
    const values = Object.fromEntries(
      Object.entries(input)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, JSON.stringify(value)])
    )
    this.settingsRepository.setMany(values)
    return this.get()
  }

  dataLocations(): DataLocationsDto {
    const databaseFile = getDbPath()
    const storage = getStorageBasePath()
    return {
      dataFolder: dirname(storage),
      databaseFile,
      documentsFolder: join(storage, DOCUMENTS_DIR)
    }
  }

  /**
   * Copies the database (consistent snapshot via SQLite's backup API, safe
   * while the app runs) and the storage folder (documents, logos) into a new
   * dated folder inside `targetParent`; returns that folder
   */
  async createBackup(targetParent: string, date = new Date()): Promise<string> {
    const folder = join(targetParent, backupFolderName(date))
    await mkdir(folder, { recursive: true })
    await getSqlite().backup(join(folder, 'bookingum.db'))
    const storage = getStorageBasePath()
    if (existsSync(storage)) await cp(storage, join(folder, 'storage'), { recursive: true })
    await writeFile(join(folder, 'LIESMICH.txt'), RESTORE_NOTE, 'utf-8')
    return folder
  }
}
