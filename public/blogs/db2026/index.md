# DB2026：从 RMDB 骨架到国赛三等奖，上海的旅程

> 2026 年全国大学生计算机系统能力大赛数据库管理系统设计赛，我们最终获得国赛三等奖。这个结果并非没有遗憾，但几个月里从读懂 RMDB 骨架、补全核心链路，到在上海完成决赛答辩的经历，已经值得完整记下来。

![DB2026 上海决赛](/blogs/db2026/cover.png)

## 先说结果

说实话咱们对于结果还是不太满意，只拿到了全国三等奖，我认为我们应该是有机会拿到二等奖的，但是已经过去了，只能说五分靠努力五分靠运气吧，但也是总比没有好。

## 我们主要完成了什么

全国大学生计算机系统能力大赛数据库管理系统设计赛实际上不是考**编写数据库语言**，而是考**搭建一个类似 MySQL 的数据库**；说实话我们也没想到要用 C/C++ 完成这样一个庞大的工程，整个代码仓库十分巨大。从 4 月咱们开始做，一直到 8 月下旬结束，期间尝试了各种方法完成功能以及提升性能，咱们三个队员也是筋疲力尽。

赛程大概是这样的：先是线上初赛（从 4—7 月左右），这个时候有 10 个功能题目和最后一个初赛性能题目，只有**初赛前 50 名**左右才能进入决赛；然后是决赛线上赛，依然有两道新的功能题目，并且继续进行性能排名，咱们五十多个队伍最终排到了一个比较居中的位置；最后就是线下，包括线下决赛编写一个新的功能并且提交判题（纯断网环境），以及最终的答辩。

### 为什么会报名

关于为什么会报名，实际上就是看到比赛感觉可以拿个奖就报名了，没想到的是这难度有点大啊。

## 赛程历史

### 初赛

最开始拿到这个比赛赛题的时候，把仓库拉下来实际上咱们还是有点懵的，仓库确实有点大，而且全是 C/C++，还好现在是 AI 时代，稍微梳理一下就比较容易理解了。

然后就是常规的初赛完成 10 道题目的环节，这个说实话是比较容易的，毕竟目前有 AI 了，就算是一个 C/C++ 一点都看不懂的人，也能够将比赛赛题和代码丢给 AI 跑出来，实际上我们也是这么干的，将赛题内容和代码丢给 AI，然后让 AI 直接改，10 道题大概 5 天左右就做完了。

下一阶段才稍微有点难度，“跑分”，这个就不是简单改一下功能能够完成的了。毕竟我有 AI，人家其它学校也有 AI，指不定人家用的 AI 还是最顶尖的（虽然我认为 GPT 已经足够顶尖了，但是万一人家用的是 fable5 呢，那岂不是将我们按在地上摩擦）。这个时候才真正显现出竞争的激烈，每个小时都有人疯狂刷榜，今天看到 1W 分的，明天 1.5W，后天 2W 了，最后几天更是疯狂，几百支队伍不停提交。

但是离谱的不只是这个，还有一场**“心理博弈”**，这个测试平台有问题！！

本来理论上这种数据库性能测试应该给每个队伍**固定的服务器性能**进行测试吧，比如都固定 4H8G 用于测试，但是实际上大家测试的时候是共用服务器资源的，而服务器资源本身又是有限的，就导致今天上午的测试结果可能是 1W 分，下午同样的代码只有 5K 了。为啥呢？因为上午可能只有 10 个队伍同时测试，下午有 30 个队伍测。

多个队伍同时测试导致分数可能出现巨大的偏差，就算你优化得再好，遇到同时 50 个队伍一起测试，分数也可能直接拉完。最麻烦的是，这会导致你根本不知道自己这次做的优化到底是正向的还是反向的，让所有人都迷迷糊糊的。

大家想要拿到高分就得挑个**“好日子”**，于是就出现了半夜 12 点来测试的，结果发现大家都这样想，还是拉完了。而且排行榜并非取最高分，而是以最后一次分数为准，导致那些已经拿到高分的队伍也有点忧虑，毕竟人家也不知道到底是自己的代码性能真的好，还是运气好，刚好测试的时候没几支队伍同时测，所以高分的也不太敢随便动这个分数。

当然还是有头铁的，**华科**有支队伍就疯狂测，都 10W+ 的分数了还在拼，也难怪分高。

初赛性能排行榜学校情况：

