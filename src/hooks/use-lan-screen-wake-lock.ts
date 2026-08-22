'use client'

import { useScreenWakeLock, type ScreenWakeLockState } from './use-screen-wake-lock'

export type LanScreenWakeLockState = ScreenWakeLockState

export function useLanScreenWakeLock(): LanScreenWakeLockState {
	return useScreenWakeLock({ storageKey: 'lan-screen-wake-lock-enabled' })
}
