// E2E: "E-Mail-Regeln" in the settings starts folded and has a search field. The rules are
// created over tRPC for an account id of their own; no mailbox is involved.
import { test, expect } from '@playwright/test'
import { mkdirSync } from 'fs'
import { join, resolve } from 'path'
import { launchApp, type AppHandle } from './helpers/launch'

let h: AppHandle
const shots = resolve(process.cwd(), 'tests/e2e/__screenshots__')

async function saveRule(name: string, matchSubject: string): Promise<void> {
  await h.page.evaluate(
    (input) =>
      new Promise<void>((resolveCall, reject) => {
        const w = window as unknown as {
          electronTRPC: {
            sendMessage: (m: unknown) => void
            onMessage: (cb: (m: { id: number; error?: { message: string } }) => void) => void
          }
        }
        const id = Math.floor(Math.random() * 1e9)
        w.electronTRPC.onMessage((m) => {
          if (m.id !== id) return
          if (m.error) reject(new Error(m.error.message))
          else resolveCall()
        })
        w.electronTRPC.sendMessage({
          method: 'request',
          operation: { id, type: 'mutation', path: 'mailRule.save', input, context: {} }
        })
      }),
    {
      name,
      accountId: 'e2e-rules-account',
      enabled: true,
      matchFrom: '',
      matchTo: '',
      matchSubject,
      moveToFolderPath: null,
      markRead: true,
      markFlagged: false,
      link: null
    }
  )
}

test.beforeAll(async () => {
  h = await launchApp()
  await h.page.waitForSelector('text=Dashboard', { timeout: 15_000 })
  await saveRule('Anfragen Festival', 'Festival')
  await saveRule('Newsletter', 'Newsletter')
  await saveRule('Rechnungen', 'Rechnung')
})

test.afterAll(async () => {
  await h.close()
})

test('mail rules are folded and can be searched', async () => {
  const { page } = h
  await page.getByRole('link', { name: 'Einstellungen' }).first().click()
  await page.getByRole('tab', { name: 'E-Mail' }).click()

  const toggle = page.getByRole('button', { name: /3 Regeln/ })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('list', { name: 'E-Mail-Regeln' })).toBeHidden()

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const list = page.getByRole('list', { name: 'E-Mail-Regeln' })
  await expect(list.getByRole('listitem')).toHaveCount(3)

  await page.getByRole('searchbox', { name: 'Regeln durchsuchen' }).fill('newsletter')
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await expect(list).toContainText('Newsletter')
  // Sorting needs the whole list
  await expect(page.getByRole('button', { name: 'Newsletter nach oben' })).toBeDisabled()
  mkdirSync(shots, { recursive: true })
  await page.screenshot({ path: join(shots, 'mail-rules-search.png') })

  await page.getByRole('searchbox', { name: 'Regeln durchsuchen' }).fill('gibt es nicht')
  await expect(page.getByText('Keine Regel passt zu „gibt es nicht“.')).toBeVisible()

  await toggle.click()
  await expect(page.getByRole('list', { name: 'E-Mail-Regeln' })).toBeHidden()
})
