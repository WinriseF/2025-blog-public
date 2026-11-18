import type { Metadata } from 'next'
import { ToolPageShell } from '../tool-page-shell'
import { ZipTool } from './zip-tool'

export const metadata: Metadata = { title: '压缩包工具', description: '在浏览器本地打包 ZIP、浏览压缩包内容，并解压所选文件' }

export default function ZipPage() {
	return (
		<ToolPageShell mobileFlush>
			<ZipTool />
		</ToolPageShell>
	)
}
