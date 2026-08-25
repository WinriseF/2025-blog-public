import type { Metadata } from 'next'
import { ToolPageShell } from '../tool-page-shell'
import { ZipTool } from './zip-tool'

export const metadata: Metadata = { title: 'ZIP 打包器', description: '在浏览器本地筛选目录内容并流式生成 ZIP 文件' }

export default function ZipPage() {
	return (
		<ToolPageShell mobileFlush>
			<ZipTool />
		</ToolPageShell>
	)
}
