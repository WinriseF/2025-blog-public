# RAG 开源方案选型：社区项目给我们的工程启发

---

前面几篇文章主要从 RAG 的基础流程、开发链路、文档切分、检索优化和生产化治理来讲。那些内容需要官方文档和论文打底，但如果只看官方资料，会少掉一个关键视角：真实项目到底怎么把这些模块拼成系统。

RAG 不是一种产品形态，也不是一个固定框架。社区里已经出现了很多方向不同的开源项目：有的偏低代码应用平台，有的偏复杂文档理解，有的偏本地私有化，有的偏 Python 管道编排，有的专门做评测和自动调参，也有的只是把大量高级技巧整理成 notebook。

本文假设你已经理解 RAG 的基本流程：文档摄取、Chunk、Embedding、检索、Rerank、Prompt 组装、生成和引用。如果还没有这些基础，建议先看这个系列前几篇，再回来看本文。

**TL;DR：** 选 RAG 开源项目时，不要先问“哪个 Star 多”。先判断你要的是应用平台、RAG 引擎、开发框架、私有化产品、评测工具，还是技巧实验库。Dify 适合快速搭 LLM 应用和工作流，RAGFlow 适合复杂文档理解和可追溯引用，RAG-Anything / LightRAG 适合研究多模态和图谱增强 RAG，AnythingLLM 和 PrivateGPT 适合本地与私有化，Haystack / LlamaIndex 适合工程定制，Quivr 适合嵌入产品的 opinionated RAG core，AutoRAG 适合用评测数据选 pipeline。

---

## 1. 先把“选型”这个问题拆开

很多团队第一次做 RAG，会把选型问题简化成：

1. 用哪个向量数据库；
2. 用哪个 Embedding 模型；
3. 用哪个 RAG 框架；
4. 要不要上开源平台。

这个拆法不够。真实 RAG 系统至少有三层选型：

| 层次 | 你真正要决定什么 | 典型问题 |
|---|---|---|
| 交付形态 | 这是一个内部应用、产品能力、后端服务，还是研究实验？ | 是否需要 UI？是否需要多租户？是否要开放 API？ |
| 数据链路 | 文档怎么进来、怎么切、怎么检索、怎么引用？ | PDF 是否复杂？表格和图片多不多？是否需要实时同步？ |
| 治理体系 | 生产后怎么评测、权限控制、监控、调参和升级？ | 是否有评测集？是否有权限过滤？是否能回滚和追踪？ |

开源项目的价值，不是给我们一个标准答案，而是暴露不同团队对这三层问题的取舍。

例如：

1. Dify 主要回答“怎样快速把 LLM 应用交付给业务”；
2. RAGFlow 主要回答“复杂文档如何解析、切分、可视化和溯源”；
3. RAG-Anything 主要回答“多模态文档怎么从解析走到跨模态检索”；
4. AnythingLLM 主要回答“个人和团队如何低门槛使用本地知识库”；
5. PrivateGPT 主要回答“离线和私有化场景如何提供 RAG API”；
6. Haystack 和 LlamaIndex 主要回答“开发者如何自由组合 pipeline”；
7. Quivr 主要回答“怎样把 opinionated RAG core 嵌入产品”；
8. AutoRAG 主要回答“如何用评测数据选择 pipeline”；
9. RAG_Techniques 主要回答“有哪些高级 RAG 技巧可以做实验”。

所以本文不做排行榜。我们按工程选型方式拆解：每个项目解决什么问题、架构大概是什么、突出的能力在哪里、适合什么场景、不适合什么场景。

---

## 2. 一张项目地图

先给一个总览。后面每个项目会展开讲。

| 项目 | 更像什么 | 架构主线 | 最突出的能力 | 主要代价 |
|---|---|---|---|---|
| Dify | LLM 应用平台 | Web 控制台 + 后端 API + Workflow + 知识库 + 模型管理 + LLMOps | 快速搭应用、可视化工作流、多模型、多角色协作 | 深度检索逻辑需要接受平台抽象，复杂权限仍要工程治理 |
| RAGFlow | 文档理解优先的 RAG 引擎 | DeepDoc / 解析引擎 + Dataset + Chunk 模板 + 检索/Rerank + 引用 + Web/API | 复杂 PDF、表格、扫描件、Chunk 可视化、可追溯引用 | 资源要求和部署复杂度更高 |
| RAG-Anything | 多模态 RAG 框架 | 文档解析器 + 模态处理器 + 多模态知识图谱 + LightRAG 检索 | 图片、表格、公式、Office、跨模态关系 | 依赖解析器、VLM 和多模态链路，工程门槛高 |
| LightRAG | 图谱增强 RAG Core | 文档插入 + 实体/关系抽取 + 图存储 + 向量检索 + 混合查询 | 图谱增强、双层检索、WebUI/API、可嵌入研究 | 对 LLM、Embedding、存储一致性要求高 |
| AnythingLLM | 本地优先 AI 应用 | Frontend + Server + Collector + Vector DB + LLM Provider + Agent/MCP | 桌面/自托管、低门槛、本地资料问答、多模型 | 深度业务集成和强权限体系要二次开发 |
| PrivateGPT | 私有化 RAG API | FastAPI + LlamaIndex + 高低层 API + 本地模型/向量库 | 离线、OpenAI API 风格、RAG primitives | 产品 UI 和工作流能力不是重点 |
| Haystack | Python AI 编排框架 | Component + Pipeline + Retriever + Generator + Agent + Evaluation | 显式 pipeline、可测试、可替换、生产友好 | 需要工程团队写代码和维护组件 |
| LlamaIndex | 数据框架和 RAG 工具箱 | Connector + Index + Retriever + Query Engine + Agent/Workflow | 数据接入、索引、检索抽象、生态集成多 | 抽象丰富，选错层级容易写出难维护代码 |
| Quivr | Opinionated RAG Core | Brain + File Ingestion + YAML Workflow + Retriever/Reranker/Generator | 快速嵌入产品、Megaparse、工作流配置 | 适合跟随其架构，极深定制要评估边界 |
| AutoRAG | RAG AutoML / 评测优化工具 | QA/Corpus 数据集 + 模块搜索 + 指标评测 + Dashboard + 部署 | 用数据选 Chunk、检索、Prompt、Generator | 前提是你愿意先建设评测集 |
| RAG_Techniques | 技巧实验库 | Notebook + Runnable scripts + 技术分类 | 快速理解 HyDE、Rerank、GraphRAG、RAPTOR 等方法 | 不是生产框架，不能直接照搬 |

这张表有一个重点：这些项目不是同一赛道。

把 Dify 和 AutoRAG 比“谁更好”没有意义。前者是应用平台，后者是评测优化工具。把 RAGFlow 和 Haystack 比也容易误判，前者更重产品化文档理解，后者更重代码层 pipeline 组合。

---

## 3. 选型前先问 8 个问题

在看项目之前，先用这 8 个问题把自己的需求说清楚。

### 3.1 你要交付的是 UI 产品还是后端能力

