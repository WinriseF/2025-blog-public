# 2025 Blog

WinriseF 的个人站点仓库。

## Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- pnpm 9

## Run

项目当前使用：

```json
"packageManager": "pnpm@9.15.9"
```

如果在 Vercel 部署，需要启用：

```txt
ENABLE_EXPERIMENTAL_COREPACK=1
```

## GitHub App

站点的可视化编辑功能依赖 GitHub App 写回仓库。需要配置这些环境变量：

```txt
NEXT_PUBLIC_GITHUB_OWNER=WinriseF
NEXT_PUBLIC_GITHUB_REPO=2025-blog-public
NEXT_PUBLIC_GITHUB_BRANCH=main
NEXT_PUBLIC_GITHUB_APP_ID=你的 GitHub App ID
```

默认回退值在 [src/consts.ts](./src/consts.ts)。

## Content

以下内容目前通过仓库内数据文件维护：

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
- 站点内容替换中，空列表页面属于正常状态