| **学校队伍数**         |      |
| ---------------------- | ---- |
| 华中科技大学           | 25   |
| 武汉大学               | 12   |
| 重庆大学               | 10   |
| 浙大城市学院           | 6    |
| 南开大学               | 5    |
| 山东大学（青岛）       | 4    |
| 东北大学               | 4    |
| 西南大学               | 3    |
| 华东师范大学           | 3    |
| 成都理工大学           | 3    |
| 温州大学               | 3    |
| 哈尔滨工业大学         | 2    |
| 中国人民大学           | 2    |
| 西安交通大学           | 2    |
| 国防科技大学           | 2    |
| 哈尔滨工业大学（深圳） | 1    |
| 山东大学               | 1    |
| 哈尔滨工业大学（威海） | 1    |
| 浙江大学               | 1    |
| 南昌大学               | 1    |
| 中国矿业大学           | 1    |
| 南京邮电大学           | 1    |
| 西北工业大学           | 1    |
| 天津工业大学           | 1    |
| 西安电子科技大学       | 1    |
| 厦门理工学院           | 1    |
| 西华大学               | 1    |
| 天津大学               | 1    |
| 华南理工大学           | 1    |
| 河南大学               | 1    |

我们最后测试得到的也是一个居中甚至稍微靠前的分数，当时也在想需不需要继续拼，但是往上一看感觉好像拼尽了也超不过，于是抱着“能过就行”的心态停了下来（这也给我们的决赛造成了巨大的打击）。

### 决赛线上

意料之中，我们平稳通过初赛（整体性能位于前 50 名），顺利进入决赛。决赛新增两个功能需要实现，一个是 `DISTINCT` 去重的支持，另一个是 RMDB Wire Protocol 传输协议。

决赛阶段终于好起来了，性能测试总算固定了，使用的是队伍排队测试，每支队伍测试时可以占用这台机器的全部性能（就是排队有点长），但是非常稳定，同一个代码两次测试的误差基本不超过 1%。

决赛线上留下的基本都是大佬，那分数也是一天比一天高，统计了一下决赛排行榜学校队伍数量：

| **学校队伍数**         |      |
| ---------------------- | ---- |
| 华中科技大学           | 17   |
| 重庆大学               | 8    |
| 南开大学               | 4    |
| 武汉大学               | 3    |
| 华东师范大学           | 3    |
| 西南大学               | 3    |
| 东北大学               | 3    |
| 山东大学（青岛）       | 2    |
| 成都理工大学           | 2    |
| 哈尔滨工业大学         | 2    |
| 中国人民大学           | 2    |
| 温州大学               | 2    |
| 浙大城市学院           | 2    |
| 天津工业大学           | 1    |
| 西北工业大学           | 1    |
| 南京邮电大学           | 1    |
| 浙江大学               | 1    |
| 中国矿业大学           | 1    |
| 哈尔滨工业大学（威海） | 1    |
| 南昌大学               | 1    |
| 哈尔滨工业大学（深圳） | 1    |

这个时候问题就出现了，决赛时间非常紧，从 `07/27 12:00 - 08/15 23:59`，只有不足 20 天，而初赛足足有两个月。由于比赛本身是循序渐进的，前面的简单优化做完之后，到了决赛阶段就开始明显遇到优化瓶颈了。我们开了很多分支，从不同方向进行优化（最高的时候同时有十多个分支），然后靠实际测试来判断优化到底是正向还是反向，分数从 1W 一点点做到接近 6W。最后几天更是疯狂，三个人一天烧了 8 亿 Token，会话基本整天都在开着，优化了就提交，优化了就提交。

当然还有一个最严重的问题，那就是线下现场的代码编写，没有 AI、断网，如果线下题目没过就直接影响最终成绩，所以咱们一边疯狂优化线上性能，一边还得准备线下决赛。

当然还有一个最惊心动魄的小插曲。15 日晚上咱们还在改动，毕竟要`尝试`的分支太多了，而评测又需要排队。当时我们还在赶地铁去机场，准备再测试两个分支，如果这两个分支效果不好，就换回我们的兜底分支（这个分支之前已经多次测试过，基本稳定在 6W 分）。但是当我们真正切回兜底分支提交的时候，突然报错了，没有成绩。当时距离截止时间只剩 1 个小时，我们直接下地铁坐在椅子上急忙处理，但是这个原先明明没问题的分支当时就是跑不出来分数。我们又试了一次，最终距离截止几乎只剩下 10 分钟左右的时候，这次代码才终于成功通过，但是分数比原来少了 1W。至今我也不知道具体是什么原因，我认为可能还是服务器或者运行环境出现了一些波动。

如果最后真的没有提交上去，或者提交上去没有有效分数，那就是真的血亏了：前面的比赛投入 4K+，Token 费用超过 1K，机票甚至都有可能没法报销。

