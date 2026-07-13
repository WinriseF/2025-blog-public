# 项目代码冗余审查报告

- 审查日期：2026-07-13
- 审查范围：`src/`、`scripts/`、`edge-functions/`、根目录配置与架构文档
- 审查目标：只记录无引用、完全重复、同一状态重复维护、无效客户端边界和明确未复用的实现
- 审查方式：静态引用扫描、导出符号扫描、函数体比对、规范化文件内容比对和人工上下文复核

## 1. 结论摘要

项目的确定性冗余主要集中在以下方面：

1. 已无引用的源文件、函数、类型和常量仍保留在仓库中。
2. 首页静态 JSON 被包装成可变 Zustand Store，但所有写入入口均未使用。
3. 视口尺寸和中心位置由两套 Store、两套 `resize` 监听重复维护。
4. 新闻、LAN 存储、随机 ID、下载触发、字节格式化等基础逻辑存在多份实现。
5. 四个纯数据/包装页面被不必要地标记为 Client Component。
6. `tailwindcss-animate` 已注册且安装，但项目没有使用其动画工具类。
7. `/game` 和 `/svgs` 是没有站内入口的孤立路由；事实已确认，但是否删除仍属于产品取舍。

本报告不把“文件很大”“功能很多”直接判定为冗余。世界时钟、3D 动效、局域网重连、词云词典等只有在决定缩减功能范围后才能大量删除，因此不列入确定性直接删除项。

## 2. 可直接进入整改队列的确定项

### 2.1 完全无引用的源文件

#### `src/lib/color.ts`

- 文件共 209 行。
- 全项目没有 `@/lib/color`、相对 `./color` 或 `../color` 导入。
- 文件内导出的颜色转换函数也没有外部引用。
- 当前背景组件使用的是自己的局部 `hexToRgba`，并未使用该文件。

结论：整个文件是确定的死代码，可以删除。

### 2.2 只声明、全项目零引用的符号

以下符号经全项目单词边界引用扫描后，仅出现于自身声明处：

| 符号 | 位置 | 结论 |
| --- | --- | --- |
| `makeNoise2D` | `src/layout/backgrounds/utils.ts:3` | 约 59 行未使用 Simplex Noise 实现，可删除 |
| `getHolidayStatus` | `src/lib/calendar/festivals.ts:71` | 未使用，可删除 |
| `countRanges` | `src/lib/lan-transfer/storage/ranges.ts:23` | 未使用，可删除 |
| `getFileExt` | `src/lib/utils.ts:8` | 未使用，可删除 |
| `TRANSFER_CODE_LENGTH` | `src/lib/transfer-types.ts:1` | 未使用，可删除 |
| `TransferCreateRequest` | `src/lib/transfer-types.ts:33` | 未使用，可删除 |
| `TransferCompleteRequest` | `src/lib/transfer-types.ts:53` | 未使用，可删除 |
| `TransferOpenRequest` | `src/lib/transfer-types.ts:57` | 未使用，可删除 |

`global.d.ts:16-19` 中以下全局类型也没有实际引用：

- `NullableNumber`
- `NullableObject`
- `NullableArray`
- `Nullable<T>`

结论：这些声明可以直接移除，不需要保留兼容别名。

### 2.3 完全相同的配置文件

以下两个文件在统一换行符并去除首尾空白后，SHA-256 完全相同：

- `src/config/card-styles.json`
- `src/config/card-styles-default.json`

同时，`card-styles-default.json` 没有任何运行时引用，只有 `ARCHITECTURE.md` 提到它。

结论：删除 `card-styles-default.json`，并同步删除架构文档中的对应说明。

### 2.4 首页静态配置 Store 中的无效状态和方法

`src/app/(home)/stores/config-store.ts` 将两个静态 JSON 包装成 Zustand Store，并提供：

- `setSiteContent`
- `setCardStyles`
- `regenerateBubbles`
- `regenerateKey`

引用扫描结果：

