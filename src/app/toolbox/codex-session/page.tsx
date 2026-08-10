import { ToolPageShell } from '../tool-page-shell'
import { CodexSessionTool } from './codex-session-tool'

export default function Page() {
	return (
		<ToolPageShell mobileFlush>
			<CodexSessionTool />
		</ToolPageShell>
	)
}