当然我们也成功错过了地铁最后一班。

最后打出租车。

血亏 100.........................

以后还是稳妥一点好.............................

以及不能全部相信 AI，这个多少也有点 AI 的锅。AI 当时也认为咱们这个流程非常合适，毕竟我们都觉得最后两个小时继续提交两次没测过的代码看看效果，实在不行最后再切回稳定的 6W 分支提交，怎么看都有兜底。但是谁也没想到，最后那个一直稳定的 6W 分支偏偏也出了问题。

## 我们做成了什么

在进入上海线下决赛之前，还是想先停下来看看，这几个月我们到底把 RMDB 改成了什么样子。

如果只看比赛题目，可能会觉得我们无非就是给一个教学数据库补功能、修 Bug，然后做性能优化。但做到最后，这个项目实际上已经和最开始拿到手里的 RMDB 骨架有了非常大的区别。

最开始的 RMDB 还是一个比较典型的教学数据库框架，我们首先补齐了最基础的存储和 SQL 执行链路，包括 Buffer Pool、Record Manager、索引、Seq Scan、Index Scan、Filter、Projection、Join、Insert、Update、Delete、Planner、WAL 和恢复等模块。做到这里的时候，它至少已经是一个“能正常执行 SQL 的数据库”了。

但比赛真正麻烦的地方显然不是“能不能跑”，而是：**怎么让它跑得足够快，而且并发、事务、崩溃恢复还不能出错。**

于是后面的几个月基本都在围绕这件事情折腾。

### 把事务和 MVCC 真正做起来

我们后来重新梳理了整个 MVCC，实现 Snapshot Isolation、Undo Log、历史版本读取、写冲突检测以及事务可见性，并且把原本散落在不同地方的 MVCC 逻辑逐渐统一起来。

这部分做起来其实比想象中麻烦很多。数据库性能优化有一个很讨厌的地方：**你不能只让它快。** 如果一个优化能让吞吐量翻倍，但是偶尔会出现 Lost Update、恢复错误或者事务可见性异常，那这个优化实际上等于没做。

所以比赛后期经常出现一种情况：改完，跑分快了；然后并发测试炸了；回退；换一种方法；再跑。很多看起来非常美好的优化最后都被我们自己删掉了。

### SQL 也不再老老实实一条一条执行

传统数据库执行一条 SQL，大概会经过：

```text
Parser → Analyzer → Planner → Executor → Storage
```

但是性能赛里面 SQL 的结构往往是高度重复的，如果每一次请求都重新 Parse、Analyze、Planner，其实是在重复做大量相同工作。所以后面我们干脆把这一套重新设计了，在 `PREPARE_SET` 阶段提前把 SQL 解析、分析、规划以及索引访问方式编译好，形成 Compiled Plan；真正执行 `EXEC_BATCH` 的时候，只需要传 Statement ID 和参数。

再往后，一些固定 SQL 甚至不再完整经过普通 Executor，而是直接走 Exact Index Select、Direct Update、Direct Insert、Direct Aggregate 之类的快速路径。说白了就是：**能提前算好的东西全部提前算，运行时尽量只干真正有用的事情。**

### 后来连“修改一行数据”这件事情都被我们重写了

做到决赛阶段后，我们发现传统的 Heap + B+Tree 更新路径本身也已经成为瓶颈，于是又做了一套 Compiled Delta。

传统方式是事务修改数据时直接改 Heap 和索引，而我们后来的方式更像：

```text
原始 Heap / B+Tree
        +
Delta Update
Delta Delete
Virtual Insert
```

更新不再立即完整修改底层记录，而是先记录字段变化；Insert 可以先使用 Virtual RID；事务提交以后将 Delta 发布出去，到 Checkpoint 时再逐步物化回真正的 Heap 和 B+Tree。

这也意味着后面的事务、恢复、Checkpoint、GC、索引甚至 WAL 全部需要跟着这套架构重新适配。做到这里的时候，我们其实已经不是在“给 RMDB 加几个优化”了，而是在重写它的一条核心数据路径。

### 最后连 WAL 都开始抠

数据库性能里面还有一个非常经典的问题：刷盘。

如果每个事务提交都单独写 WAL、单独 `fdatasync` 一次，再高的并发也会被磁盘同步卡死。所以我们后来又做了单 Writer WAL、批量 WAL 和 Group Commit，多个执行线程只负责产生 WAL，统一进入队列，由一个 WAL Writer 批量写入，然后让多个事务共享一次磁盘同步成本。

