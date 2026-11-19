// #253: which tips show, clicking one away, bringing all back, and "Was ist neu" once per version
import { describe, expect, it } from 'vitest'
import {
  dismissed,
  EMPTY_TIP_STATE,
  isTipShown,
  parseTipState,
  reset,
  TIPS
} from '../src/renderer/src/lib/tips'
import { minorOf, WHATS_NEW, whatsNewFor } from '../src/renderer/src/lib/whatsNew'

describe('tips', () => {
  it('shows every tip until it is clicked away', () => {
    expect(isTipShown(EMPTY_TIP_STATE, 'map')).toBe(true)
    const state = dismissed(EMPTY_TIP_STATE, 'map')
    expect(isTipShown(state, 'map')).toBe(false)
    expect(isTipShown(state, 'dashboard')).toBe(true)
    // twice is once
    expect(dismissed(state, 'map').dismissed).toEqual(['map'])
  })

  it('shows none while switched off, and all again after a reset', () => {
    const off = { ...dismissed(EMPTY_TIP_STATE, 'map'), off: true }
    expect(isTipShown(off, 'dashboard')).toBe(false)
    const back = reset(off)
    expect(isTipShown(back, 'map')).toBe(true)
    expect(isTipShown(back, 'dashboard')).toBe(true)
  })

  it('reads a damaged or foreign value as nothing read', () => {
    expect(parseTipState(null)).toEqual(EMPTY_TIP_STATE)
    expect(parseTipState('{')).toEqual(EMPTY_TIP_STATE)
    expect(parseTipState('{"off":"yes","dismissed":[1,"map"]}')).toEqual({
      off: false,
      dismissed: ['map'],
      lastSeenVersion: null
    })
  })

  it('keeps every tip short: a title and at most a few sentences', () => {
    for (const tip of Object.values(TIPS)) {
      expect(tip.title.length).toBeLessThanOrEqual(40)
      expect(tip.text.length).toBeLessThanOrEqual(320)
    }
  })
})

describe('was ist neu', () => {
  it('shows a minor version once, also for its patch releases', () => {
    expect(minorOf('1.6.2')).toBe('1.6')
    expect(whatsNewFor('1.6.0', null)).toEqual(WHATS_NEW['1.6'])
    expect(whatsNewFor('1.6.0', '1.5.0')).toEqual(WHATS_NEW['1.6'])
    expect(whatsNewFor('1.6.1', '1.6.0')).toEqual([])
  })

  it('shows nothing for a version without highlights', () => {
    expect(whatsNewFor('0.9.0', null)).toEqual([])
  })
})
