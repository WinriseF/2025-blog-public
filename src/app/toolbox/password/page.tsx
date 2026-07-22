import { PasswordGeneratorTool } from '../password-generator-tool'
import { ToolPageShell } from '../tool-page-shell'

export default function Page() {
	return (
		<ToolPageShell>
			<PasswordGeneratorTool />
		</ToolPageShell>
	)
}
