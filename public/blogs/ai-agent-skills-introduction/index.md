# AI Agent Skill 详解：把提示词沉淀成可复用工作流

---

AI Agent 的能力正在从“回答问题”走向“执行任务”。当模型可以读文件、改代码、调用工具、生成文档、操作浏览器时，真正影响结果质量的，往往不只是模型本身，而是它有没有掌握一套稳定的工作方法。

Skill 就是为这个问题设计的：把某类任务的经验、约束、脚本、模板和参考资料，整理成 agent 可以自动发现、按需加载、重复使用的能力包。

这篇文章面向已经使用过 ChatGPT、Codex、Claude Code、Cursor 或其他 AI 编程工具的开发者。我们会从 `SKILL.md` 文件讲起，介绍 Skill 的结构、触发方式、和 Prompt / MCP / Plugin 的区别，以及在团队中落地时需要注意的安全边界。

![AI Agent Skill 封面图](/blogs/ai-agent-skills-introduction/cover.png)

## 1. 为什么需要 Skill

直接写 Prompt 可以解决一次问题，但很难沉淀长期能力。

例如，开发团队经常会遇到这些场景：

1. 写技术博客时，要遵守固定结构、语气和引用规范；
2. 做代码审查时，要先看风险、行为回归和测试缺口；
3. 修改前端页面时，要保持现有设计系统和响应式布局；
4. 处理 Word、Excel、PPT、PDF 时，要使用固定脚本和视觉验收流程；
5. 发布 PR 时，要按团队模板生成描述、提交 commit、创建草稿 PR；
6. 接入内部系统时，要知道哪些 API、凭据和权限边界不能碰。

如果每次都把这些要求完整复制进对话，成本很高，也容易漏掉。更麻烦的是，不同成员写出来的 Prompt 风格不同，同一个 agent 在不同会话里的行为也会不稳定。

Skill 的价值在于把这些“重复出现的专业流程”变成一个可维护的目录。Agent 不需要一开始读完整内容，只需要先知道有哪些 Skill，以及每个 Skill 适合什么任务。当用户请求匹配某个 Skill 时，agent 再读取详细说明并执行对应流程。

OpenAI 在 ChatGPT Skills 文档中把 Skill 定义为可复用、可分享的工作流，用来让 ChatGPT 更一致地完成某类任务，并且可以包含说明、示例和代码。OpenAI 也说明 Skills 可用于 ChatGPT、Codex 和 API，并遵循 Agent Skills 开放标准，但不同产品之间目前不会自动同步。

---

## 2. Skill 不是更长的 Prompt

很多人第一次看到 Skill，会把它理解成“把系统提示词写进一个 Markdown 文件”。这个理解不够准确。

Prompt 通常是一次性的上下文指令。Skill 更像一个可安装的工作流包，它可以包含：

| 组成部分 | 作用 |
|---|---|
| `SKILL.md` | Skill 的入口文件，声明名称、触发描述和主要工作步骤。 |
| `scripts/` | 可复用脚本，用来处理稳定、机械、容易出错的任务。 |
| `references/` | 大段参考资料，例如 API 说明、模板规范、术语表。 |
| `assets/` | 模板、图片、示例文件、配置片段等静态资源。 |
| 其他文件 | 由具体平台或团队定义的辅助文件。 |

也就是说，Skill 不是把所有知识一次性塞给模型，而是给 agent 一个结构化入口：先判断是否需要，再加载必要部分。

一个最小 Skill 通常长这样：

```markdown
---
name: technical-blog-writing
description: Writes developer-focused technical blog posts with clear structure, runnable examples, trade-off analysis, and source citations. Use when creating engineering blogs, tutorials, deep dives, or developer documentation.
---

Title: Technical Blog Writing

Section: Workflow

1. Identify the target reader.
2. State assumptions and prerequisites.
3. Start with a short TL;DR.
4. Explain the problem before the solution.
5. Include runnable examples when code is needed.
6. Discuss trade-offs and limitations.
7. End with further reading.
```