- `setSiteContent` 只有声明和实现，没有调用。
- `setCardStyles` 只有声明和实现，没有调用。
- `regenerateBubbles` 只有声明和实现，没有调用。
- `regenerateKey` 初始值为 `0`，没有任何写入路径。
- `regenerateKey` 仅由 `src/layout/index.tsx:42` 读取，再传给背景组件。
- 首页内容实际通过修改仓库 JSON 维护，不存在运行时编辑入口。

结论：

1. 删除三个未使用写入方法和 `regenerateKey` 链路。
2. 进一步可删除整个 `config-store.ts`，改为普通只读配置导出。
3. 如果需要保留统一类型，可建立普通 `home-config.ts`，不需要状态管理库。

这是确定的“静态数据被错误建模为动态状态”。

### 2.5 重复维护视口状态

以下两个文件都读取 `window.innerWidth/innerHeight`、注册 `resize` 并写入 Zustand：

- `src/hooks/use-size.ts`
- `src/hooks/use-center.ts`

两套初始化又同时出现在：

- `src/layout/index.tsx:40-41`

额外冗余：

- `useCenterStore.setCenter` 没有调用。
- `use-center.ts` 的 `width/height/centerX/centerY` 与 `use-size.ts` 的视口来源相同。
- `src/app/pictures/components/random-layout.tsx:367` 又调用一次 `useCenterInit()`；该页面已经位于全局 Layout 下，因此会为同一 Store 再注册一个监听。

结论：合并为单个视口 Store，只在全局 Layout 初始化一次，并删除 `setCenter` 与图片页的重复初始化。

### 2.6 不必要的 Client Component 边界

以下页面自身没有 Hook、浏览器 API 或事件处理，只负责读取 JSON 并渲染子组件：

- `src/app/projects/page.tsx`
- `src/app/pictures/page.tsx`
- `src/app/share/page.tsx`
- `src/app/bloggers/page.tsx`

它们的交互子组件已经单独声明了 `'use client'`，父页面可以保持 Server Component。

结论：删除这四个页面顶部的 `'use client'`。其中 `Picture` 类型应从 `page.tsx` 移到独立类型文件或图片组件模块，避免客户端组件从路由入口反向导入类型。

### 2.7 已安装但没有实际使用的 Tailwind 动画插件

- `package.json` 包含 `tailwindcss-animate`。
- `src/styles/globals.css:5` 注册了 `@plugin 'tailwindcss-animate'`。
- 项目中没有 `animate-in`、`animate-out`、`fade-in`、`slide-in-from-*`、`zoom-in-*` 等插件工具类。
- 当前使用的 `animate-spin` 和 `animate-pulse` 属于 Tailwind 自带能力。

结论：删除 CSS 插件声明、`package.json` 依赖及对应锁文件记录。

## 3. 已确认的重复实现

### 3.1 新闻日期逻辑和类型重复

以下函数体完全相同：

- `src/app/news/[date]/page.tsx:21` 的 `isValidNewsDate`
- `src/lib/news.ts:281` 的 `isValidNewsDate`
- `src/app/news/[date]/page.tsx:30` 的 `formatNewsDate`
- `src/lib/news.ts:380` 的 `formatNewsDate`

`NewsArticle` 类型也同时定义于：

- `src/app/news/[date]/page.tsx:10`
- `src/lib/news.ts:84`

结论：将 `NewsArticle`、日期正则、校验和格式化函数移动到不含服务端依赖的 `news-shared.ts`，服务端与客户端共同引用。

### 3.2 LAN 存储清单构造重复四份

`manifestFor` 出现在：

- `src/lib/lan-transfer/storage/memory-storage.ts:4`
- `src/lib/lan-transfer/storage/indexeddb-storage.ts:21`
- `src/lib/lan-transfer/storage/opfs-storage.ts:35`
- `src/lib/lan-transfer/storage/direct-file-storage.ts:26`

四份实现返回相同的版本、元数据、空 ranges 和初始字节数。函数体仅存在格式/换行差异。

结论：放入 `src/lib/lan-transfer/storage/shared.ts`，四个后端共用。

### 3.3 LAN 缓冲区合并重复

`combineBuffers` 分别位于：

- `src/lib/lan-transfer/storage/direct-file-storage.ts:46`
- `src/lib/lan-transfer/storage/opfs-storage.ts:89`

