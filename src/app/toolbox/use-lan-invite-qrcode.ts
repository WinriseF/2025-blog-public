'use client'

import { useEffect, useState } from 'react'
import * as QRCode from 'qrcode'

export function useLanInviteQrCode(inviteLink: string) {
	const [qrDataUrl, setQrDataUrl] = useState('')

	useEffect(() => {
		if (!inviteLink) {
			setQrDataUrl('')
			return
		}
		let cancelled = false
		QRCode.toDataURL(inviteLink, {
			errorCorrectionLevel: 'M',
			margin: 2,
			width: 220,
			color: { dark: '#173f42', light: '#ffffffff' }
		}).then(url => {
			if (!cancelled) setQrDataUrl(url)
		})
		return () => {
			cancelled = true
		}
	}, [inviteLink])

	return qrDataUrl
}
