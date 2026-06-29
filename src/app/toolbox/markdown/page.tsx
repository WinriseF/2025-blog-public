import { MarkdownTool } from '../markdown-tool'
import { ToolPageShell } from '../tool-page-shell'

export default function Page() {
	return (
		<ToolPageShell mobileFlush>
			<MarkdownTool />
		</ToolPageShell>
	)
}