两者执行相同的总长度计算、分配和顺序复制。

结论：与 `manifestFor` 一并移动到存储公共模块。

### 3.4 LAN 随机 ID 实现重复三份

以下三个函数体完全相同：

- `src/lib/lan-transfer/file-transfer.ts:16` 的 `transferId`
- `src/lib/lan-transfer/native-webrtc-transport.ts:19` 的 `randomId`
- `src/lib/lan-transfer/reconnect-coordinator.ts:24` 的 `randomId`

结论：提取为 LAN 内部公共 `createLanId()`。

### 3.5 Reduced Motion Hook 完全重复

以下函数体完全相同：

- `src/layout/backgrounds/ambient-effect-layer.tsx:37`
- `src/layout/backgrounds/time-atmosphere-background.tsx:51`

项目中的 `motion/react` 已经提供 `useReducedMotion`，`src/components/card.tsx` 也已使用官方 Hook。

结论：删除两份本地实现并统一使用 `motion/react`。

### 3.6 Edge Function 错误压缩函数完全重复

`compactErrorMessage` 在以下位置完全相同：

- `edge-functions/api/transfer/[[default]].js:394`
- `edge-functions/api/transfer/admin.js:17`

结论：移动到公共 Edge 工具模块，或通过现有 `context` 参数传给 admin。

### 3.7 字节数组拼接重复

- `src/lib/transfer-crypto.ts:46` 的 `concatBytes`
- `src/lib/transfer-relay.ts:122` 的 `concatBytes`

两者均计算总长度、创建 `Uint8Array`、按顺序写入。区别仅是一个接收剩余参数，一个接收数组。

结论：保留一个接收 `Iterable<Uint8Array>` 或数组的实现。

### 3.8 `cn` 重复且局部版本能力更弱

- 公共实现：`src/lib/utils.ts:4`，组合 `clsx` 与 `tailwind-merge`。
- 局部实现：`src/app/toolbox/lan-transfer-tool.tsx:27`，只执行 `filter(Boolean).join(' ')`。

结论：LAN 工具直接使用现有公共 `cn`。

### 3.9 `formatBytes` 重复四份

位置：

- `src/lib/lan-transfer/file-transfer.ts:38`
- `src/app/toolbox/compress-tool.tsx:41`
- `src/app/toolbox/transfer-tool.tsx:57`
- `src/app/t/status/status-client.tsx:23`

四份函数负责相同的 B/KB/MB/GB 展示，只在小数位和未知值处理上存在轻微差异。

结论：将展示规则确定为一份公共 `formatBytes`。该函数不应继续放在 LAN 专属模块中。

### 3.10 浏览器下载触发重复

创建临时 `<a>`、设置 `href/download`、插入 DOM、点击、移除的流程至少出现在：

- `src/lib/transfer-relay.ts:132`
- `src/lib/lan-transfer/file-transfer.ts:215`
- `src/lib/face-mask/export-image.ts:88`
- `src/app/toolbox/transfer-tool.tsx:43`
- `src/app/toolbox/markdown-tool.tsx:10`
- `src/app/toolbox/compress-tool.tsx:212`
- `src/app/toolbox/compress-tool.tsx:262`

结论：提供一个很小的 `triggerDownload(url, filename)`。Blob/Object URL 的创建和回收仍由各业务负责，避免公共函数承担过多生命周期逻辑。

### 3.11 Transfer API 地址构造重复

`transferApiBase` 和 `transferApiUrl` 同时定义于：

- `src/app/toolbox/transfer-tool.tsx:29-41`
- `src/app/t/status/status-client.tsx:7-21`

两个页面的 JSON 错误读取也分别实现为 `readTransferApiError` 和 `readStatsError`。

结论：建立轻量 `transfer-api-client.ts`，只包含 Base URL、URL 构造和响应错误读取，不需要建立复杂请求框架。

### 3.12 LAN Controller 类型重复表达

- `src/app/toolbox/use-lan-transfer-controller.ts:256` 已导出 `LanTransferController`。
- `src/app/toolbox/lan-transfer-tool.tsx:24` 又用相同的 `ReturnType<typeof useLanTransferController>` 定义局部 `LanController`。