这段内容最关键的不是标题，而是 `description`。它决定 agent 在什么场景下应该启用这个 Skill。

---

## 3. SKILL.md 的基本结构

Agent Skills 开放规范要求 Skill 至少包含一个 `SKILL.md` 文件。这个文件由两部分组成：

1. YAML frontmatter：机器可读的元信息；
2. Markdown 正文：agent 激活 Skill 后读取的操作说明。

典型结构如下：

```text
my-skill/
├── SKILL.md
├── scripts/
│   └── build-report.js
├── references/
│   └── style-guide.md
└── assets/
    └── template.docx
```

`SKILL.md` 的 frontmatter 通常包含：

| 字段 | 说明 |
|---|---|
| `name` | Skill 名称，应该短、稳定、便于识别。 |
| `description` | 触发描述，告诉 agent 什么时候使用这个 Skill。 |
| `allowed-tools` | 某些实现中用于限制 Skill 可调用的工具。 |
| 其他字段 | 由平台、插件或团队规范扩展。 |

不同平台对字段支持不完全一致，所以写 Skill 时要把 `name` 和 `description` 当作最重要的兼容层，把平台特有字段当作增强能力。

---

## 4. 渐进式加载：Skill 的核心设计

Skill 的核心机制是 progressive disclosure，可以理解为“渐进式加载”或“按需披露”。

如果一个 agent 安装了几十个 Skill，它不可能把所有 Skill 的完整内容都塞进上下文。那样不仅浪费 token，还会让模型被无关规则干扰。

更合理的流程是：

1. Agent 启动时，只加载所有 Skill 的 `name` 和 `description`；
2. 用户提出任务；
3. Agent 根据任务内容判断是否匹配某个 Skill；
4. 如果匹配，再读取该 Skill 的 `SKILL.md` 正文；
5. 如果正文引用了脚本、模板或参考资料，再按需读取对应文件；
6. Agent 根据 Skill 的流程完成任务。

可以把它理解为一个分层索引：

```text
用户任务
  ↓
Skill description 路由
  ↓
SKILL.md 工作流
  ↓
references / scripts / assets
  ↓
执行结果
```

这种设计的好处是明显的：Skill 可以装很多，但上下文只加载相关内容。对 agent 来说，`description` 就像路由规则，`SKILL.md` 就像任务说明书，脚本和资源文件则是执行细节。

---

## 5. Skill、Prompt、MCP、Plugin 有什么区别

AI agent 生态里有很多容易混用的概念。它们并不是互相替代，而是负责不同层次的问题。

| 机制 | 主要作用 | 适合场景 |
|---|---|---|
| Prompt | 当前对话中的一次性指令 | 临时任务、探索性问题、一次性约束。 |
| Custom Instructions | 长期偏好 | 语气、默认输出格式、个人习惯。 |
| Skill | 可复用任务流程 | 写作规范、代码审查、文档生成、团队 SOP。 |
| MCP | 连接外部工具和数据源 | GitHub、数据库、浏览器、Slack、内部系统。 |
| Plugin | 打包多个能力 | 分发 Skill、工具、连接器、命令或子代理能力。 |

一个实际例子是：

1. Prompt 说：“帮我写一篇关于 AI Skill 的文章”；
2. Skill 规定：“技术文章必须有 TL;DR、表格、示例、权衡和参考资料”；
3. MCP 负责：“去 GitHub、文档站或内部知识库读取资料”；
4. Plugin 负责：“把写作 Skill、搜索工具和发布流程打包在一起”。

Skill 的定位不是替代工具，而是告诉 agent 如何正确使用工具、如何组织步骤、如何判断输出是否符合预期。

---

## 6. 一个好 Skill 的关键：写好 description

Skill 是否会被正确触发，很大程度取决于 `description`。

差的描述：

```yaml
description: Helps with writing.
```

这个描述太泛。Agent 很难判断它是写博客、写小说、写邮件，还是写代码注释。

更好的描述：