后来又继续加入 Durable Epoch，把“WAL 已经持久化”和“事务什么时候可以对其他事务可见”拆成两个过程，目的还是同一个：**尽可能让 CPU、事务执行和磁盘 IO 并行起来，而不是所有线程排队等一次刷盘。**

### 最终它变成了什么

如果一定要给我们最后做出来的东西画一条链，大概已经变成了：

```text
PREPARE_SET
    ↓
Compiled Plan
    ↓
EXEC_BATCH
    ↓
Direct Plan / Index Fast Path
    ↓
Partition Admission
    ↓
Compiled Delta
    ↓
字段级 OCC
    ↓
WAL Group Commit
    ↓
Durable Epoch
    ↓
事务可见
```

除此之外还有 Hash Join、外部排序、批量页读取、查询缓存、恢复审计缓存、Checkpoint、Delta GC、崩溃恢复等一堆东西。

当然，这里面相当一部分设计都是为了比赛负载做的，离一个真正像 MySQL、PostgreSQL 那样成熟的数据库还差得很远。但从四月份刚拉下来 RMDB 仓库时连整个代码结构都没完全看懂，到八月份开始讨论事务冲突粒度、WAL Pipeline、Delta Runtime 和恢复路径，这个跨度还是挺离谱的。

也是做到最后我们才真正理解，数据库所谓的“性能优化”，很多时候根本不是把某一段代码从 100ms 优化成 50ms。真正做到后面，往往是发现：**这一层已经没有什么可以优化了，那就只能重新设计这一层。**

然后改完这一层，下一层又成了新的瓶颈。

就这样一层一层往下挖，最后几乎把整个数据库的执行链路重新走了一遍。

## 上海决赛：强组、答辩与遗憾

### 决赛线下

决赛线下还是很紧张的，需要现场手写功能。当时咱们线上排名只有 30 名左右，还是有点悬的，要是线下题目没过，那最后可能就只能拿个优秀奖回去了。

而且最关键的是，线下是真正的纯断网环境，没有 AI。前几天咱们还是三个人一天烧 8 亿 Token、会话全天开着，到真正现场的时候 AI 一个 Token 都帮不了你，只能老老实实自己看代码、找调用链、写功能、调试。

当然前面的准备还是没有白费，最后咱们顺利完成了线下功能，也成功通过了代码测试。到这个时候至少算是松了一口气：不管最后奖项怎么样，这趟上海至少不会拿个优秀奖回去了。

接下来就是准备答辩，但是这个地方咱们是真的失算了。下午差不多 6 点比赛结束，晚上 10 点之前就要提交答辩 PPT，早知道就应该在线下比赛之前把 PPT 的主体提前准备好。结果当天只能比赛结束以后马上开始赶，几个小时里面把整个系统架构、优化方案、性能结果全部塞进去，最后基本只能保证“做完了”，根本给不了多少检查和调整的时间。

现在回头看，这应该算我们整个比赛里面一个比较明显的失误。前面一直觉得比赛最重要的是代码和性能，但是到了最后才发现，答辩本身也是比赛的一部分，你做了多少东西是一回事，能不能在 20 分钟里面让评委快速理解你到底做了什么，又是另外一回事。

第二天的答辩才是最最紧张的，特别是看到分组以后，只能说大奖梦难度直接拉满了。咱们这一组全是大佬，华科、西南大学、重大、南开的都有，刚好咱们还处于中间位置。

前面的队伍一个个上去，答辩基本都是满满 20 分钟，有的甚至还超时了，而且不少都是线上 10W+ 的性能成绩。这样一比，咱们这个 5W 左右的分数不能说落差很大吧，只能说不值一提。

下面评委老师都在蛐蛐这到底是怎么分的组。

然后轮到咱们。

只能说完美印证了一句话：

**只答不辨、疯狂道歉。**

.........................

后来从能够了解到的成绩来看，咱们的答辩成绩确实比较靠后，而我们线上性能本身也只能算一个比较一般的位置，最终凭借比较一般的性能成绩加上一个拉跨的答辩成绩，拿到了全国三等奖。

说实话咱们还是有点遗憾的，因为在三等奖里面咱们也是非常靠前的，离二等奖大概只差 3—4 个位置。稍微一个正常一点的答辩成绩，或者线上最后没有莫名其妙掉那 1W 分，二等奖其实是真的有机会。

当然，可惜没有如果。

## 上海，不只是一座比赛城市

![上海外滩夜景](/blogs/db2026/shanghai-bund-skyline-night.jpg)

当然比赛结束以后还是在上海玩了几天，去了上海外滩、四行仓库这些地方。不过相比景点，这趟上海另外一个比较值得的地方，还是认识和见到了一些挺厉害的人。