如果最终用户要自己上传文件、管理知识库、配置模型、查看引用，Dify、RAGFlow、AnythingLLM 这类带完整 UI 的项目更值得看。

如果你只是要把 RAG 嵌入现有业务系统，Haystack、LlamaIndex、Quivr core、PrivateGPT API 这类更容易作为后端能力集成。

### 3.2 文档复杂度有多高

纯 Markdown、TXT、网页内容，简单 pipeline 就能起步。制度 PDF、合同、扫描件、财务报表、PPT、Excel、论文公式、图表，属于另一类问题。

文档越复杂，越应该优先看 RAGFlow、RAG-Anything、LlamaParse / LlamaIndex、Quivr + Megaparse 这类强调文档摄取质量的方案。

### 3.3 是否要求本地和离线

如果资料不能出内网，首先看 PrivateGPT、AnythingLLM、LightRAG 这类本地部署友好的方案。Dify、RAGFlow 也能自托管，但要检查模型、Embedding、OCR、对象存储、日志和遥测是否都符合内网要求。

### 3.4 是否需要业务人员参与配置

如果业务人员需要调整知识库、工作流、Prompt 或应用发布，低代码平台更合适。只给开发者一个 Python 框架，业务团队通常很难持续参与。

### 3.5 是否需要强定制

强定制包括：

1. 权限过滤接入业务系统；
2. 检索阶段混合多个数据源；
3. 自定义 Chunk 和 Rerank；
4. 检索结果需要经过业务规则重排；
5. 答案要写回工单、CRM、ERP；
6. 需要严格审计。

这些场景更适合代码框架或后端 API，而不是完全依赖可视化平台。

### 3.6 是否已有评测集

没有评测集时，选型经常变成“谁的 Demo 看起来更好”。这很危险。AutoRAG 的价值就在于提醒我们：RAG pipeline 不是凭感觉选的，而是用 QA dataset 和 corpus dataset 评测出来的。

### 3.7 是否需要 Agent 和工具调用

现在很多 RAG 项目都在往 Agent 方向走。Dify 有 workflow 和 agent，AnythingLLM 有 Agent 和 MCP，RAGFlow 也在把 RAG 作为 context layer 给 agent 使用。

如果业务问题不是“一问一答”，而是“查资料、调用工具、执行任务、写回系统”，选型时要把 Agent 编排也纳入考虑。

### 3.8 团队技术栈是什么

Python 团队自然更容易接受 Haystack、LlamaIndex、AutoRAG、LightRAG、PrivateGPT。前端/Node 团队可能更容易改 AnythingLLM。Java 团队可以用 Spring AI + pgvector 搭主系统，再借鉴这些项目的架构，不一定要直接引入 Python 框架。

---

## 4. Dify：适合从“应用交付”切入

Dify 的定位是开源 LLM 应用开发平台。它把 AI workflow、RAG pipeline、agent、模型管理、Prompt IDE、观测和 API 能力放在一个产品里。

这类项目的重点不是“它的检索算法是否最先进”，而是“它能不能让一个团队快速把 LLM 应用做出来、交付出去、持续运营”。

### 4.1 架构形态

可以把 Dify 理解成下面几层：

```text
业务用户 / 运营 / 开发者
        |
        v
Web 控制台：应用、工作流、知识库、Prompt、模型、日志
        |
        v
后端 API：应用运行、对话、工作流执行、文件/知识库管理
        |
        +--> Workflow / Agent 编排
        +--> RAG Pipeline / Dataset / Retrieval
        +--> Model Provider 抽象
        +--> LLMOps / 日志 / 标注 / 观测
        |
        v
数据库 / 对象存储 / 向量索引 / 外部模型服务 / 外部工具
```

它的核心价值在“平台层”：

1. 用可视化方式创建应用；
2. 用 workflow 把模型、检索、条件判断、工具调用串起来；
3. 用知识库能力管理文档和检索；
4. 用模型管理适配不同提供商；
5. 用 API 把应用嵌入业务系统；
6. 用日志、标注和观测持续改进应用。

### 4.2 选 Dify 的理由

Dify 适合这些场景：

1. 企业内部想快速铺开多个 AI 应用；
2. 不希望每个应用都从零写后端和前端；
3. 业务、产品、运营也要参与配置；
4. 应用不只是 RAG，还包含流程编排、工具调用、Prompt 管理；
5. 团队希望先验证价值，再决定是否自研底层。

典型例子：

1. 内部制度问答；
2. 客服知识库助手；
3. 营销文案工作流；
4. 招投标资料问答；
5. 面向业务部门的低代码 AI 应用市场。

### 4.3 Dify 的突出点

**第一，Dify 把 RAG 放在应用平台里，而不是孤立成检索库。**

很多团队会把 RAG 做成一个 `/ask` 接口，后来才发现业务还需要工作流、权限、模型切换、日志、标注、灰度和 API 发布。Dify 的产品结构提醒我们：RAG 只是 LLM 应用的一部分，真正交付时还需要应用生命周期。

**第二，Workflow 是关键抽象。**

企业里的 RAG 问题经常不是“检索后回答”这么简单。更常见的是：

```text
用户问题
  -> 判断问题类型
  -> 查知识库
  -> 调用业务系统
  -> 根据权限过滤
  -> 生成答案
  -> 写入工单
  -> 记录日志和反馈
```

这种链路如果全写在后端代码里，会很快变硬。Dify 的 workflow 说明了一个趋势：RAG 应用需要可视化编排层。

**第三，模型管理不是附属功能。**

生产系统要面对多个模型提供商、多个环境、不同成本和不同稳定性。把模型调用散落在业务代码里，后期切换成本很高。Dify 把模型作为平台能力暴露出来，这一点值得借鉴。

### 4.4 Dify 的边界

Dify 不适合所有场景。

如果你需要非常深的检索定制，例如：

1. 自定义召回融合策略；
2. 用业务规则重排；
3. 检索阶段接入复杂权限系统；
4. 对每个行业文档定制解析器；
5. 在索引层做特殊数据结构；
6. 对延迟、成本、召回率做精细实验；

那么 Dify 可以作为原型和应用层，但底层检索服务可能仍然要自研，或者通过外部知识库/API 方式接入。

### 4.5 选型建议

选择 Dify 的判断标准：

| 问题 | 如果答案是“是”，Dify 更合适 |
|---|---|
| 是否需要业务人员自己搭应用？ | 是 |
| 是否需要多个 AI 应用共用一个平台？ | 是 |
| 是否需要工作流而不只是问答？ | 是 |
| 是否接受平台抽象带来的边界？ | 是 |
| 是否还没有稳定评测集，想先快速验证？ | 是 |

如果目标是做“企业 AI 应用平台”，Dify 值得重点研究。如果目标是做一个高度定制的检索服务，Dify 更适合作为应用层参考，而不是底层唯一方案。

---

## 5. RAGFlow：复杂文档理解是它的主线

RAGFlow 的定位是开源 RAG 引擎，重点放在 deep document understanding、模板化 Chunk、Chunk 可视化、人类干预、引用溯源、多格式数据源和自动化 RAG 工作流。

它解决的是一个很具体的问题：企业文档通常不是干净文本。