```yaml
description: Writes developer-focused technical blog posts with clear structure, runnable code examples, trade-off analysis, and source citations. Use when creating engineering blogs, tutorials, deep dives, or developer documentation.
```

好的 `description` 通常包含三类信息：

| 信息 | 示例 |
|---|---|
| 能做什么 | 写开发者技术博客、生成 API 文档、审查 PR。 |
| 什么时候用 | 当用户要求教程、deep dive、架构文章、工程复盘时。 |
| 输出标准 | 包含代码示例、引用来源、风险分析、固定模板。 |

不要只写“这个 Skill 很强”。Agent 需要的是可判断的触发条件，而不是宣传语。

---

## 7. 正文应该写什么

`SKILL.md` 正文不是越长越好。它应该回答一个问题：当 agent 已经决定使用这个 Skill 时，它下一步应该怎么做？

建议包含这些内容：

| 内容 | 说明 |
|---|---|
| 工作流 | 用编号步骤描述执行顺序。 |
| 输出格式 | 明确最终结果是 Markdown、JSON、代码补丁、文档文件还是 PR 描述。 |
| 质量标准 | 例如代码必须可运行、引用必须可追溯、文章必须讨论限制。 |
| 常见错误 | 提醒 agent 避免团队已经踩过的坑。 |
| 工具选择 | 告诉 agent 优先使用哪些脚本、命令或本地资源。 |
| 参考文件 | 指向 `references/` 中的大段资料。 |

例如技术博客 Skill 可以这样组织：

```markdown
Title: Technical Blog Writing

Section: Audience

Write for developers. Assume they care about concrete implementation details, trade-offs, and sources.

Section: Workflow

1. Identify the article type: tutorial, deep dive, postmortem, benchmark, or architecture.
2. State the assumed reader level.
3. Put the main takeaway near the top.
4. Use runnable code examples when code is involved.
5. Explain trade-offs and limitations.
6. Add further reading with official sources when possible.

Section: Avoid

- Marketing tone.
- Unsupported claims.
- Long generic introductions.
- Code snippets without context.
```

这样的正文短，但对 agent 很有用。它把“好文章”的判断标准变成了可执行规则。

---

## 8. 什么时候应该放脚本

Skill 可以只包含 Markdown，但真正稳定的 Skill 往往会包含脚本。

原因很简单：有些事情让模型每次临时生成命令或代码并不可靠。比如：

1. 解析复杂文件格式；
2. 批量重命名和生成清单；
3. 把 Markdown 渲染成图片；
4. 对 Excel 或 PPT 做结构化检查；
5. 从固定模板生成配置文件；
6. 运行一段已经验证过的数据转换流程。

把这些操作放进 `scripts/`，agent 只需要知道“什么时候调用哪个脚本”，而不是每次都重新发明实现。

示例：

```text
report-skill/
├── SKILL.md
├── scripts/
│   └── render-report.js
└── assets/
    └── report-template.html
```

`SKILL.md` 可以写：

```markdown
When the user asks for a PDF report, first fill `assets/report-template.html`,
then run `scripts/render-report.js` to generate the final artifact.
```

这样做的好处是，模型负责理解任务和填充内容，脚本负责稳定执行机械步骤。

---

## 9. 什么时候应该拆出 references

如果某个 Skill 的背景资料很长，不建议全部写进 `SKILL.md`。

例如：

1. 公司完整写作规范；
2. 设计系统组件说明；
3. API 参数表；
4. 安全审查清单；
5. 发布流程细则；
6. 大量示例和反例。

这些内容应该放进 `references/`，然后在 `SKILL.md` 中给出明确引用：

```markdown
For detailed API constraints, read `references/api-contract.md`.
For tone and formatting rules, read `references/style-guide.md`.
```

这符合渐进式加载原则。Agent 只有在任务需要时才读取大文档，不会在简单任务里浪费上下文。

---

## 10. Skill 在 Codex 里的价值

对 Codex 这类 coding agent 来说，Skill 的价值尤其直接。