![外滩历史建筑夜景](/blogs/db2026/shanghai-bund-architecture-night.jpg)

![四行仓库外观](/blogs/db2026/sihang-warehouse-exterior.jpg)

![四行仓库门头](/blogs/db2026/sihang-warehouse-entrance.jpg)

比如咱们的大佬学长，人大的直博学长，还有已经入职字节的研发岗学长。

算了一下工资，差不多 2000。

当然我说的是换算出来的一天工资 2000.................................

![上海东方明珠](/blogs/db2026/shanghai-oriental-pearl-day.jpg)

这次比赛从四月份开始，到八月份结束，前前后后折腾了差不多四个月。最开始报名的时候想得非常简单，就是“这个比赛感觉可以拿个奖”，结果最后变成了三个人天天改数据库、开十几个性能分支、一天烧 8 亿 Token、截止前十分钟还坐在地铁站等评测结果，最后又跑到上海断网写代码、做 PPT、和一群 10W+ 的大佬一起答辩。

最后只拿了三等奖确实有遗憾，尤其是离二等奖就差那么几个位置，现在想起来还是会觉得有点可惜。

但是再回头看，从四月份第一次拉下来 RMDB 连整个项目都没完全看明白，到最后真的把这个东西一路改成现在这样，还能跑到上海参加国赛决赛，其实也算是做成了一件以前完全没想过自己会去做的事情。

二等奖没拿到。

上海还是去了。

数据库也确实写了四个月。

奖也总算拿到了。

这趟也不算白折腾。

最后：感觉造数据库也不是很难，就优化难了亿点的而已。

下面是各个学校的获奖情况：