### 5.1 为什么 RAGFlow 值得看

很多 RAG Demo 用 Markdown 或 TXT 做资料源，所以看起来很简单：

```text
读取文本 -> 按字符切分 -> Embedding -> 向量检索 -> 回答
```

但真实企业资料经常是：

1. 扫描 PDF；
2. 双栏论文；
3. 财务报表；
4. 表格跨页；
5. 带页眉页脚的制度文件；
6. PPT 里图文混排；
7. Word 里有标题、批注、编号；
8. 图片里有关键说明；
9. 同一份资料有多个版本。

这些文档如果解析不好，后面的 Embedding、Rerank、Prompt 都救不回来。RAGFlow 的价值就在于把“文档摄取质量”放到了系统中心。

### 5.2 架构形态

RAGFlow 可以按下面方式理解：

```text
文件 / 网页 / 结构化数据 / 外部数据源
        |
        v
DeepDoc / 文档解析
        |
        v
模板化 Chunk / 可视化 Chunk / 人工检查
        |
        v
索引层：全文检索 + 向量检索 + 元数据
        |
        v
多路召回 / Rerank / 引用定位
        |
        v
Chat / Agent / API / Web UI
```

部署上，它不是一个轻量脚本。RAGFlow 的自托管依赖 Docker Compose，包含后端服务、前端、文档引擎、对象存储、数据库、Redis 等组件。README 中也明确给出了较高的机器要求。这说明它的目标不是“十行代码跑 RAG”，而是“把 RAG 做成可运营的复杂文档系统”。

### 5.3 突出能力

**第一，Deep document understanding。**

RAGFlow 强调从复杂格式非结构化数据中抽取知识。这个方向非常关键，因为 RAG 的质量上限经常由文档解析决定。

如果解析阶段把表格拆坏、标题丢掉、页脚混入正文、公式识别错，后面的检索会出现三个问题：

1. 查不到正确 Chunk；
2. 查到的 Chunk 缺上下文；
3. 生成答案引用不到原文。

**第二，Template-based chunking。**

不同文档类型需要不同切分策略。制度文件、合同、论文、问答知识库、表格报表不应该共用同一个字符长度切分器。

模板化 Chunk 的意义在于：

1. 把文档结构纳入切分；
2. 让切分策略可解释；
3. 让业务人员能理解系统为什么这么切；
4. 为后续评测和调参提供稳定入口。

**第三，Chunk 可视化和人类干预。**

很多自研 RAG 系统失败，是因为没有人能看见“系统到底切成了什么”。用户只看到答案错了，工程师只能猜问题出在解析、切分、检索还是生成。

Chunk 可视化能把排查链路前移：

```text
答案错了
  -> 看引用是否正确
  -> 看检索 Chunk 是否正确
  -> 看 Chunk 是否切坏
  -> 看原文解析是否错
```

这比只看模型输出有效得多。

**第四，引用溯源。**

RAGFlow 强调 traceable citations。企业场景里，引用不是装饰，而是可信度和审计能力。

没有引用的 RAG 回答，很难用于制度、合同、财务、法务、医疗等场景。即使答案看起来对，用户也需要知道依据在哪里。

### 5.4 适合什么场景

RAGFlow 优先适合：

1. PDF 和 Office 文档很多；
2. 文档版式复杂；
3. 表格、图片、扫描件多；
4. 需要引用定位；
5. 需要业务人员检查 Chunk；
6. 团队愿意部署完整系统；
7. 项目重点是“文档知识库质量”，而不是单纯模型调用。

### 5.5 不适合什么场景

如果你的数据主要来自结构化数据库、API、干净 Markdown，RAGFlow 可能偏重。

如果只是做一个小型内部 Demo，部署完整 RAGFlow 也可能超过需求。此时可以先用 LlamaIndex、Haystack、Spring AI 或简单自研 pipeline 起步，但要把文档解析问题作为后续风险。

### 5.6 选型建议

如果你的 RAG 系统第一天就要处理合同、制度 PDF、报表和扫描件，RAGFlow 值得优先评估。

评估时重点看：

1. 你的文档格式是否能被稳定解析；
2. Chunk 可视化是否能帮助业务人员验收；
3. 引用能否精确回到原文；
4. 检索和 Rerank 是否能满足你的问答集；
5. 部署资源和维护成本是否可接受。

---

## 6. RAG-Anything 和 LightRAG：从文本 RAG 走向多模态和图谱增强

RAG-Anything 是 HKUDS 开源的 All-in-One Multimodal RAG Framework，构建在 LightRAG 之上。LightRAG 本身强调简单、快速的检索增强生成，并通过知识图谱增强检索；RAG-Anything 则把处理对象扩展到图片、表格、公式、Office 文档和复杂混合内容。

这组项目适合一起看，因为它们代表了 RAG 的另一条演进路线：不再把文档等同于纯文本。

### 6.1 LightRAG 的架构主线

LightRAG 不只是“向量库 + Prompt”。它强调把文档中的实体和关系抽取出来，构建图结构，再结合向量检索做查询。

可以这样理解：

```text
文档
  -> 文本切分
  -> LLM 抽取实体和关系
  -> 写入图存储 / KV / 向量存储
  -> 查询时结合局部实体、全局关系和语义向量
  -> 生成答案并返回上下文
```

这种路线适合回答普通向量检索不擅长的问题：

1. 多跳关系；
2. 全局总结；
3. 跨段落关联；
4. 实体之间的依赖；
5. 需要从局部事实扩展到全局结构的问题。

LightRAG 也提供 WebUI 和 API server，并支持多种存储后端、Reranker、评测和 tracing 集成。它更像一个可以嵌入研究和工程系统的 RAG core，而不是面向普通业务用户的低代码平台。

### 6.2 RAG-Anything 的架构主线

RAG-Anything 在 LightRAG 之上处理多模态文档。它的主线大致是：

```text
PDF / Office / 图片 / Markdown / TXT
        |
        v
Parser：MinerU / Docling / PaddleOCR / 外部 content_list
        |
        v
Modal processors：文本、图片、表格、公式、通用内容
        |
        v
多模态实体和跨模态关系
        |
        v
LightRAG：向量 + 图关系 + 混合检索
        |
        v
Text query / multimodal query / VLM-enhanced query
```

它的关键不是“把图片 OCR 成文字”，而是把文档里的不同模态拆成不同对象，并保留它们之间的关系。

例如一篇论文可能包含：

1. 正文段落；
2. Figure 1 架构图；
3. Table 2 实验结果；
4. 公式；
5. 图注和表注；
6. 正文里对图表的引用。

如果全部压平成纯文本，会丢掉很多关系。RAG-Anything 试图通过专门处理器和多模态知识图谱保留这些关系。

### 6.3 RAG-Anything 的突出点

**第一，专门处理不同模态。**

图片、表格、公式不是同一种数据。图片需要视觉理解，表格需要结构化理解，公式需要符号和语义解释，正文需要语言理解。

把它们统一塞进一个 Chunk 字段，通常会出问题。

**第二，支持外部 content list。**

