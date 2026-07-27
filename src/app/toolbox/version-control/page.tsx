import type { Metadata } from 'next'
import { VersionControlClient } from './version-control-client'

export const metadata: Metadata = { title: '版本控制器', description: '只读审阅本机 Git 或 SVN 历史、工作区与版本差异' }

export default function VersionControlPage() {
	return <VersionControlClient />
}