<div style="overflow-x:auto;margin:24px 0">
  <div style="min-width:600px;border:1px solid var(--color-border);border-radius:16px;padding:20px;background:var(--color-article)">
    <div style="margin-bottom:14px;text-align:center;font-size:15px;font-weight:600">各学校获奖奖项分布（学校 × 奖项，共 61 队）</div>
    <div style="display:flex;justify-content:center;gap:16px;margin-bottom:16px;font-size:12px">
      <span><i style="display:inline-block;width:10px;height:10px;margin-right:5px;border-radius:2px;background:#E8A33D"></i>一等奖</span>
      <span><i style="display:inline-block;width:10px;height:10px;margin-right:5px;border-radius:2px;background:#7FA8D9"></i>二等奖</span>
      <span><i style="display:inline-block;width:10px;height:10px;margin-right:5px;border-radius:2px;background:#7BC4A8"></i>三等奖</span>
      <span><i style="display:inline-block;width:10px;height:10px;margin-right:5px;border-radius:2px;background:#AAB7C4"></i>优胜奖</span>
    </div>
    <div style="display:grid;grid-template-columns:160px minmax(300px,1fr) 116px;gap:12px;align-items:center;padding:0 0 6px;color:var(--color-secondary);font-size:11px"><span style="text-align:right">学校</span><span>队伍数</span><span>奖项明细</span></div>
    <div style="display:grid;grid-template-columns:160px minmax(300px,1fr) 116px;gap:12px;align-items:center;min-height:28px;font-size:12px"><span style="text-align:right">华中科技大学</span><span style="display:flex;height:16px;overflow:hidden;border-radius:4px;background:var(--color-border)"><i title="二等奖 6" style="flex:0 0 35.294%;background:#7FA8D9"></i><i title="三等奖 7" style="flex:0 0 41.176%;background:#7BC4A8"></i><i title="优胜奖 4" style="flex:0 0 23.529%;background:#AAB7C4"></i></span><span style="white-space:nowrap;font-size:11px"><b style="color:#E8A33D">一0</b> <b style="color:#7FA8D9">二6</b> <b style="color:#7BC4A8">三7</b> <b style="color:#AAB7C4">优4</b></span></div>
    <div style="display:grid;grid-template-columns:160px minmax(300px,1fr) 116px;gap:12px;align-items:center;min-height:28px;font-size:12px"><span style="text-align:right">重庆大学</span><span style="display:flex;height:16px;overflow:hidden;border-radius:4px;background:var(--color-border)"><i title="一等奖 1" style="flex:0 0 5.882%;background:#E8A33D"></i><i title="二等奖 2" style="flex:0 0 11.765%;background:#7FA8D9"></i><i title="三等奖 3" style="flex:0 0 17.647%;background:#7BC4A8"></i><i title="优胜奖 2" style="flex:0 0 11.765%;background:#AAB7C4"></i></span><span style="white-space:nowrap;font-size:11px"><b style="color:#E8A33D">一1</b> <b style="color:#7FA8D9">二2</b> <b style="color:#7BC4A8">三3</b> <b style="color:#AAB7C4">优2</b></span></div>
    <div style="display:grid;grid-template-columns:160px minmax(300px,1fr) 116px;gap:12px;align-items:center;min-height:28px;font-size:12px"><span style="text-align:right">南开大学</span><span style="display:flex;height:16px;overflow:hidden;border-radius:4px;background:var(--color-border)"><i title="二等奖 1" style="flex:0 0 5.882%;background:#7FA8D9"></i><i title="三等奖 2" style="flex:0 0 11.765%;background:#7BC4A8"></i><i title="优胜奖 1" style="flex:0 0 5.882%;background:#AAB7C4"></i></span><span style="white-space:nowrap;font-size:11px"><b style="color:#E8A33D">一0</b> <b style="color:#7FA8D9">二1</b> <b style="color:#7BC4A8">三2</b> <b style="color:#AAB7C4">优1</b></span></div>
    <div style="display:grid;grid-template-columns:160px minmax(300px,1fr) 116px;gap:12px;align-items:center;min-height:28px;font-size:12px"><span style="text-align:right">武汉大学</span><span style="display:flex;height:16px;overflow:hidden;border-radius:4px;background:var(--color-border)"><i title="一等奖 1" style="flex:0 0 5.882%;background:#E8A33D"></i><i title="二等奖 1" style="flex:0 0 5.882%;background:#7FA8D9"></i><i title="优胜奖 1" style="flex:0 0 5.882%;background:#AAB7C4"></i></span><span style="white-space:nowrap;font-size:11px"><b style="color:#E8A33D">一1</b> <b style="color:#7FA8D9">二1</b> <b style="color:#7BC4A8">三0</b> <b style="color:#AAB7C4">优1</b></span></div>
    <div style="display:grid;grid-template-columns:160px minmax(300px,1fr) 116px;gap:12px;align-items:center;min-height:28px;font-size:12px"><span style="text-align:right">华东师范大学</span><span style="display:flex;height:16px;overflow:hidden;border-radius:4px;background:var(--color-border)"><i title="一等奖 1" style="flex:0 0 5.882%;background:#E8A33D"></i><i title="三等奖 2" style="flex:0 0 11.765%;background:#7BC4A8"></i></span><span style="white-space:nowrap;font-size:11px"><b style="color:#E8A33D">一1</b> <b style="color:#7FA8D9">二0</b> <b style="color:#7BC4A8">三2</b> <b style="color:#AAB7C4">优0</b></span></div>
    <div style="display:grid;grid-template-columns:160px minmax(300px,1fr) 116px;gap:12px;align-items:center;min-height:28px;font-size:12px"><span style="text-align:right">西南大学</span><span style="display:flex;height:16px;overflow:hidden;border-radius:4px;background:var(--color-border)"><i title="一等奖 2" style="flex:0 0 11.765%;background:#E8A33D"></i><i title="优胜奖 1" style="flex:0 0 5.882%;background:#AAB7C4"></i></span><span style="white-space:nowrap;font-size:11px"><b style="color:#E8A33D">一2</b> <b style="color:#7FA8D9">二0</b> <b style="color:#7BC4A8">三0</b> <b style="color:#AAB7C4">优1</b></span></div>
    <div style="display:grid;grid-template-columns:160px minmax(300px,1fr) 116px;gap:12px;align-items:center;min-height:28px;font-size:12px"><span style="text-align:right">东北大学</span><span style="display:flex;height:16px;overflow:hidden;border-radius:4px;background:var(--color-border)"><i title="二等奖 1" style="flex:0 0 5.882%;background:#7FA8D9"></i><i title="三等奖 1" style="flex:0 0 5.882%;background:#7BC4A8"></i><i title="优胜奖 1" style="flex:0 0 5.882%;background:#AAB7C4"></i></span><span style="white-space:nowrap;font-size:11px"><b style="color:#E8A33D">一0</b> <b style="color:#7FA8D9">二1</b> <b style="color:#7BC4A8">三1</b> <b style="color:#AAB7C4">优1</b></span></div>
    <div style="display:grid;grid-template-columns:160px minmax(300px,1fr) 116px;gap:12px;align-items:center;min-height:28px;font-size:12px"><span style="text-align:right">山东大学（青岛）</span><span style="display:flex;height:16px;overflow:hidden;border-radius:4px;background:var(--color-border)"><i title="一等奖 1" style="flex:0 0 5.882%;background:#E8A33D"></i><i title="三等奖 1" style="flex:0 0 5.882%;background:#7BC4A8"></i></span><span style="white-space:nowrap;font-size:11px"><b style="color:#E8A33D">一1</b> <b style="color:#7FA8D9">二0</b> <b style="color:#7BC4A8">三1</b> <b style="color:#AAB7C4">优0</b></span></div>
    <div style="display:grid;grid-template-columns:160px minmax(300px,1fr) 116px;gap:12px;align-items:center;min-height:28px;font-size:12px"><span style="text-align:right">成都理工大学</span><span style="display:flex;height:16px;overflow:hidden;border-radius:4px;background:var(--color-border)"><i title="二等奖 1" style="flex:0 0 5.882%;background:#7FA8D9"></i><i title="三等奖 1" style="flex:0 0 5.882%;background:#7BC4A8"></i></span><span style="white-space:nowrap;font-size:11px"><b style="color:#E8A33D">一0</b> <b style="color:#7FA8D9">二1</b> <b style="color:#7BC4A8">三1</b> <b style="color:#AAB7C4">优0</b></span></div>
    <div style="display:grid;grid-template-columns:160px minmax(300px,1fr) 116px;gap:12px;align-items:center;min-height:28px;font-size:12px"><span style="text-align:right">哈尔滨工业大学</span><span style="display:flex;height:16px;overflow:hidden;border-radius:4px;background:var(--color-border)"><i title="三等奖 1" style="flex:0 0 5.882%;background:#7BC4A8"></i><i title="优胜奖 1" style="flex:0 0 5.882%;background:#AAB7C4"></i></span><span style="white-space:nowrap;font-size:11px"><b style="color:#E8A33D">一0</b> <b style="color:#7FA8D9">二0</b> <b style="color:#7BC4A8">三1</b> <b style="color:#AAB7C4">优1</b></span></div>
    <div style="display:grid;grid-template-columns:160px minmax(300px,1fr) 116px;gap:12px;align-items:center;min-height:28px;font-size:12px"><span style="text-align:right">中国人民大学</span><span style="display:flex;height:16px;overflow:hidden;border-radius:4px;background:var(--color-border)"><i title="三等奖 1" style="flex:0 0 5.882%;background:#7BC4A8"></i><i title="优胜奖 1" style="flex:0 0 5.882%;background:#AAB7C4"></i></span><span style="white-space:nowrap;font-size:11px"><b style="color:#E8A33D">一0</b> <b style="color:#7FA8D9">二0</b> <b style="color:#7BC4A8">三1</b> <b style="color:#AAB7C4">优1</b></span></div>
    <div style="display:grid;grid-template-columns:160px minmax(300px,1fr) 116px;gap:12px;align-items:center;min-height:28px;font-size:12px"><span style="text-align:right">温州大学</span><span style="display:flex;height:16px;overflow:hidden;border-radius:4px;background:var(--color-border)"><i title="三等奖 1" style="flex:0 0 5.882%;background:#7BC4A8"></i><i title="优胜奖 1" style="flex:0 0 5.882%;background:#AAB7C4"></i></span><span style="white-space:nowrap;font-size:11px"><b style="color:#E8A33D">一0</b> <b style="color:#7FA8D9">二0</b> <b style="color:#7BC4A8">三1</b> <b style="color:#AAB7C4">优1</b></span></div>
    <div style="display:grid;grid-template-columns:160px minmax(300px,1fr) 116px;gap:12px;align-items:center;min-height:28px;font-size:12px"><span style="text-align:right">浙大城市学院</span><span style="display:flex;height:16px;overflow:hidden;border-radius:4px;background:var(--color-border)"><i title="优胜奖 2" style="flex:0 0 11.765%;background:#AAB7C4"></i></span><span style="white-space:nowrap;font-size:11px"><b style="color:#E8A33D">一0</b> <b style="color:#7FA8D9">二0</b> <b style="color:#7BC4A8">三0</b> <b style="color:#AAB7C4">优2</b></span></div>
    <div style="display:grid;grid-template-columns:160px minmax(300px,1fr) 116px;gap:12px;align-items:center;min-height:28px;font-size:12px"><span style="text-align:right">天津工业大学</span><span style="display:flex;height:16px;overflow:hidden;border-radius:4px;background:var(--color-border)"><i title="二等奖 1" style="flex:0 0 5.882%;background:#7FA8D9"></i></span><span style="white-space:nowrap;font-size:11px"><b style="color:#E8A33D">一0</b> <b style="color:#7FA8D9">二1</b> <b style="color:#7BC4A8">三0</b> <b style="color:#AAB7C4">优0</b></span></div>
    <div style="display:grid;grid-template-columns:160px minmax(300px,1fr) 116px;gap:12px;align-items:center;min-height:28px;font-size:12px"><span style="text-align:right">西北工业大学</span><span style="display:flex;height:16px;overflow:hidden;border-radius:4px;background:var(--color-border)"><i title="二等奖 1" style="flex:0 0 5.882%;background:#7FA8D9"></i></span><span style="white-space:nowrap;font-size:11px"><b style="color:#E8A33D">一0</b> <b style="color:#7FA8D9">二1</b> <b style="color:#7BC4A8">三0</b> <b style="color:#AAB7C4">优0</b></span></div>
    <div style="display:grid;grid-template-columns:160px minmax(300px,1fr) 116px;gap:12px;align-items:center;min-height:28px;font-size:12px"><span style="text-align:right">南京邮电大学</span><span style="display:flex;height:16px;overflow:hidden;border-radius:4px;background:var(--color-border)"><i title="三等奖 1" style="flex:0 0 5.882%;background:#7BC4A8"></i></span><span style="white-space:nowrap;font-size:11px"><b style="color:#E8A33D">一0</b> <b style="color:#7FA8D9">二0</b> <b style="color:#7BC4A8">三1</b> <b style="color:#AAB7C4">优0</b></span></div>
    <div style="display:grid;grid-template-columns:160px minmax(300px,1fr) 116px;gap:12px;align-items:center;min-height:28px;font-size:12px"><span style="text-align:right">浙江大学</span><span style="display:flex;height:16px;overflow:hidden;border-radius:4px;background:var(--color-border)"><i title="三等奖 1" style="flex:0 0 5.882%;background:#7BC4A8"></i></span><span style="white-space:nowrap;font-size:11px"><b style="color:#E8A33D">一0</b> <b style="color:#7FA8D9">二0</b> <b style="color:#7BC4A8">三1</b> <b style="color:#AAB7C4">优0</b></span></div>
    <div style="display:grid;grid-template-columns:160px minmax(300px,1fr) 116px;gap:12px;align-items:center;min-height:28px;font-size:12px"><span style="text-align:right">中国矿业大学</span><span style="display:flex;height:16px;overflow:hidden;border-radius:4px;background:var(--color-border)"><i title="三等奖 1" style="flex:0 0 5.882%;background:#7BC4A8"></i></span><span style="white-space:nowrap;font-size:11px"><b style="color:#E8A33D">一0</b> <b style="color:#7FA8D9">二0</b> <b style="color:#7BC4A8">三1</b> <b style="color:#AAB7C4">优0</b></span></div>
    <div style="display:grid;grid-template-columns:160px minmax(300px,1fr) 116px;gap:12px;align-items:center;min-height:28px;font-size:12px"><span style="text-align:right">哈尔滨工业大学（威海）</span><span style="display:flex;height:16px;overflow:hidden;border-radius:4px;background:var(--color-border)"><i title="三等奖 1" style="flex:0 0 5.882%;background:#7BC4A8"></i></span><span style="white-space:nowrap;font-size:11px"><b style="color:#E8A33D">一0</b> <b style="color:#7FA8D9">二0</b> <b style="color:#7BC4A8">三1</b> <b style="color:#AAB7C4">优0</b></span></div>
    <div style="display:grid;grid-template-columns:160px minmax(300px,1fr) 116px;gap:12px;align-items:center;min-height:28px;font-size:12px"><span style="text-align:right">南昌大学</span><span style="display:flex;height:16px;overflow:hidden;border-radius:4px;background:var(--color-border)"><i title="三等奖 1" style="flex:0 0 5.882%;background:#7BC4A8"></i></span><span style="white-space:nowrap;font-size:11px"><b style="color:#E8A33D">一0</b> <b style="color:#7FA8D9">二0</b> <b style="color:#7BC4A8">三1</b> <b style="color:#AAB7C4">优0</b></span></div>
    <div style="display:grid;grid-template-columns:160px minmax(300px,1fr) 116px;gap:12px;align-items:center;min-height:28px;font-size:12px"><span style="text-align:right">哈尔滨工业大学（深圳）</span><span style="display:flex;height:16px;overflow:hidden;border-radius:4px;background:var(--color-border)"><i title="优胜奖 1" style="flex:0 0 5.882%;background:#AAB7C4"></i></span><span style="white-space:nowrap;font-size:11px"><b style="color:#E8A33D">一0</b> <b style="color:#7FA8D9">二0</b> <b style="color:#7BC4A8">三0</b> <b style="color:#AAB7C4">优1</b></span></div>
  </div>
</div>