RAG-Anything 支持直接插入外部已经解析好的 content list。这一点很工程化，因为企业可能已经有自己的解析链路，例如：

1. 自研 OCR；
2. 文档中台；
3. 版面分析服务；
4. 表格抽取系统；
5. 离线批处理流程。

如果 RAG 框架只支持自己解析文件，就很难接入已有系统。content list 让解析层和检索层可以解耦。

**第三，VLM-enhanced query。**

当检索结果包含图片或图表时，单纯把 OCR 文本交给 LLM 并不够。VLM 可以直接参与视觉内容理解，这对图表问答、论文图解、报表截图很重要。

**第四，和 LightRAG 结合。**

多模态文档里的关系很多。正文、表格、图片、公式之间天然适合建图。RAG-Anything 和 LightRAG 结合后，方向不只是“多模态检索”，还包括“跨模态关系检索”。

### 6.4 适合什么场景

RAG-Anything / LightRAG 适合：

1. 论文、技术报告、标准文档；
2. 财报、研报、PPT、Excel 和图表混合资料；
3. 公式、表格、图片是答案核心来源；
4. 需要研究多模态 RAG；
5. 需要图谱增强检索；
6. 团队能接受更高的模型和解析成本。

### 6.5 不适合什么场景

如果资料是干净文本，不需要多模态和图关系，直接上这套会增加复杂度。

多模态 RAG 的成本包括：

1. 解析器依赖；
2. VLM 调用成本；
3. 图片和表格存储；
4. content list 格式治理；
5. 检索评测更复杂；
6. UI 需要能展示非文本引用。

### 6.6 选型建议

如果你只是做常规知识库问答，不要因为“多模态”听起来先进就优先上 RAG-Anything。

如果你的问题经常长这样：

1. “图 3 的架构和正文描述有什么区别？”
2. “表 2 里哪个模型在召回率上最好？”
3. “这份财报图表说明了什么趋势？”
4. “这个公式里的变量在后文如何使用？”

那么传统文本 RAG 很可能不够，RAG-Anything / LightRAG 的架构值得认真评估。

---

## 7. AnythingLLM：本地优先的完整 AI 应用

AnythingLLM 是一个偏产品化的开源 AI 应用。它强调本地运行、文档问答、Agent、多用户、多模型、多向量库、拖拽上传、source citations、MCP 和开发者 API。

它的价值在于“低门槛使用”和“产品完整性”。

### 7.1 架构形态

AnythingLLM 的 monorepo 大致可以拆成：

```text
frontend：React / Vite 前端
server：Node.js / Express 后端，处理 LLM、向量库、工作区和 API
collector：文档采集和解析服务
embed：嵌入式聊天组件
browser-extension：浏览器扩展
docker：部署和构建配置
```

这说明它不是一个 Python RAG 算法库，而是一个完整产品。它把用户体验、文件上传、模型配置、向量库管理、聊天、引用展示和部署包装在一起。

### 7.2 突出能力

**第一，本地优先。**

很多用户不是要搭一个企业 AI 平台，而是想“在自己的电脑或服务器上和文档对话”。AnythingLLM 对这类用户非常友好。

**第二，多模型和多向量库。**

AnythingLLM 支持多种 LLM provider、Embedding provider 和 vector database。它把“模型可替换”作为产品能力，而不是把用户绑定到单一模型。

**第三，Agent 和 MCP。**

AnythingLLM 已经不只是文档问答。Agent、工具、MCP、定时任务、嵌入式聊天组件，说明它在往“本地 AI 工作台”方向走。

**第四，多用户。**

个人工具和团队工具的分界点通常是多用户、权限和审计。AnythingLLM 在 Docker 版本里提供多用户和权限能力，这对团队使用很关键。

### 7.3 适合什么场景

AnythingLLM 适合：

1. 个人或小团队快速搭本地知识库；
2. 不想从零部署复杂平台；
3. 想用本地模型、Ollama、LM Studio 或多个云模型；
4. 希望有桌面应用或简单自托管；
5. 需要 source citations；
6. 需要基础 Agent 和工具能力。

### 7.4 不适合什么场景

如果你要做严格的企业级权限、复杂多租户、跨系统数据同步、审计合规和精细检索调参，AnythingLLM 可能需要比较多二次开发。

它更像一个完整应用，而不是底层框架。你可以用它快速交付体验，但如果要嵌入复杂业务系统，要评估后端扩展边界。

### 7.5 选型建议

当需求是“给团队一个能用的私有知识库和 AI 工作台”，AnythingLLM 是很好的候选。

当需求是“构建企业级 RAG 中台”，AnythingLLM 更适合作为产品形态参考，而不是直接替代检索服务和权限体系。

---

## 8. PrivateGPT：离线和 API primitives 优先

PrivateGPT 的定位很明确：在数据不离开执行环境的前提下，提供文档问答和 RAG API 能力。

它不是一个重低代码平台，而是更偏 API 和 primitives。

### 8.1 架构形态

PrivateGPT 的 README 把 API 分成两类：

1. 高层 API：文档摄取、解析、切分、元数据、Embedding、存储、检索、Chat / Completions；
2. 低层 API：Embedding 生成、上下文 Chunk 检索等基础能力。

架构上可以这样理解：

```text
Client / Gradio UI / 业务系统
        |
        v
FastAPI：OpenAI API 风格接口
        |
        +--> 高层 RAG API：ingest / chat / completions
        +--> 低层 primitives：embeddings / chunks retrieval
        |
        v
LlamaIndex 抽象：LLM / Embedding / VectorStore
        |
        v
本地模型 / 本地向量库 / 文档存储
```

它的关键架构决策包括：

1. FastAPI；
2. OpenAI API 风格；
3. 基于 LlamaIndex；
4. Dependency Injection；
5. 尽量少加自定义抽象；
6. 可替换 LLM、Embedding、VectorStore。

### 8.2 突出能力

**第一，隐私边界清晰。**

PrivateGPT 的核心承诺是数据不离开执行环境。这对金融、医疗、政务、法律、制造等场景很重要。

**第二，API primitives。**

它不是只给一个聊天 UI，而是给 API。这样更容易嵌进已有系统。

例如你可以让业务系统：

1. 调用 ingestion API 导入资料；
2. 调用 retrieval API 只拿候选 Chunk；
3. 调用 chat/completions API 得到最终答案；
4. 在自己的前端展示引用和权限信息。

**第三，高低层 API 同时存在。**

高层 API 适合快速接入，低层 API 适合高级用户重写 pipeline。这比只提供黑盒 `/chat` 接口更灵活。

### 8.3 适合什么场景

PrivateGPT 适合：

1. 内网和离线；
2. 受监管行业；
3. 想提供 OpenAI 风格兼容接口；
4. 需要把 RAG 能力嵌入现有系统；
5. 更重 API 而不是可视化工作流；
6. 希望基于 LlamaIndex 生态扩展。

### 8.4 不适合什么场景

如果业务人员需要自己搭 workflow、配置应用、发布聊天机器人，PrivateGPT 不是首选。

