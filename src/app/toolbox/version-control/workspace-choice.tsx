'use client'

import { useEffect, useRef } from 'react'

export type WorkspaceChoice = {
	title: string
	description: string
	options: { value: string; label: string }[]
	resolve: (value: string) => void
}

export function WorkspaceChoiceDialog({ choice, onChoose }: { choice: WorkspaceChoice | null; onChoose: (value: string) => void }) {
	const ref = useRef<HTMLDialogElement>(null)
	useEffect(() => {
		if (choice) ref.current?.showModal()
		else ref.current?.close()
	}, [choice])
	return (
		<dialog ref={ref} onCancel={event => { event.preventDefault(); onChoose('cancel') }} className='border-border bg-bg text-primary fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border p-5 shadow-2xl backdrop:bg-black/60' aria-labelledby='workspace-choice-title'>
			{choice && <>
				<h2 id='workspace-choice-title' className='text-base font-semibold'>{choice.title}</h2>
				<p className='text-secondary mt-3 break-words text-sm leading-6'>{choice.description}</p>
				<div className='mt-6 flex flex-wrap justify-end gap-2'>
					{choice.options.map(option => <button key={option.value} onClick={() => onChoose(option.value)} className='border-border hover:bg-brand/10 rounded-md border px-3 py-2 text-xs'>{option.label}</button>)}
					<button autoFocus onClick={() => onChoose('cancel')} className='border-border rounded-md border px-3 py-2 text-xs'>取消</button>
				</div>
			</>}
		</dialog>
	)
}
