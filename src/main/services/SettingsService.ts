import { injectable, inject } from 'tsyringe'
import { dirname, join } from 'path'
import { SettingsRepository } from '../repositories/SettingsRepository'
import {
  AppSettings,
  type DataLocationsDto,
  type UpdateAppSettingsInput
} from '../api/schemas/settings.schema'
import { getDbPath } from '../db'
import { getStorageBasePath } from '../utils/fileStorage'
import { DOCUMENTS_DIR } from '../utils/documentStorage'

function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

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
}