它也不是专门解决复杂版式文档解析的项目。如果你的核心难点是扫描 PDF、表格和图表，要额外评估解析层。

### 8.5 选型建议

如果你的第一需求是“数据不能出内网，并且我要一个 API 层”，PrivateGPT 值得看。

如果你的第一需求是“给业务部门做可视化应用平台”，优先看 Dify、RAGFlow 或 AnythingLLM。

---

## 9. Haystack 和 LlamaIndex：开发者框架的两种典型路线

Haystack 和 LlamaIndex 都是开发者框架，但它们的气质不同。

Haystack 更强调显式 pipeline、组件化、生产可控和 AI orchestration。LlamaIndex 更强调数据连接器、索引、检索/query engine、agentic 应用和丰富生态。

### 9.1 Haystack：显式 pipeline 和工程控制

Haystack 的核心是组件和 pipeline。你把 Retriever、Ranker、Prompt Builder、Generator、Router、Memory、Tool 等节点组合起来，构成一个可测试、可替换、可部署的系统。

可以这样理解：

```text
Document Store / Vector DB / Search Engine
        |
        v
Retriever
        |
        v
Ranker / Filter / Router
        |
        v
Prompt Builder
        |
        v
Generator
        |
        v
Answer + Metadata + Trace
```

Haystack 的突出点：

1. Pipeline 显式；
2. Component 可替换；
3. Vendor-agnostic；
4. 适合写测试；
5. 适合构建后端服务；
6. 可以扩展到 agent workflow；
7. 生态里有 Hayhooks，可把 pipeline 暴露成 REST API 或 MCP server。

### 9.2 LlamaIndex：数据接入和索引抽象丰富

LlamaIndex 的核心问题是：如何把私有数据接入 LLM 应用。

它提供：

1. 数据连接器；
2. 文档加载；
3. 索引结构；
4. Retriever；
5. Query Engine；
6. Reranker；
7. Agent 和 workflow；
8. 大量模型、Embedding、向量库集成；
9. LlamaParse 等文档解析生态。

典型使用方式是：

```text
Data Connectors
        |
        v
Documents / Nodes
        |
        v
Index / VectorStore / Graph / Summary
        |
        v
Retriever / Query Engine
        |
        v
LLM Response
```

LlamaIndex 的优势是生态广、抽象多、上手快。代价是新手容易在高层 API 和低层自定义之间摇摆，最后写出不清晰的系统边界。

### 9.3 怎么在 Haystack 和 LlamaIndex 之间选

| 需求 | 更倾向 |
|---|---|
| 想显式控制每个 pipeline 节点 | Haystack |
| 想快速接入各种数据源和索引抽象 | LlamaIndex |
| 更看重生产组件、路由、编排和可测试性 | Haystack |
| 更看重数据连接器、query engine、快速实验 | LlamaIndex |
| 团队喜欢 declarative pipeline / component graph | Haystack |
| 团队喜欢从高层 API 快速起步再下钻 | LlamaIndex |

两者不是互斥关系。很多团队会用 LlamaIndex 做数据摄取和索引实验，用 Haystack 或自研服务承载生产 pipeline，也有人反过来。关键是不要把框架当成最终架构，而要明确自己的系统边界。

### 9.4 选型建议

如果你是 Python 团队，并且要构建自己的 RAG 后端，Haystack 和 LlamaIndex 至少要各做一个小型 PoC。

PoC 不要只问“能不能回答”。要测这些：

1. 文档摄取是否稳定；
2. 自定义 Chunk 是否方便；
3. 权限过滤能不能放在检索阶段；
4. 是否能替换向量库和模型；
5. 是否能记录检索过程；
6. 是否能写单元测试和回归测试；
7. 是否能部署成你需要的服务形态。

---

## 10. Quivr：opinionated RAG core 和产品集成

Quivr 的定位是 full-stack RAG 平台和核心 RAG engine。它强调 opinionated RAG、任意 LLM、任意文件、自定义 RAG、Megaparse 集成，以及让开发者专注自己的产品。

### 10.1 架构形态

Quivr core 的关键抽象是 Brain。它把文件摄取、向量化、检索和问答包装成比较直接的开发体验。

同时，它支持用 YAML 配置 basic RAG workflow，例如：

```text
START
  -> filter_history
  -> rewrite
  -> retrieve
  -> generate_rag
  -> END
```

这个 workflow 形态很重要，因为它说明一个成熟 RAG 问答并不只有 retrieve 和 generate：

1. 多轮历史要过滤；
2. 查询可能要改写；
3. 检索后可能要 Rerank；
4. Prompt 和生成参数要配置；
5. 不同场景可能需要不同 workflow。

### 10.2 突出能力

**第一，opinionated。**

很多团队不想成为 RAG 专家，只想把一个靠谱的 RAG core 嵌进产品。Quivr 的思路就是替你做一部分默认选择。

这和 Haystack / LlamaIndex 不一样。框架给你很多组件，Quivr 更像给你一个可以直接用的组装方案。

**第二，Megaparse。**

Quivr 强调和 Megaparse 集成，说明它也把文档摄取质量看成核心问题。这个趋势和 RAGFlow、RAG-Anything 一致。

**第三，YAML workflow。**

把 RAG workflow 配置化，有助于在不同场景之间切换策略。例如客服问答、合同问答、研发文档问答可能需要不同 history、rewrite、rerank 和生成配置。

### 10.3 适合什么场景

Quivr 适合：

1. 想快速把 RAG 嵌入现有产品；
2. 不想从零设计完整 pipeline；
3. 接受 opinionated RAG core；
4. 需要文件摄取；
5. 想通过配置切换工作流；
6. Python 技术栈可以接受。

### 10.4 不适合什么场景

如果你需要把每一个检索细节都拆开自定义，Quivr 可能不如 Haystack / LlamaIndex 自由。

如果你要的是一个面向业务人员的低代码平台，Dify 或 RAGFlow 更贴近。

### 10.5 选型建议

Quivr 的价值在“不要让我重新造一个 RAG core”。如果你的团队目标是产品集成，而不是研究每个模块，Quivr 值得试。

评估时重点看：

1. Brain 抽象是否适合你的业务；
2. YAML workflow 是否能表达你的检索链路；
3. 文件解析质量是否足够；
4. 你能否接受它的默认架构。

---

## 11. AutoRAG：用评测数据选 pipeline

AutoRAG 的观点非常务实：RAG pipeline 很多，但你不知道哪个最适合自己的数据和用例，所以应该自动评测不同模块组合。

这解决的是 RAG 项目里最常见的问题之一：调参靠感觉。

### 11.1 AutoRAG 的架构主线

AutoRAG 的流程可以拆成两段：数据创建和 pipeline 优化。

```text
原始文档
  -> Parsing
  -> Chunking
  -> QA dataset / Corpus dataset
  -> 配置候选模块
  -> 批量运行试验
  -> 指标评测
  -> Dashboard 分析
  -> 导出最佳 pipeline
  -> 代码/API/Web 部署
```

它要求你准备两类数据：

1. QA dataset；
2. Corpus dataset。

