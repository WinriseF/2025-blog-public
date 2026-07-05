'use client'

import { ProjectCard, type Project } from './components/project-card'
import initialList from './list.json'

export default function Page() {
	const projects = initialList as Project[]

	return (
		<div className='flex flex-col items-center justify-center px-6 pt-32 pb-12'>
			<div className='grid w-full max-w-[1200px] grid-cols-2 gap-6 max-md:grid-cols-1'>
				{projects.map(project => (
					<ProjectCard key={project.url} project={project} />
				))}
			</div>
		</div>
	)
}
