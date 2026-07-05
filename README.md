# 2025 Blog

WinriseF 的个人站点仓库。

架构概览和维护入口见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- pnpm 11

## Run

项目当前使用：

```json
"packageManager": "pnpm@11.7.0"
```

如果在 Vercel 部署，需要启用：

```txt
ENABLE_EXPERIMENTAL_COREPACK=1
```

## Content

站点内容只通过修改仓库文件并提交代码维护，不再提供网页端编辑、保存或删除入口。

主要内容文件：

- `src/config/site-content.json`
- `src/app/about/list.json`
- `src/app/projects/list.json`
- `src/app/bloggers/list.json`
- `src/app/share/list.json`
- `src/app/pictures/list.json`
- `public/blogs/index.json`

## Notes

- 首页欢迎卡片显示名来自 `site-content.json` 的 `meta.title`
- 点赞功能默认关闭；如需启用，配置 `NEXT_PUBLIC_LIKE_ENDPOINT`
- 消息中转站只调用 EdgeOne Edge Functions；如需启用，配置 `NEXT_PUBLIC_TRANSFER_API_BASE`
- 站点内容替换中，空列表页面属于正常状态
