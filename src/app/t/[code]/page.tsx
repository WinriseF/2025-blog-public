import { ToolboxClient } from '../../toolbox/toolbox-client'

type TransferPageContext = {
	params: Promise<{
		code: string
	}>
}

export default async function Page({ params }: TransferPageContext) {
	const { code } = await params
	return <ToolboxClient initialTool='transfer' initialCode={code} />
}