结论：二选一：复用导出类型，或删除没有外部消费者的导出类型。不要同时保留两种名称。

### 3.13 Three.js 画布 resize 回调完全重复

以下回调函数体完全相同：

- `src/app/(home)/animated-core.tsx:286`
- `src/app/world-clock/world-clock-client.tsx:463`

它们都读取容器尺寸、更新相机宽高比和投影矩阵、调用 `renderer.setSize`，随后建立 `ResizeObserver`。

结论：如继续保留两个 Three.js 场景，可提取一个 `observeThreeViewport(container, camera, renderer)` 小工具，并返回清理函数。

## 4. 已确认的组件内重复流程

### 4.1 压缩工具的单个转换与批量转换

`src/app/toolbox/compress-tool.tsx` 中：

- `handleConvertImage` 位于约 `179-210` 行。
- `handleConvertAll` 位于约 `227-260` 行。

两者重复执行：

1. 调用 `fileToWebp`。
2. 创建 Object URL。
3. 撤销旧 Object URL。
4. 更新指定图片的 `converting/converted` 状态。

单个下载与批量下载也重复创建下载链接。

结论：提取 `convertImageAt(index)` 和公共下载触发，不需要引入任务队列抽象。

### 4.2 Share 与 Bloggers 搜索网格骨架重复

- `src/app/share/grid-view.tsx`
- `src/app/bloggers/grid-view.tsx`

重复内容包括搜索状态、小写文本匹配、输入框样式、三列网格和空结果结构。

结论：共享一个小型 `SearchInput` 或文本过滤 Hook。Share 的标签过滤保留在自身模块中，不建议建立参数很多的通用网格组件。

### 4.3 LAN 桌面与移动设备列表重复

`src/app/toolbox/lan-transfer-tool.tsx` 中：

- `DesktopSidebar` 从约 `577` 行开始。
- `DevicePage` 从约 `710` 行开始。

两者都渲染二维码控制、邀请面板、连接列表、等待连接状态和退出操作。桌面使用 `ConnectionCard`，移动端又内联了一套连接按钮结构。

结论：提取共享 `ConnectionList`，并让 `ConnectionCard` 支持必要的展示变体。不要继续维护两份连接状态文案和头像布局。

### 4.4 多套命令式延迟挂载

以下组件均维护 `show` 状态并通过定时器延迟挂载，同时又使用 Motion 的 `initial/animate`：

- `src/components/card.tsx:31-54`
- `src/app/(home)/social-buttons.tsx:40-70`
- `src/app/(home)/theme-toggle-card.tsx:19-24`
- `src/components/nav-card.tsx:65-79`
- `src/app/pictures/components/random-layout.tsx:94-104`
- `src/app/pictures/components/random-layout.tsx:369-376`

结论：如果需要相同视觉时序，统一使用 Motion `transition.delay`/`staggerChildren`；如果只要求可用，直接渲染。当前“定时后挂载 + Motion 入场”是同一行为的重复表达。

## 5. 事实已确认、删除前仍需确认用途的项目

本节只说明引用事实，不直接把功能判定为死代码。

### 5.1 `/game` 是孤立路由

- `src/app/game/game-client.tsx` 共 1,071 行。
- `src/app/game/page.tsx` 是该功能入口。
- 全项目没有字符串链接、导航项或配置项指向 `/game`。
- 手动输入 URL 仍然可以访问，因此它是“无站内入口”，不是编译死代码。

建议：如果它不是刻意隐藏的小游戏，删除整个 `src/app/game/`。

### 5.2 `/svgs` 是孤立开发工具链

以下内容只形成内部闭环：

- `src/app/svgs/page.tsx`
- `src/svgs/index.ts`
- `scripts/gen-svgs-index.js`
- `package.json` 的 `svg` 命令

`src/svgs/index.ts` 只由 `/svgs` 页面消费，项目没有站内链接指向 `/svgs`。

以下 SVG 没有实际业务组件引用：

- `dots.svg`
- `music.svg`
- `pen.svg`
- `pictures.svg`
- `share-filled.svg`
- `share-outline.svg`

