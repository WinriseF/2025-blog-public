'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import siteContent from '@/config/site-content.json'
import { isArticleKey, pageKeyForPath } from '../../supabase/functions/_shared/page-key'

const endpoint = 'https://dcoxphfgchrbgqbxzyic.supabase.co/functions/v1/page-view'

export function PageView({ articlePath }: { articlePath?: string }) {
	const pathname = usePathname()

	useEffect(() => {
		if (process.env.NODE_ENV !== 'production' || !siteContent.siteSwitcher.sites.some(site => site.url === location.origin)) return
		const key = pageKeyForPath(pathname)
		// Detail pages report only after the requested article has loaded successfully.
		if (!key || (isArticleKey(key) ? articlePath !== key : articlePath !== undefined)) return

		const report = () => {
			void fetch(endpoint, { method: 'POST', body: key, keepalive: true, referrerPolicy: 'no-referrer' }).catch(() => {})
		}
		report()
		const onPageShow = (event: PageTransitionEvent) => {
			if (event.persisted) report()
		}
		window.addEventListener('pageshow', onPageShow)
		return () => window.removeEventListener('pageshow', onPageShow)
	}, [pathname, articlePath])

	return null
}
