// #54: what keeps a backup password from being set, as the dialog shows it; null when it can be.
// The main process checks the length again (backup.router setPassword).
import { MIN_BACKUP_PASSWORD_LENGTH } from '../../../../main/backup/policy'

export type PasswordDraft = { password: string; repeat: string; noted: boolean }

export function backupPasswordProblem({ password, repeat, noted }: PasswordDraft): string | null {
  if (password.length < MIN_BACKUP_PASSWORD_LENGTH)
    return `Mindestens ${MIN_BACKUP_PASSWORD_LENGTH} Zeichen.`
  if (password !== repeat) return 'Die beiden Passwörter sind nicht gleich.'
  if (!noted) return 'Bitte bestätigen, dass das Passwort notiert ist.'
  return null
}