这一步很关键。没有测试集，就没有真正意义上的优化。

### 11.2 它能比较什么

AutoRAG 可以把 RAG pipeline 拆成节点和模块，例如：

1. parsing；
2. chunking；
3. lexical retrieval；
4. semantic retrieval；
5. hybrid retrieval；
6. prompt maker；
7. generator；
8. metrics strategy。

然后通过配置尝试不同组合。

例如你可以比较：

1. PDF 解析方法；
2. chunk size；
3. chunk overlap；
4. BM25；
5. 向量检索；
6. Hybrid RRF；
7. top_k；
8. prompt 模板；
9. generator 模型。

### 11.3 突出能力

**第一，把 RAG 变成实验系统。**

很多 RAG 系统上线后，优化方式是：

1. 用户说不好；
2. 工程师调 chunk size；
3. 再调 top_k；
4. 再换 embedding；
5. 再加 rerank；
6. 凭感觉判断效果。

AutoRAG 的方式更可靠：把候选方案跑一遍，用指标和测试集比较。

**第二，数据创建和优化都覆盖。**

评测集很难准备，AutoRAG 提供 QA 创建和 corpus 处理流程，这对从零起步的团队有帮助。

**第三，结果能部署。**

评测不是为了报告好看，而是要回到生产 pipeline。AutoRAG 支持从 trial folder 运行最佳 pipeline，也支持 API 和 Web 方式部署。

### 11.4 适合什么场景

AutoRAG 适合：

1. 已经有一批真实文档；
2. 需要比较多种 Chunk 和检索策略；
3. 质量目标比交付速度更重要；
4. 团队愿意建设评测集；
5. 希望形成持续回归机制；
6. 不想靠主观感觉调参。

### 11.5 不适合什么场景

如果你还没有稳定数据，也没有时间建设 QA dataset，AutoRAG 的价值发挥不出来。

如果只是做一个一天内的 Demo，先用 Dify、AnythingLLM、LlamaIndex 快速搭起来即可。等问题变成“如何系统提升质量”，再引入 AutoRAG 或类似评测体系。

### 11.6 选型建议

AutoRAG 更像研发和评测工具，不一定是线上主链路。

一种更稳的用法是：

1. 线上系统用 Dify、RAGFlow、Haystack、LlamaIndex 或自研服务；
2. 离线用 AutoRAG 做 pipeline 评测；
3. 把最佳配置迁移回线上系统；
4. 每次文档结构、模型、检索策略变化后重新评测。

---

## 12. RAG_Techniques：技巧库不是生产框架，但很适合补课

RAG_Techniques 是一个高级 RAG 技术集合，包含大量 notebook 和 runnable scripts。它覆盖基础 RAG、CSV RAG、Chunk size 优化、Proposition Chunking、Query Transformations、HyDE、Contextual Compression、Fusion Retrieval、Reranking、Hierarchical Indices、GraphRAG、RAPTOR、Self-RAG、Corrective RAG、评测等方向。

这类项目的价值不在“直接部署”，而在“理解方法”。

### 12.1 它适合解决什么问题

当你已经有一个基础 RAG，但效果不好时，常见问题包括：

1. 用户问题太短；
2. 查询和文档表达方式差异大；
3. Top K 里噪声太多；
4. 大文档只靠平铺 Chunk 查不准；
5. 多跳问题答不好；
6. 检索失败后没有纠错；
7. 系统不知道什么时候不该检索；
8. 评测指标不清楚。

RAG_Techniques 里的技巧正好对应这些问题。

### 12.2 技巧如何映射到工程问题

| 技术方向 | 解决的问题 | 工程注意点 |
|---|---|---|
| Query Transformation | 用户问题短、模糊、口语化 | 要记录原问题和改写问题，避免改写引入错误 |
| HyDE | 查询和文档语义空间不匹配 | 会增加一次生成成本，适合召回困难场景 |
| Contextual Chunk Headers | Chunk 缺少标题和层级上下文 | 入库时要保留文档结构 |
| Fusion Retrieval | 单一路召回不稳定 | 需要去重和分数归一 |
| Reranking | Top K 噪声多 | 增加延迟和成本，要做阈值评估 |
| Hierarchical Indices | 大文档先粗后细检索 | 需要维护摘要层和细节层映射 |
| GraphRAG | 多跳关系和全局总结 | 建图成本高，适合关系密集数据 |
| RAPTOR | 大语料递归总结和树状检索 | 摘要质量会影响最终答案 |
| Self-RAG / Corrective RAG | 检索自检和纠错 | 链路更长，需要严格超时和成本控制 |

### 12.3 不要直接把 notebook 搬进生产

Notebook 适合学习和验证，不适合直接进入生产。生产系统还要处理：

1. 权限过滤；
2. 多租户；
3. 错误重试；
4. 幂等入库；
5. 指标监控；
6. 日志和 trace；
7. 缓存；
8. 成本控制；
9. 数据删除；
10. 灰度发布。

正确用法是：先用 notebook 理解方法，再把方法改造成可测试、可配置、可观测的服务模块。

---

## 13. 场景化选型建议

下面按常见场景给出更具体的选型建议。

### 13.1 快速做企业内部知识库

优先看：

1. Dify；
2. RAGFlow；
3. AnythingLLM。

选择逻辑：

| 条件 | 建议 |
|---|---|
| 业务人员要自己配置应用和工作流 | Dify |
| 文档复杂，PDF、表格、扫描件多 | RAGFlow |
| 团队想本地快速搭一个可用产品 | AnythingLLM |
| 需要深度接入现有权限系统 | 平台 + 自研检索服务 |

不要一开始就追求复杂 GraphRAG。先把文档解析、权限过滤、引用和反馈做好。

### 13.2 做复杂文档问答

优先看：

1. RAGFlow；
2. RAG-Anything；
3. LlamaIndex / LlamaParse；
4. Quivr + Megaparse。

选择逻辑：

| 文档类型 | 建议 |
|---|---|
| 普通 PDF 和 Office | RAGFlow / LlamaIndex |
| 扫描件和复杂版式 | RAGFlow，重点测解析质量 |
| 图表、公式、论文 | RAG-Anything |
| 产品内嵌文件问答 | Quivr |

评估时一定要拿真实文档测试，不要用 README Demo 判断。

### 13.3 做本地私有化助手

优先看：

1. PrivateGPT；
2. AnythingLLM；
3. LightRAG。

选择逻辑：

| 需求 | 建议 |
|---|---|
| 要完整应用和 UI | AnythingLLM |
| 要 API primitives | PrivateGPT |
| 要图谱增强和本地研究 | LightRAG |
| 企业强合规 | 重点检查模型、日志、遥测、外部依赖 |

私有化不是把服务部署到内网就结束。还要确认：

1. Embedding 是否本地；
2. reranker 是否本地；
3. OCR 是否本地；
4. 是否有外部遥测；
5. 日志是否包含原文；
6. 模型缓存和文档存储是否可控。

### 13.4 做可控的后端 RAG 服务

优先看：

1. Haystack；
2. LlamaIndex；
3. PrivateGPT；
4. 自研 + pgvector / Qdrant / Elasticsearch。

