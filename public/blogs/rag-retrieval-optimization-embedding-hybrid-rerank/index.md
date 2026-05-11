# RAG 检索优化：Embedding、混合检索和 Rerank 怎么选

---

RAG 系统最常见的问题是：资料明明在知识库里，系统就是搜不到，或者搜到了但排序很靠后。

这里专门记录查询阶段的检索优化，包括 Embedding 选型、Top K、相似度阈值、混合检索、Rerank、MMR、查询改写和排查方法。

---

## 1. 先判断问题发生在哪里

不要一看到答案错就换模型。RAG 错误通常分两类：

| 类型 | 判断方式 | 解决方向 |
|---|---|---|
| 检索错 | 正确资料没有进入上下文。 | 优化解析、切分、Embedding、检索策略。 |
| 生成错 | 正确资料进入上下文，但模型答错。 | 优化 Prompt、上下文排序、模型、输出约束。 |

检索优化的第一步，是记录每次请求的 Top K Chunk。

如果正确片段没有进入 Top K，生成模型再强也没用。

---

## 2. Embedding 模型怎么选

Embedding 模型决定文本如何进入语义空间。

选择时关注这些指标：

| 维度 | 说明 |
|---|---|
| 中文能力 | 中文知识库不要只看英文 benchmark。 |
| 领域术语 | 医疗、法律、金融、代码等领域需要额外测试。 |
| 向量维度 | 维度越高，存储和计算成本通常越高。 |
| 最大输入长度 | Chunk 不能超过模型限制。 |
| 成本 | 文档入库和问题查询都会调用 Embedding。 |
| 延迟 | 查询阶段的 Embedding 延迟影响用户体验。 |
| 部署方式 | 云 API 简单，本地模型可控。 |

OpenAI 的 `text-embedding-3-large` 文档说明，Embedding 是文本的数值表示，可用于搜索、聚类、推荐等任务。对 RAG 来说，Embedding 不是模型调用的附属品，而是检索质量的核心依赖。

实践建议：

1. 先用一个通用 Embedding 模型跑通；
2. 构造 50 到 100 个真实问题；
3. 对比 Top K 命中率；
4. 再决定是否更换模型；
5. 更换模型后重建全部向量索引。

不同 Embedding 模型的向量不能混在同一字段里直接比较。

---

## 3. Top K 怎么设置

Top K 是每次检索返回多少个候选 Chunk。

K 太小：

1. 正确片段可能没进上下文；
2. 多条件问题信息不完整；
3. 召回率低。

K 太大：

1. 上下文噪声增加；
2. token 成本上升；
3. 模型更容易被无关资料干扰；
4. 延迟增加。

建议起步：

| 场景 | 初始 Top K |
|---|---|
| FAQ 问答 | 3 到 5 |
| 普通制度文档 | 5 到 8 |
| 技术文档 | 6 到 10 |
| 多文档研究总结 | 10 到 20，然后必须压缩或重排 |

更好的做法是分阶段：

1. 第一阶段召回 20 到 50 个候选；
2. 第二阶段 Rerank；
3. 最终只给模型 5 到 8 个高质量片段。

---

## 4. 相似度阈值要谨慎

很多系统会设置相似度阈值，例如低于 0.5 就不返回。

阈值有价值，但容易误伤。

| 阈值过高 | 阈值过低 |
|---|---|
| 正确资料被过滤。 | 无关资料进入上下文。 |
| 系统频繁回答不知道。 | 模型被噪声误导。 |

阈值不能拍脑袋定。应该用测试集统计：

1. 正确 Chunk 的分数分布；
2. 错误 Chunk 的分数分布；
3. 不同文档类型的分数差异；
4. 不同 Embedding 模型的分数尺度。

不同模型、不同距离函数、不同向量库的分数不可直接比较。

---

## 5. 为什么需要混合检索

纯向量检索擅长语义相似，但不擅长所有问题。

它容易在这些场景出问题：

1. 产品型号；
2. 合同编号；
3. 人名；
4. 精确日期；
5. 错别字；
6. 短查询；
7. 专业缩写；
8. 代码符号；
9. 错误码。

关键词检索擅长精确匹配，但不擅长同义表达。

混合检索就是同时使用两条路：

1. BM25 或全文检索；
2. 向量语义检索；
3. 合并结果；
4. 重新排序。

Azure AI Search 的 Hybrid Search 文档说明，混合检索会并行执行全文查询和向量查询，并使用 Reciprocal Rank Fusion 合并结果。这种做法在 RAG 中非常实用。

---

## 6. RRF 是什么

RRF 是 Reciprocal Rank Fusion，一种合并多个排序列表的方法。

它不直接比较不同检索器的原始分数，而是比较排名。

简化理解：

1. 一个文档在向量检索里排第 1，得分高；
2. 在关键词检索里排第 5，也加分；
3. 两路都靠前的文档，最终排名更靠前。

RRF 的好处是不用强行归一化 BM25 分数和向量相似度分数。

适合场景：

1. 多路召回；
2. 关键词和向量分数尺度不同；
3. 需要一个简单稳定的合并策略。

---

## 7. Rerank 为什么重要

Rerank 是在第一阶段召回后，用更强但更慢的模型重新排序候选结果。

第一阶段检索通常追求快和召回。Rerank 追求精度。

流程：

