# 2025 Blog

WinriseF 的个人站点仓库。

简要架构和维护入口见 [ARCHITECTURE.md](./ARCHITECTURE.md)；按主题拆分的项目知识库见 [`.project-wiki/INDEX.md`](./.project-wiki/INDEX.md)。

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

## Deployment

当前提交的部署配置是 [netlify.toml](./netlify.toml)，使用 Netlify Next plugin、Node 22 和 `pnpm run build`。

如果单独部署到 Vercel，需要启用：

```txt
ENABLE_EXPERIMENTAL_COREPACK=1
```

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md)：短架构入口和维护导航。
- [`.project-wiki/INDEX.md`](./.project-wiki/INDEX.md)：项目文档路由入口。
- [`.project-wiki/modules/`](./.project-wiki/modules/)：八个按实现边界拆分的维护模块文档。

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