编程任务通常不是单步问题，而是一个完整链路：

1. 理解需求；
2. 搜索代码；
3. 找到已有模式；
4. 修改文件；
5. 避免覆盖用户改动；
6. 运行必要验证；
7. 总结修改；
8. 需要时提交、推送、开 PR。

这些步骤里有大量团队偏好和项目约束。比如某个项目明确规定：修改完成后不要主动运行 `pnpm run build` 或 `npm test`，除非用户要求。这个规则不属于模型通用知识，但它对当前项目非常重要。

如果把这些规则写进项目级说明或 Skill，Codex 就可以在每次任务中自动遵守。Skill 的价值不是让模型“更聪明”，而是让它更贴近当前团队的工作方式。

常见 Codex Skill 可以包括：

| Skill | 用途 |
|---|---|
| frontend-app-builder | 构建前端应用，遵守视觉和交互标准。 |
| frontend-testing-debugging | 用浏览器验证本地页面、排查控制台错误。 |
| react-best-practices | 审查 React / Next.js 性能和组件模式。 |
| github:yeet | 提交本地修改、推送分支、创建草稿 PR。 |
| technical-blog-writing | 按开发者写作规范生成技术文章。 |

这些 Skill 让 agent 不必每次从零判断“应该怎么做”，而是复用已经沉淀好的工程流程。

---

## 11. 团队如何设计自己的 Skill

团队落地 Skill 时，建议从高频、重复、标准明确的任务开始。

优先选择这些场景：

1. 每周都会发生；
2. 输出格式相对固定；
3. 团队已有明确规范；
4. 新成员容易遗漏细节；
5. 出错会造成返工；
6. 可以通过示例判断质量。

不适合一开始就做成 Skill 的场景：

1. 需求高度开放；
2. 团队还没有形成共识；
3. 每次判断都依赖强上下文；
4. 无法描述清楚验收标准；
5. 涉及高权限操作但还没有安全策略。

一个实用的设计流程是：

1. 先收集团队最常复制粘贴的 Prompt；
2. 把其中稳定的规则提炼到 `SKILL.md`；
3. 把长文档移到 `references/`；
4. 把机械操作沉淀到 `scripts/`；
5. 用 3 到 5 个真实任务测试触发是否准确；
6. 根据误触发和漏触发调整 `description`；
7. 把 Skill 纳入代码审查和版本管理。

Skill 不应该一次写到完美。它更像内部工具库，需要在真实任务中迭代。

---

## 12. 去哪里查找和安装 Skill

Skill 生态已经开始出现专门的目录、市场和管理工具。查找 Skill 时，不建议只看安装量，还要看来源、更新时间、说明是否清楚、是否包含脚本，以及脚本是否安全。

下面是当前比较值得关注的入口：

