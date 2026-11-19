import { useSyncExternalStore } from 'react'
import { getTipState, subscribeTips, type TipState } from '@/lib/tips'

/** The tip state of this computer (#253); re-renders when a tip is clicked away or reset */
export function useTipState(): TipState {
  return useSyncExternalStore(subscribeTips, getTipState, getTipState)
}
