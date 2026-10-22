import { TransferPageClient } from '../transfer-page-client'

type TransferPageContext = {
	params: Promise<{
		code: string
	}>
}

export default async function Page({ params }: TransferPageContext) {
	const { code } = await params
	return <TransferPageClient initialCode={code} />
}