| 站点 / 工具 | 定位 | 适合怎么用 |
|---|---|---|
| [skills.sh](https://skills.sh/) | Open Agent Skills Ecosystem，提供排行榜和 `npx skills add <owner/repo>` 安装方式。 | 查热门 Skill、看 GitHub 来源、快速安装开源 Skill。 |
| [skills.sh docs](https://skills.sh/docs) | skills CLI 的文档，说明安装、排行榜和匿名安装统计。 | 学习命令行安装方式，并理解排行榜数据来源。 |
| [SkillKit](https://skillkit.io/) | Agent Skills Directory，按分类、热门、最近更新、支持 agent 浏览。 | 按 Claude Code、Cursor、Gemini CLI、Codex 等 agent 查找可用 Skill。 |
| [SkillsGate](https://skillsgate.ai/) | 面向 AI agent 的可视化 Skill 管理器，公共 Skill 搜索由 skills.sh 支持。 | 希望用桌面应用或 TUI 管理多个 agent 的 Skill 时使用。 |
| [SkillPad](https://skillpad.dev/) | skills.sh 的桌面 GUI，可以浏览、安装和管理全局 / 项目级 Skill。 | 不想手写命令，希望用可视化方式安装 Skill。 |
| [Agensi](https://www.agensi.io/) | 基于 `SKILL.md` 标准的 Skill 市场，包含免费和付费 Skill，并强调安全扫描。 | 查找社区和商业 Skill，或者发布自己的 Skill。 |
| GitHub 搜索 | 直接搜索 `SKILL.md`、`anthropics/skills`、`vercel-labs/agent-skills` 等仓库。 | 审查源码、fork 定制、把 Skill 纳入团队版本管理。 |

这些站点的定位不同。`skills.sh` 更像开放索引和安装入口，SkillKit 更像目录和排行榜，SkillsGate / SkillPad 更偏本地管理工具，Agensi 更偏市场化分发。实际使用时，最好先从目录发现，再回到 GitHub 或下载包里审查 `SKILL.md`、`scripts/` 和 `references/`。

安装第三方 Skill 前，建议至少做三件事：

1. 先读 `SKILL.md`，确认它不会要求 agent 忽略安全规则；
2. 检查 `scripts/`，尤其是下载远程脚本、读取密钥、上传文件这类行为；
3. 优先安装到项目级或实验环境，不要一开始就给生产仓库和敏感凭据权限。

---

## 13. Skill 的安全风险

Skill 越有用，安全风险也越高。

原因在于 Skill 可以影响 agent 的行为：它可以告诉 agent 读哪些文件、运行哪些脚本、访问哪些外部服务、如何处理用户输入。如果 Skill 来源不可信，它就可能变成提示注入、敏感信息泄露或恶意脚本执行的入口。

风险主要来自几个方面：

| 风险 | 说明 |
|---|---|
| 恶意指令 | `SKILL.md` 里隐藏让 agent 忽略安全规则、读取密钥、上传文件的指令。 |
| 恶意脚本 | `scripts/` 中包含下载远程代码、删除文件、窃取环境变量的逻辑。 |
| 供应链污染 | 从不可信仓库安装 Skill，或者依赖被替换。 |
| 权限过宽 | Skill 可以调用过多工具，导致影响范围超过任务需要。 |
| 资料投毒 | `references/` 中混入错误规范或隐藏提示注入。 |

安全公司 Snyk 在 ToxicSkills 研究中分析了公开 Skill 生态中的恶意样本，指出其中存在恶意 payload、prompt injection、暴露凭据和可疑下载等问题。具体样本和数量会随时间变化，但结论很清楚：Skill 应该按供应链资产对待。

团队使用 Skill 时，建议至少做到：

1. 只安装可信来源的 Skill；
2. 安装前审查 `SKILL.md`、脚本和引用文件；
3. 避免让第三方 Skill 默认接触生产凭据；
4. 对脚本运行权限做最小化控制；
5. 把 Skill 放进版本管理；
6. 共享 Skill 需要 code review；
7. 定期检查是否存在异常网络请求、下载脚本或敏感路径读取。

一句话：Skill 不是普通 Markdown，它是会影响 agent 行为的执行资产。

---

## 14. 一个 Skill 质量检查清单

写完 Skill 后，可以用下面的清单快速检查：

| 检查项 | 判断标准 |
|---|---|
| 名称是否稳定 | `name` 不应该频繁变化。 |
| 描述是否具体 | `description` 是否包含任务类型和触发场景。 |
| 是否容易误触发 | 描述是否过宽，导致无关任务也会启用。 |
| 是否容易漏触发 | 描述是否缺少常见关键词。 |
| 正文是否可执行 | Agent 读完后是否知道下一步做什么。 |
| 是否过长 | 大段资料是否拆到了 `references/`。 |
| 脚本是否必要 | 稳定机械任务是否用脚本替代临时生成。 |
| 输出是否明确 | 最终结果格式是否清楚。 |
| 安全边界是否清楚 | 是否说明哪些文件、命令或凭据不能碰。 |
| 是否经过真实任务验证 | 是否用实际场景测试过触发和结果。 |

如果一个 Skill 只能描述“理念”，但不能指导 agent 完成任务，它更适合作为文档；如果它能稳定改变 agent 的执行方式，才真正发挥了 Skill 的作用。

---

## 15. 常见误区

### 15.1 把 Skill 写成大而全的知识库

Skill 不是百科全书。`SKILL.md` 应该保持短小、明确、可执行。长资料可以拆到 `references/`。

### 15.2 只写流程，不写触发条件

Agent 首先看到的是 `description`。如果触发描述写不好，再完整的流程也可能不会被使用。

### 15.3 用 Skill 替代权限控制

Skill 可以提醒 agent 不要做某些事，但不能替代系统级权限、沙箱和审批。真正危险的操作仍然需要工具层限制。

### 15.4 每个小偏好都做成 Skill

Skill 适合任务级流程，不适合承载所有个人偏好。语气、默认语言、回答长度这类偏好更适合放在全局说明里。

### 15.5 不做版本管理

团队 Skill 会影响所有成员和 agent 行为，必须像代码一样管理版本、审查 diff、记录变更原因。

---

## 16. 未来趋势

Skill 的出现说明 AI agent 正在进入一个新的阶段：模型能力不再是唯一变量，组织知识如何被封装、分发、调用和审计，会变得同样重要。

过去团队会维护：

1. 脚手架；
2. 代码模板；
3. CI 配置；
4. 内部 SDK；
5. 文档规范；
6. 发布流程；
7. 安全清单。

未来团队很可能还会维护一套 Skill 仓库。它们不是给人直接阅读的普通文档，而是给 agent 使用的任务能力包。

一个成熟团队的 Skill 仓库可能包含：

| 分类 | 示例 |
|---|---|
| 工程流程 | PR 审查、CI 修复、发布检查、迁移脚本。 |
| 内容生产 | 技术博客、产品文档、周报、演示文稿。 |
| 数据处理 | Excel 清洗、PDF 提取、图表生成。 |
| 前端体验 | 视觉 QA、响应式检查、设计系统规则。 |
| 安全合规 | 密钥检查、依赖审计、权限边界说明。 |
| 内部系统 | 公司 API、服务目录、监控排障流程。 |

这会让 agent 从“通用助手”逐渐变成“理解团队工作方式的协作者”。

---

## 17. 总结

AI Agent Skill 的核心价值可以概括为一句话：

> 把可重复的专业工作，变成 agent 能自动发现、按需加载、稳定执行的能力包。

它比 Prompt 更持久，比普通文档更可执行，比插件更轻量，也比单纯工具调用更懂流程。

对个人开发者来说，Skill 可以沉淀自己的工作习惯；对团队来说，Skill 可以统一工程规范；对企业来说，Skill 是把组织知识交给 AI agent 使用的一种可治理形式。

但 Skill 也必须被认真对待。它会影响 agent 行为，可能调用脚本和读取资料，因此需要审查、权限控制和版本管理。

如果你正在频繁复制同一段 Prompt，或者经常提醒 agent 遵守同一套流程，那就说明这件事值得做成一个 Skill。

---

## 参考资料

1. [OpenAI Help Center: Skills in ChatGPT](https://help.openai.com/en/articles/20001066)
2. [OpenAI Codex](https://openai.com/codex/)
3. [Agent Skills Overview](https://agentskills.io/home)
4. [Agent Skills Specification](https://agentskills.io/specification)
5. [Claude Skills overview](https://claude.com/docs/skills/overview)
6. [Claude Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
7. [Snyk: ToxicSkills research](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/)
8. [skills.sh: The Agent Skills Directory](https://skills.sh/)
9. [skills.sh Documentation](https://skills.sh/docs)
10. [SkillKit: Agent Skills Directory](https://skillkit.io/)
11. [SkillsGate](https://skillsgate.ai/)
12. [SkillPad](https://skillpad.dev/)
13. [Agensi: AI Agent Skill Marketplace](https://www.agensi.io/)
