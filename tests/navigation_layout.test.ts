// The menu's groups and the Alt+digit shortcuts: one per digit, each on a page of its own
import { describe, expect, it } from 'vitest'
import { getGroupedRoutes, ROUTE_SHORTCUTS } from '../src/renderer/src/lib/routing'

describe('menu', () => {
  it('groups planning, money, contacts, communication and administration', () => {
    expect(getGroupedRoutes().map((group) => group.title)).toEqual([
      'Planung',
      'Finanzen',
      'Kontakte',
      'Kommunikation',
      'Verwaltung'
    ])
    const money = getGroupedRoutes().find((group) => group.title === 'Finanzen')
    expect(money?.items.map((route) => route.title)).toEqual([
      'Rechnungen',
      'Belege',
      'Reisekosten'
    ])
  })

  it('gives each digit to exactly one page, Alt+1 to Alt+0 in order', () => {
    expect(ROUTE_SHORTCUTS.map((shortcut) => shortcut.key)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '0'
    ])
    expect(ROUTE_SHORTCUTS.map((shortcut) => shortcut.route.path)).toEqual([
      '/',
      '/calendar',
      '/events',
      '/tours',
      '/invoices',
      '/band',
      '/persons',
      '/companies',
      '/clubs',
      '/mail'
    ])
  })
})
