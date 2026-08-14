'use client'

import { useEffect, useState } from 'react'
import { subscribeVersionControlCallbacks } from '@/lib/version-control/launch-client'
import { useVersionControlStore } from '@/lib/version-control/store'
import { RepositoryLaunch } from './repository-launch'
import { Workbench } from './workbench'

export function VersionControlClient() {
	const [supported, setSupported] = useState(true)
	const repository = useVersionControlStore(state => state.repository)
	const connect = useVersionControlStore(state => state.connect)
	const disconnect = useVersionControlStore(state => state.disconnect)

	useEffect(() => {
		const navigatorWithData = navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } }
		const platform = navigatorWithData.userAgentData?.platform || navigator.platform
		setSupported(/^Win/i.test(platform) && !navigatorWithData.userAgentData?.mobile && 'WebTransport' in window)
		const unsubscribe = subscribeVersionControlCallbacks(callback => void connect(callback))
		const closeBridge = () => disconnect()
		window.addEventListener('pagehide', closeBridge)
		window.addEventListener('beforeunload', closeBridge)
		return () => {
			unsubscribe()
			window.removeEventListener('pagehide', closeBridge)
			window.removeEventListener('beforeunload', closeBridge)
			disconnect()
		}
	}, [connect, disconnect])

	return repository ? <Workbench /> : <RepositoryLaunch supported={supported} />
}
