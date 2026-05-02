export interface SiteEntry {
	id: string
	name: string
	url: string
	description: string
}

export const siteEntries: SiteEntry[] = [
	{ id: 'github', name: 'GitHub', url: 'https://github.com', description: '代码托管、开源项目与开发协作入口' },
	{ id: 'gitee', name: 'Gitee', url: 'https://gitee.com', description: '国内代码托管与团队研发协作平台' },
	{ id: 'vercel', name: 'Vercel', url: 'https://vercel.com', description: '前端项目部署、预览与生产发布' },
	{ id: 'netlify', name: 'Netlify', url: 'https://www.netlify.com', description: '静态网站与 Jamstack 应用托管' },
	{ id: 'npm', name: 'npm', url: 'https://www.npmjs.com', description: 'JavaScript 包搜索、发布与版本管理' },
	{ id: 'nextjs', name: 'Next.js', url: 'https://nextjs.org', description: 'React 全栈框架文档与生态资源' },
	{ id: 'react', name: 'React', url: 'https://react.dev', description: 'React 官方文档、指南和 API 参考' },
	{ id: 'tailwind', name: 'Tailwind CSS', url: 'https://tailwindcss.com', description: '原子化 CSS 框架文档与组件模式' },
	{ id: 'mdn', name: 'MDN', url: 'https://developer.mozilla.org', description: 'Web 平台、浏览器 API 与标准参考' },
	{ id: 'figma', name: 'Figma', url: 'https://www.figma.com', description: '设计稿、原型与团队设计协作' },
	{ id: 'supabase', name: 'Supabase', url: 'https://supabase.com', description: 'Postgres、认证、存储与实时后端' },
	{ id: 'cloudflare', name: 'Cloudflare', url: 'https://www.cloudflare.com', description: 'CDN、DNS、安全防护与边缘计算' },
	{ id: 'docker', name: 'Docker', url: 'https://www.docker.com', description: '容器构建、镜像分发与本地运行环境' },
	{ id: 'linear', name: 'Linear', url: 'https://linear.app', description: '产品任务、缺陷跟踪与研发计划管理' },
	{ id: 'notion', name: 'Notion', url: 'https://www.notion.so', description: '文档、知识库与项目协作空间' },
	{ id: 'dribbble', name: 'Dribbble', url: 'https://dribbble.com', description: '界面设计、视觉灵感与作品展示' }
]