选择逻辑：

| 需求 | 建议 |
|---|---|
| Pipeline 要显式、可测试 | Haystack |
| 数据连接器和索引生态要丰富 | LlamaIndex |
| 需要 OpenAI API 风格 | PrivateGPT |
| Java 技术栈 | Spring AI + pgvector，同时借鉴这些项目 |

后端服务要把这几个接口设计清楚：

1. ingest；
2. delete / update；
3. search；
4. ask；
5. feedback；
6. evaluation；
7. admin / stats。

### 13.5 做 RAG 质量优化

优先看：

1. AutoRAG；
2. RAG_Techniques；
3. Ragas；
4. TruLens；
5. LangSmith / LlamaIndex evaluation。

选择逻辑：

| 当前阶段 | 建议 |
|---|---|
| 不知道问题出在哪里 | 先建日志和人工标注 |
| 有 QA dataset | 用 AutoRAG 跑候选 pipeline |
| 想理解某个高级技巧 | 看 RAG_Techniques |
| 要长期回归 | 建评测集 + 指标 + dashboard |

质量优化的顺序不要反：

1. 先看解析；
2. 再看 Chunk；
3. 再看召回；
4. 再看 Rerank；
5. 再看 Prompt；
6. 最后才看更复杂的 Agent。

### 13.6 做多模态文档 RAG

优先看：

1. RAG-Anything；
2. LightRAG；
3. RAGFlow；
4. LlamaParse / LlamaIndex；
5. RAG_Techniques 的多模态 notebook。

多模态 RAG 的关键问题是：

1. 图片怎么存；
2. 表格怎么结构化；
3. 公式怎么表示；
4. 图表和正文的关系怎么保留；
5. 查询时是否需要 VLM；
6. 引用如何展示非文本内容；
7. 评测集如何覆盖图表和公式问题。

如果这些问题没有答案，系统很容易退化成“把所有东西 OCR 成文本”，效果有限。

---

## 14. 一个更实用的选型矩阵

可以用下面矩阵给候选项目打分。不要追求绝对客观，关键是让团队讨论有结构。

| 维度 | 权重建议 | 为什么重要 |
|---|---:|---|
| 文档解析质量 | 20% | RAG 上限经常由入库决定 |
| 检索可控性 | 15% | 是否能调 Chunk、召回、Rerank、过滤 |
| 权限和数据边界 | 15% | 企业场景的硬约束 |
| 集成成本 | 15% | 能否接入现有系统和技术栈 |
| 评测和可观测 | 15% | 没有评测就无法持续优化 |
| 用户体验 | 10% | 是否有可用 UI、引用、反馈入口 |
| 运维复杂度 | 10% | 部署、升级、资源和故障排查成本 |

示例：

| 场景 | 文档解析 | 检索可控 | 权限边界 | 集成成本 | 评测观测 | 用户体验 | 运维复杂 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Dify 做内部 AI 应用平台 | 中 | 中 | 中 | 高 | 中 | 高 | 中 |
| RAGFlow 做复杂文档知识库 | 高 | 中高 | 中 | 中 | 中 | 高 | 较高 |
| Haystack 做后端 RAG 服务 | 取决于组件 | 高 | 高 | 中 | 高 | 低 | 中 |
| PrivateGPT 做内网 API | 中 | 中 | 高 | 高 | 中 | 中 | 中 |
| AutoRAG 做离线优化 | 不直接决定 | 高 | 不直接决定 | 中 | 高 | 低 | 中 |

这张表不要机械套用。真正评估时，要把你的业务约束写成验收问题。

例如复杂文档知识库的验收问题可以是：

1. 100 份真实 PDF 中，有多少能正确识别标题层级；
2. 表格跨页时是否能保留结构；
3. 图片和图注能否绑定；
4. 问答结果是否能定位到页码和原文；
5. 用户无权限的文档是否在检索阶段被过滤；
6. 删除文档后索引是否同步删除；
7. rerank 后延迟是否可接受。

---

## 15. 从这些项目里抽象出的共同架构

综合这些项目，可以看到成熟 RAG 系统逐渐形成一套共同架构。

```text
数据源
  -> 连接器 / 文件上传 / 同步任务
  -> 解析器：PDF / Office / HTML / OCR / 表格 / 图片
  -> 清洗和结构化：标题、段落、表格、图注、页码、权限
  -> Chunk 策略：固定、语义、标题层级、Parent-Child、表格专项
  -> 索引：向量、全文、图谱、元数据
  -> 检索：向量、BM25、Hybrid、Graph、Router
  -> Rerank / Filter / Deduplicate
  -> Prompt / Context assembly
  -> LLM / VLM / Tool
  -> 答案、引用、反馈、日志
  -> 评测、调参、监控、回归
```

这个结构比“向量数据库 + Prompt”复杂得多，但也更接近真实系统。

### 15.1 文档摄取正在成为核心竞争力

RAGFlow、RAG-Anything、Quivr、LlamaParse 都在强调解析。原因很简单：模型越来越强后，瓶颈更容易暴露在数据侧。

工程上要把文档摄取当成一等模块：

1. 支持多解析器；
2. 保存原文位置；
3. 保存标题层级；
4. 保存页码和来源；
5. 支持重跑解析；
6. 支持人工检查；
7. 支持解析质量指标。

### 15.2 Chunk 不再只是长度问题

成熟系统不会只问 chunk size 多大。它会问：

1. Chunk 是否保留标题；
2. 表格是否作为整体；
3. 图片和图注是否绑定；
4. 父子 Chunk 是否需要；
5. 是否需要摘要层；
6. 是否需要按权限切分；
7. 是否需要按版本管理。

### 15.3 检索正在走向多路融合

单纯向量检索很容易遇到召回不稳的问题。社区项目普遍开始支持：

1. BM25；
2. 向量检索；
3. hybrid search；
4. RRF；
5. metadata filtering；
6. graph retrieval；
7. reranker；
8. query rewrite。

这说明生产 RAG 应该把 Retriever 设计成可组合模块，而不是写死一个相似度查询。

### 15.4 引用是产品能力，不是 UI 装饰

RAGFlow、AnythingLLM、Dify、PrivateGPT 都强调 source 或 citation。引用的价值包括：

1. 用户信任；
2. 错误排查；
3. 审计；
4. 权限验证；
5. 反馈闭环；
6. 评测样本构造。

引用要尽量精确到页码、段落、表格或图片，而不是只给文件名。

### 15.5 评测会变成 RAG 的日常工作

AutoRAG、RAG_Techniques、Ragas、TruLens 代表了一个方向：RAG 需要持续评测。

生产系统至少要记录：

1. query；
2. rewritten query；
3. retrieved chunks；
4. rerank scores；
5. final context；
6. answer；
7. citations；
8. latency；
9. token cost；
10. user feedback。

没有这些数据，就无法知道应该优化解析、检索、Rerank 还是 Prompt。

---

## 16. 不同团队的落地路线

### 16.1 小团队快速验证路线

适合目标：先证明业务价值。

建议路线：