1. 向量检索召回 30 个；
2. 关键词检索召回 30 个；
3. 合并去重；
4. Rerank 模型判断每个候选和问题的相关性；
5. 取前 5 个进入 Prompt。

Qdrant 的 Hybrid Search with Reranking 文档也强调，Reranking 适合在较小候选集上使用更深的相关性信号，以较低延迟提高结果精度。

Rerank 适合：

1. 文档库大；
2. Top K 噪声多；
3. 问题和答案需要精确对应；
4. 法务、医疗、金融等高风险场景；
5. 技术文档问答。

不适合：

1. 极低延迟要求；
2. 候选集很小；
3. 问题很简单；
4. 成本极敏感场景。

---

## 8. MMR 去重和多样性

MMR 是 Maximal Marginal Relevance，用来平衡相关性和多样性。

普通 Top K 可能返回同一段附近的多个相似 Chunk。

例如：

1. 差旅报销制度第 4 页片段 A；
2. 差旅报销制度第 4 页片段 B；
3. 差旅报销制度第 4 页片段 C；
4. 另一份补充制度没有进入 Top 5。

如果用户问题涉及多个方面，只返回相似片段会导致答案不完整。

MMR 会尽量选择：

1. 和问题相关；
2. 彼此不要太重复。

适合多条件、多文档、多角度问题。

---

## 9. 查询改写

用户问题经常不适合直接检索。

原始问题：

```text
那这个审批要多久？
```

结合历史对话后应该改写为：

```text
员工提交差旅报销审批后，财务审核通常需要多长时间？
```

查询改写常见类型：

| 类型 | 作用 |
|---|---|
| Standalone Question | 把多轮追问改写成独立问题。 |
| Query Expansion | 生成多个同义查询，提高召回。 |
| HyDE | 先生成假设答案，再用假设答案检索。 |
| Keyword Extraction | 提取专有名词、编号、日期。 |
| Multi Query | 用多个角度检索，再合并结果。 |

Spring AI RAG 模块中也包含 Query Transformer，例如把会话历史和追问压缩成独立查询。

查询改写要注意：

1. 使用低 temperature；
2. 保留专有名词；
3. 不要改写出用户没问的东西；
4. 记录改写前后文本，方便排查。

---

## 10. 元数据过滤

很多 RAG 错误不是相似度问题，而是过滤问题。

元数据过滤可以用于：

1. 权限；
2. 租户；
3. 文档类型；
4. 语言；
5. 时间范围；
6. 产品线；
7. 版本；
8. 地区。

示例：

```sql
SELECT content, source
FROM document_chunks
WHERE permission_key = 'employee'
	AND product = 'expense'
	AND version = '2026'
ORDER BY embedding <=> ?::vector
LIMIT 8;
```

权限过滤必须在检索阶段完成。不能先检索所有资料，再要求模型不要泄露。

---

## 11. 检索排查清单

当用户反馈“资料里有，但系统没答出来”，按这个顺序排查：

1. 原始文档里是否真的有答案；
2. 文档是否成功解析；
3. Chunk 是否包含完整答案；
4. Chunk 是否有正确元数据；
5. Embedding 是否成功生成；
6. 查询是否被正确改写；
7. 正确 Chunk 是否进入 Top K；
8. 是否被阈值过滤；
9. 是否被权限过滤；
10. 是否被 Rerank 排低；
11. 是否进入最终 Prompt；
12. 模型是否忽略了上下文。

每一步都要有日志。没有日志，就只能猜。

---

## 12. 推荐优化顺序

不要一开始就上复杂架构。推荐顺序：

1. 先保证文档解析和 Chunk 正确；
2. 建立 50 到 100 条测试问题；
3. 记录 Top K 命中率；
4. 调整 Chunk 大小和 overlap；
5. 对比 Embedding 模型；
6. 加关键词检索；
7. 加 RRF 合并；
8. 加 Rerank；
9. 加查询改写；
10. 加上下文压缩。

每一步都要用同一批测试集比较，不要凭主观感觉。

---

## 13. 总结

RAG 检索优化的目标不是让结果“看起来更多”，而是让正确证据稳定进入模型上下文。

核心原则：

1. 先区分检索错还是生成错；
2. Embedding 模型要用测试集评估；
3. Top K 和阈值要基于数据调整；
4. 关键词检索和向量检索互补；
5. Rerank 适合提升候选精度；
6. MMR 适合降低重复；
7. 查询改写适合多轮和模糊问题；
8. 权限过滤必须在检索阶段做。

下一篇我们会讲生产化：评测、安全、权限、成本和运维。

---

## 参考资料

1. [OpenAI Docs: text-embedding-3-large](https://platform.openai.com/docs/models/text-embedding-3-large)
2. [OpenAI API Docs: Retrieval](https://platform.openai.com/docs/guides/retrieval)
3. [Azure AI Search: Hybrid search overview](https://learn.microsoft.com/en-us/azure/search/hybrid-search-overview)
4. [Azure AI Search: Create a hybrid query](https://learn.microsoft.com/en-us/azure/search/hybrid-search-how-to-query)
5. [Qdrant: Hybrid Search with Reranking](https://qdrant.tech/documentation/tutorials-search-engineering/reranking-hybrid-search/)
6. [Spring AI Reference: Retrieval Augmented Generation](https://docs.spring.io/spring-ai/reference/api/retrieval-augmented-generation.html)
