import { app, dialog } from 'electron'
import {
  copyBeforeUpdate,
  pruneBeforeUpdate,
  readLastVersion,
  writeLastVersion
} from '../backup/beforeUpdate'
import { getSqlite } from '../db'
import { runMigrations } from '../db/migrate'
import { backupLocations } from '../services/BackupService'

/**
 * Brings the database to this version's schema. Before pending migrations change it, a copy
 * goes to backup/before-update/; a database from a newer version is left alone. On failure the
 * user gets the reason and the app quits instead of opening on a half-migrated database.
 */
export function migrateDatabase(): boolean {
  const workDir = backupLocations(app.getPath('userData')).workDir
  let copy: string | null = null
  try {
    runMigrations({
      beforeApply: (pending) => {
        copy = copyBeforeUpdate({
          sqlite: getSqlite(),
          workDir,
          fromVersion: readLastVersion(workDir),
          now: new Date()
        })
        console.log(`Database copied before ${pending} migration(s): ${copy}`)
        try {
          pruneBeforeUpdate(workDir)
        } catch (error) {
          console.error('Removing old copies from before an update failed:', error)
        }
      }
    })
    writeLastVersion(workDir, app.getVersion())
    return true
  } catch (error) {
    console.error('Migrating the database failed:', error)
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox(
      'Bookingium kann nicht starten',
      message.startsWith('Die ')
        ? message
        : 'Die Datenbank konnte nicht auf diese Version aktualisiert werden.' +
            (copy ? `\n\nEine Kopie von vorher liegt hier:\n${copy}` : '') +
            `\n\n${message}`
    )
    app.quit()
    return false
  }
}