建议：如果不再需要图标调试展厅，整套删除；如果保留展厅，则上述图标不能按“无引用资源”直接删除，因为其中四个仍被生成索引展示。

### 5.3 明确存在的兼容分支

项目说明要求默认不兼容旧数据、旧会话和旧配置，但当前仍有：

- `src/lib/news.ts:16` 与 `src/lib/news.ts:129-135` 的旧 B 站摘要标题兼容处理。
- `src/lib/lan-transfer/signal-client.ts:20` 对 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 的兼容回退。

这些兼容路径确实存在；删除前需要确认当前远端新闻标题和部署环境变量已经使用新格式。确认后应直接删除，不继续保留双路径。

### 5.4 `unique-names-generator` 只服务一个装饰性字符串

- 依赖只在 `src/lib/lan-transfer/signal-client.ts:2` 与 `src/lib/lan-transfer/signal-client.ts:68-70` 使用。
- 用途仅是为设备名增加一个英文形容词。

事实确定，但是否保留属于展示偏好。若接受 `Desktop ABCD`、`Phone ABCD` 形式，可删除依赖并减少客户端依赖体积。

## 6. 文档漂移

`ARCHITECTURE.md` 多处声称以下目录存在但为空：

- `src/app/sitemap.xml`
- `src/app/robots.txt`

当前工作区中两个路径均不存在。

结论：从架构文档删除“目录存在”的说法，改为“尚未实现对应路由”。

## 7. 本轮未判定为确定性冗余的内容

以下内容代码量较大，但静态审查无法证明它们是无用或重复，因此没有放入直接删除队列：

- `src/app/world-clock/world-clock-client.tsx`
- `src/lib/lan-transfer/connection-runtime.ts`
- `src/lib/lan-transfer/reconnect-coordinator.ts`
- `src/app/(home)/animated-core.tsx`
- 两个动态背景组件
- `scripts/generate-word-cloud.cjs` 中的停用词和领域词典
- `src/components/music-player.tsx`
- `src/app/pictures/components/random-layout.tsx` 的拖动、缩放和位置持久化

这些代码主要对应真实功能。要减少它们，需要先明确删减功能范围，不能仅凭文件行数判定为冗余。

本轮也没有发现可以确定删除的顶层自定义 CSS 选择器；已扫描的 `globals.css` 顶层类都能在源代码中找到引用。

## 8. 推荐整改顺序

### 第一批：无行为争议

1. 删除 `src/lib/color.ts`。
2. 删除 `makeNoise2D`、`getHolidayStatus`、`countRanges`、`getFileExt` 和未使用 Transfer 类型/常量。
3. 删除未使用全局 Nullable 类型。
4. 删除重复的 `card-styles-default.json`。
5. 删除 `tailwindcss-animate`。
6. 修正 `ARCHITECTURE.md` 中 sitemap/robots 描述。

### 第二批：保持现有功能的去重

1. 移除首页动态 Config Store，改为只读配置。
2. 合并视口 Store 和 resize 监听。
3. 合并新闻共享类型/日期工具。
4. 合并 LAN 存储工具和随机 ID。
5. 统一 `formatBytes`、下载触发和 Transfer API URL。
6. 删除不必要的页面 Client Component 边界。
7. 合并压缩转换流程、搜索网格骨架和 LAN 连接列表。
8. 统一 Motion 延迟表达。

### 第三批：需要确认用途

1. 决定是否删除 `/game`。
2. 决定是否删除 `/svgs` 工具链及无业务引用图标。
3. 确认部署环境后删除旧 Supabase 环境变量回退。
4. 确认远端新闻标题后删除旧标题兼容逻辑。
5. 决定是否为了装饰性设备名继续保留 `unique-names-generator`。

## 9. 验证说明

- 本报告只进行了只读静态审查。
- 没有运行 `pnpm`、`npm`、构建、测试或 lint 命令。
- 没有修改业务代码、配置、生成产物或图片资源。
- 后续实施时应按批次修改；每批完成后重新做引用扫描，并按实际架构变化同步更新 `ARCHITECTURE.md`。
