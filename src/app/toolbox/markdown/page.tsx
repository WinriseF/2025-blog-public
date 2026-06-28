import { MarkdownTool } from '../markdown-tool'
import { ToolPageShell } from '../tool-page-shell'

export default function Page() {
	return (
		<ToolPageShell eyebrow='Markdown' title='Markdown 查看器' description='本地预览 .md 文件' mobileFlush>
			<MarkdownTool />
		</ToolPageShell>
	)
}