1. 用 Dify 或 AnythingLLM 搭一个可用 Demo；
2. 用真实文档，不要只用示例资料；
3. 记录用户问题和错误案例；
4. 把高频失败样本整理成 QA dataset；
5. 再决定是否换 RAGFlow、Haystack、自研或 AutoRAG。

这条路线的关键是快，但不要把 Demo 当生产系统。

### 16.2 企业复杂文档路线

适合目标：制度、合同、报表、扫描件、知识库治理。

建议路线：

1. 用 RAGFlow / RAG-Anything / LlamaParse 做文档解析 PoC；
2. 先评估解析和 Chunk，不急着看最终回答；
3. 设计权限字段和元数据；
4. 做引用展示；
5. 构建评测集；
6. 再选择检索和生成框架。

这条路线的关键是不要轻视入库。

### 16.3 后端服务路线

适合目标：把 RAG 嵌入已有业务系统。

建议路线：

1. 用 Haystack 或 LlamaIndex 搭 pipeline；
2. 用 PrivateGPT 或自研 API 提供接口；
3. 接入业务权限系统；
4. 检索阶段做权限过滤；
5. 记录 trace；
6. 离线用 AutoRAG 做 pipeline 实验。

这条路线的关键是服务边界清楚。

### 16.4 研究和算法路线

适合目标：探索 GraphRAG、多模态、Rerank、Self-RAG、Corrective RAG。

建议路线：

1. 先用 RAG_Techniques 理解方法；
2. 用 LightRAG / RAG-Anything 做图谱和多模态实验；
3. 用 AutoRAG 或自建评测集比较；
4. 把有效方法改造成生产组件。

这条路线的关键是不要把实验代码直接上线。

---

## 17. 最容易踩的选型坑

### 17.1 用平台替代架构判断

低代码平台能加速交付，但不能替代架构判断。权限、数据生命周期、评测、日志和成本仍然要自己负责。

### 17.2 用 Star 数替代 PoC

Star 只能说明社区关注度，不能说明它适合你的文档、权限和系统。

真正有价值的 PoC 应该使用：

1. 真实文档；
2. 真实问题；
3. 真实权限；
4. 真实延迟目标；
5. 真实部署环境。

### 17.3 忽略删除和更新

很多 Demo 只做新增文档。生产系统必须处理：

1. 文档更新；
2. 文档删除；
3. 版本切换；
4. 索引重建；
5. 引用失效；
6. 权限变更。

如果选型时不看这些，后期会很痛。

### 17.4 把多模态当成 OCR

多模态不是把图片 OCR 成文字就结束。图表、公式、表格和正文之间有关系，检索和引用都要重新设计。

### 17.5 没有评测集就调参

没有评测集时，任何调参都很难判断是否真正变好。AutoRAG 的最大启发不是某个模块，而是“先把评测建起来”。

---

## 18. 对这个系列后续文章的修正

看完这些项目后，前面系列文章需要明确一个更准确的口径：

1. RAG 不是“向量数据库 + Prompt”；
2. 文档解析和摄取质量决定系统上限；
3. Chunk 是可解释的检索单元，不只是固定长度文本；
4. 检索应该支持多路召回、Rerank、过滤和评测；
5. 引用和 trace 是生产基础能力；
6. 多模态文档不能只靠 OCR；
7. 私有化要覆盖模型、Embedding、OCR、日志和遥测；
8. Agent 和 RAG 会越来越融合；
9. 低代码平台适合交付，但深度检索仍要工程治理；
10. 评测集是优化的起点，不是上线后的附属工作。

后续写 RAG 文章时，资料来源应该同时包含三类：

1. 论文和官方文档，用来保证概念准确；
2. 开源项目，用来观察工程实践；
3. 真实评测和案例，用来验证方法是否适合自己的数据。

---

## 19. 总结

开源 RAG 项目的差异，本质上是对“RAG 应该是什么”的不同回答。

Dify 认为 RAG 是 LLM 应用平台的一部分，所以它强调 workflow、模型管理、应用发布和观测。

RAGFlow 认为 RAG 的难点在复杂文档理解，所以它强调 DeepDoc、模板化 Chunk、可视化和引用。

RAG-Anything 和 LightRAG 认为传统文本 RAG 不够，所以它们把多模态、图谱和跨模态关系放进架构。

AnythingLLM 认为用户需要一个开箱即用的本地 AI 应用，所以它强调桌面、自托管、多模型、Agent 和产品体验。

PrivateGPT 认为隐私和 API primitives 是核心，所以它强调离线、FastAPI、OpenAI 风格接口和 LlamaIndex 抽象。

Haystack 和 LlamaIndex 认为开发者需要可组合框架，所以它们提供 pipeline、component、connector、index、retriever 和 query engine。

Quivr 认为很多团队需要一个 opinionated RAG core，所以它用 Brain 和 workflow 把常见链路包装起来。

AutoRAG 认为 pipeline 应该用数据选，所以它把 RAG 优化变成评测和搜索问题。

RAG_Techniques 认为社区需要方法库，所以它把大量高级技巧整理成可学习、可实验的 notebook。

所以选型时不要问“哪个最好”。更好的问题是：

1. 我的数据是什么形态；
2. 我的用户是谁；
3. 我的交付方式是什么；
4. 我的权限和隐私边界是什么；
5. 我的团队能维护哪种技术栈；
6. 我有没有评测集；
7. 我需要平台、引擎、框架、产品，还是实验工具。

RAG 没有通用最优方案。真正可靠的方案一定是围绕你的数据、用户、权限、成本、延迟和质量目标评测出来的。

---

## 参考资料

1. [Dify GitHub](https://github.com/langgenius/dify)
2. [Dify Docs: Knowledge](https://docs.dify.ai/en/guides/knowledge-base)
3. [RAGFlow GitHub](https://github.com/infiniflow/ragflow)
4. [RAGFlow Documentation](https://ragflow.io/docs/dev/)
5. [RAG-Anything GitHub](https://github.com/HKUDS/RAG-Anything)
6. [LightRAG GitHub](https://github.com/HKUDS/LightRAG)
7. [AnythingLLM GitHub](https://github.com/Mintplex-Labs/anything-llm)
8. [AnythingLLM Docs](https://docs.anythingllm.com)
9. [PrivateGPT GitHub](https://github.com/zylon-ai/private-gpt)
10. [PrivateGPT Docs](https://docs.privategpt.dev/)
11. [Haystack GitHub](https://github.com/deepset-ai/haystack)
12. [Haystack Demos GitHub](https://github.com/deepset-ai/haystack-demos)
13. [LlamaIndex GitHub](https://github.com/run-llama/llama_index)
14. [Quivr GitHub](https://github.com/QuivrHQ/quivr)
15. [Quivr Core Docs](https://core.quivr.com/)
16. [AutoRAG GitHub](https://github.com/Marker-Inc-Korea/AutoRAG)
17. [AutoRAG Documentation](https://marker-inc-korea.github.io/AutoRAG/index.html)
18. [RAG_Techniques GitHub](https://github.com/NirDiamant/RAG_Techniques)
