import { test } from '@playwright/test'
import { launchApp } from './helpers/launch'

test('manual electron-trpc roundtrip via window.electronTRPC', async () => {
  const h = await launchApp()
  const raw = await h.page.evaluate(async () => {
    const trpc = window.electronTRPC
    return await new Promise((resolveP) => {
      const timeout = setTimeout(() => resolveP({ ok: false, err: 'TIMEOUT after 5s' }), 5000)
      trpc.onMessage((msg) => {
        clearTimeout(timeout)
        resolveP({ ok: true, res: JSON.stringify(msg).slice(0, 250) })
      })
      // electron-trpc renderer protocol: send({id, method, params})
      trpc.sendMessage({
        id: 777,
        method: 'query',
        params: { path: 'relation.getBandMembers', input: { bandId: 1 } }
      })
    })
  })
  console.log('ROUNDTRIP:', JSON.stringify(raw))
  await h.close()
})
