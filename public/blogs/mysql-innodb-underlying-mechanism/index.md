# MySQL / InnoDB 底层机制深度解析

---

## 0. MySQL 底层机制总览

MySQL 一条 SQL 从客户端发过来，大致经过：

```text
客户端
  ↓
连接器：认证、权限、连接管理
  ↓
分析器：词法分析、语法分析
  ↓
优化器：选择索引、决定 join 顺序、决定扫描方式
  ↓
执行器：调用存储引擎接口
  ↓
InnoDB 存储引擎
  ├─ Buffer Pool：缓存数据页
  ├─ B+ 树索引：定位数据
  ├─ Undo Log：回滚、多版本
  ├─ Redo Log：崩溃恢复
  ├─ Lock / MVCC：并发控制
  └─ 磁盘文件：表空间、页、段、区、行记录
```

![](/blogs/mysql-innodb-underlying-mechanism/sql-execution-flow.png)

这些模块之间的关系可以概括为：

```text
存储结构 → 索引结构 → SQL 执行 → 事务日志 → MVCC → 锁 → 优化 → 主从/分库分表
```

很多常见结论，例如 ACID、索引失效、主从复制三线程，本质上都是底层机制推导出来的结果。分析这些问题时，可以从以下角度切入：

1. 数据在磁盘上到底怎么放？
2. 为什么 B+ 树能减少磁盘 IO？
3. 辅助索引为什么需要回表？
4. 为什么事务能回滚？
5. 为什么宕机后数据还能恢复？
6. 为什么普通 select 不会阻塞 update？
7. 为什么 RR 下能避免大部分幻读？
8. 为什么有索引还可能全表扫描？
9. 为什么写多了索引反而慢？
10. 为什么主从会延迟？

---

## 1. InnoDB 的存储底层：表空间、区、段、页、行

### 1.1 InnoDB 存储层级

InnoDB 不是“一行一行”地直接操作磁盘。它的存储层级大致是：

```text
表空间 Tablespace
  ↓
段 Segment
  ↓
区 Extent
  ↓
页 Page
  ↓
行 Record
```

### 表空间 Tablespace

表空间可以理解为 InnoDB 真正落盘的数据文件集合。

常见文件：

```text
.ibd  独立表空间文件，通常每张表一个
ibdata 共享表空间，老版本或特殊配置中常见
```

如果开启 `innodb_file_per_table`，每张 InnoDB 表通常会有自己的 `.ibd` 文件。这个文件里不只保存行数据，还保存索引数据。

### 段 Segment

段是为了管理不同用途的数据页。

常见段：

```text
数据段：保存 B+ 树叶子节点页
索引段：保存 B+ 树非叶子节点页
回滚段：保存 undo log 相关内容
```

### 区 Extent

一个区由多个连续页组成。InnoDB 默认页大小是 16KB，一个区通常是 1MB，也就是 64 个页。

```text
1 Page = 16KB
1 Extent = 64 Pages = 1MB
```

区的作用：让页尽量连续分配，减少随机 IO。

### 页 Page

页是 InnoDB 和磁盘交互的基本单位。

这句话非常关键：**InnoDB 不是每次读一行，而是每次至少读一页。**

默认情况下：

```text
1 页 = 16KB
```

哪怕你只查一条记录，只要这条记录所在页不在 Buffer Pool 里，InnoDB 也会把整个 16KB 页读入内存。

这解释了很多问题：

- 为什么 B+ 树高度越低越好？
- 为什么索引字段越小越好？
- 为什么主键不宜过长？
- 为什么覆盖索引快？
- 为什么范围查询更适合 B+ 树？
- 为什么一页能放更多索引项，树就更矮？

---

## 2. 数据页底层结构：一页里到底有什么？

一个 InnoDB 数据页大致包含：

```text
File Header
Page Header
Infimum + Supremum
User Records
Free Space
Page Directory
File Trailer
```

简化图：

```text
┌──────────────────────────┐
│ File Header              │  页的通用文件头
├──────────────────────────┤
│ Page Header              │  页内状态信息
├──────────────────────────┤
│ Infimum / Supremum       │  虚拟最小记录 / 最大记录
├──────────────────────────┤
│ User Records             │  真正的一行一行数据
│ record1 -> record2 -> ...│
├──────────────────────────┤
│ Free Space               │  空闲空间
├──────────────────────────┤
│ Page Directory           │  页目录，辅助页内二分查找
├──────────────────────────┤
│ File Trailer             │  校验页是否完整
└──────────────────────────┘
```

![](/blogs/mysql-innodb-underlying-mechanism/data-page-structure.png)

### 2.1 User Records：行记录区

行记录并不是简单数组。页内记录通常按照主键顺序组织，并通过单向链表连接。

```text
Infimum -> record1 -> record2 -> record3 -> Supremum
```

这意味着页内遍历可以按顺序走链表。

### 2.2 Page Directory：页目录

如果页内只有链表，那么在一个页里找记录只能从头遍历，效率不够好。

所以 InnoDB 在页尾维护 Page Directory，也就是页目录。

页目录把记录分组，每个槽位指向一组记录中的最大记录。查询时先在页目录里二分定位到某个组，再在组内顺序查找。

简化理解：

```text
页目录槽位：
slot0 -> record3
slot1 -> record8
slot2 -> record14
slot3 -> record20
```

查询主键 id = 12：

```text
先在 slot 中二分，定位到 record8 ~ record14 这一组
再在组内链表查找 id = 12
```

所以页内查找不是纯链表扫描，而是：

```text
页目录二分 + 组内链表遍历
```

### 2.3 页分裂

当一个页写满后，再插入新记录，就可能发生页分裂。

例如主键乱序插入：

```text
已有页：1 2 3 4 5 6 7 8
插入：0
```

如果原页空间不够，InnoDB 可能要申请新页，把部分记录挪过去，同时调整 B+ 树父节点指针。

页分裂的代价：

- 移动记录
- 修改页链表
- 修改父节点
- 写 redo log
- 影响缓存命中
- 可能造成磁盘碎片

这就是为什么 InnoDB 推荐使用 **递增、短小、稳定的主键**。

---

## 3. 行记录底层：一行数据长什么样？

InnoDB 行格式常见有：

```text
Compact
Redundant
Dynamic
Compressed
```

现代 MySQL 常用 `Dynamic` 或 `Compact`。

一行记录不是只有业务字段，还包含额外信息。

简化结构：

```text
变长字段长度列表
NULL 标记位
记录头信息
隐藏列
真实列数据
```

### 3.1 隐藏列

如果你建了一张表：

```sql
CREATE TABLE user (
  id BIGINT PRIMARY KEY,
  name VARCHAR(64),
  age INT
) ENGINE=InnoDB;
```

你看到的是：

```text
id, name, age
```

但 InnoDB 内部还可能有隐藏列：

```text
DB_TRX_ID      最近修改该行的事务 ID
DB_ROLL_PTR    回滚指针，指向 undo log 中的旧版本
DB_ROW_ID      隐藏行 ID，如果表没有显式主键才需要
```

其中：

```text
DB_TRX_ID + DB_ROLL_PTR
```

是 MVCC 的基础。

### 3.2 为什么建议一定要有主键？

如果你没有主键，InnoDB 会自己选择：

1. 优先使用第一个非空唯一索引作为聚簇索引；
2. 如果没有，就生成隐藏的 `DB_ROW_ID` 作为聚簇索引。

问题是隐藏主键你看不见，也不好控制；而且如果使用不合适的唯一索引作为聚簇索引，可能导致辅助索引更大、写入更慢。

推荐主键：

```text
短小：BIGINT 通常比 UUID 字符串更适合
递增：减少页分裂
稳定：不要频繁更新主键
唯一：主键基本要求
```

---

## 4. B+ 树底层：为什么 MySQL 用它做索引？

### 4.1 为什么不是二叉树？

二叉树每个节点最多两个孩子。如果数据量很大，树会很高。

树越高，查找时访问的节点越多；节点在磁盘上时，就可能产生更多磁盘 IO。

```text
1000 万数据
二叉树高度可能很高
B+ 树高度通常只有 3~4 层
```

数据库索引的核心目标不是 CPU 计算最快，而是 **尽量减少磁盘 IO**。

### 4.2 为什么不是红黑树？

红黑树是内存友好的结构，但不是磁盘友好的结构。

原因：

- 每个节点存的数据太少；
- 树高相对更高；
- 查询需要访问更多节点；
- 节点可能分布在不同磁盘页上。

InnoDB 的页默认 16KB，一个 B+ 树节点就是一个页。一页里可以放很多索引项，使树非常“矮胖”。

### 4.3 为什么不是 Hash？

Hash 等值查询很快，但有明显缺点：

```text
不支持范围查询
不支持排序
不支持最左前缀
不适合 order by
不适合范围扫描
```

数据库里很常见：

```sql
WHERE id BETWEEN 100 AND 200
ORDER BY create_time
WHERE name LIKE 'abc%'
```

这些都需要有序结构。

B+ 树天然有序，叶子节点之间还有链表，适合范围查询。

### 4.4 B 树和 B+ 树区别

B 树：

```text
非叶子节点和叶子节点都可以存数据
查询可能在任何层命中
范围查询需要中序遍历
```

B+ 树：

```text
只有叶子节点存完整数据或主键
非叶子节点只存索引键和指针
所有叶子节点用链表连接
范围查询非常方便
```

B+ 树优势：

1. 非叶子节点不存完整行，可以放更多 key，树更矮；
2. 查询路径稳定，最终都到叶子节点；
3. 叶子节点有序链表，范围查询快；
4. 更适合磁盘页读写。

![](/blogs/mysql-innodb-underlying-mechanism/btree-bplus-comparison.png)

---

## 5. 聚簇索引：InnoDB 表就是一棵 B+ 树

在 InnoDB 中，表数据本身就是按照主键组织的一棵 B+ 树。

这棵 B+ 树叫：

```text
聚簇索引 Clustered Index
```

特点：

```text
叶子节点存完整行数据
非叶子节点存主键值 + 页指针
数据按主键顺序组织
一张表只能有一个聚簇索引
```

简化图：

```text
        [10 | 20]
       /    |    \
 [1..9] [10..19] [20..30]
   ↓        ↓        ↓
完整行    完整行    完整行
```

### 5.1 聚簇索引查询过程

```sql
SELECT * FROM user WHERE id = 18;
```

执行过程：

```text
从根页开始
  ↓
根据 id = 18 找到下一层页
  ↓
继续定位到叶子页
  ↓
在叶子页中找到 id = 18 的完整行
```

如果树高是 3，大致需要访问：

```text
根页 → 中间页 → 叶子页
```

如果这些页都在 Buffer Pool 里，就是内存访问；如果不在，才会读磁盘。

### 5.2 主键为什么不能太长？

因为辅助索引的叶子节点存的是主键值。

如果主键是：

```text
BIGINT：8 字节
UUID 字符串：36 字符，可能占 36 字节甚至更多
```

那么每个辅助索引叶子节点都会更大。

影响：

```text
单页可存索引项变少
B+ 树高度可能变高
缓存命中率下降
磁盘 IO 增加
写入维护成本增加
```

所以主键设计不是“能唯一就行”，它会影响整张表所有二级索引。

---

![](/blogs/mysql-innodb-underlying-mechanism/clustered-vs-secondary-index.png)

## 6. 辅助索引：为什么会回表？

除了聚簇索引，其他索引都叫辅助索引，也叫二级索引、非聚簇索引。

例如：

```sql
CREATE INDEX idx_name ON user(name);
```

辅助索引的 B+ 树：

```text
非叶子节点：name + 页指针
叶子节点：name + 主键 id
```

注意：InnoDB 的辅助索引叶子节点一般不存完整行，而是存 **索引列 + 主键值**。

### 6.1 回表过程

```sql
SELECT * FROM user WHERE name = 'Tom';
```

如果使用 `idx_name`：

```text
1. 在 idx_name B+ 树中找到 name = 'Tom'
2. 得到对应主键 id = 18
3. 再去聚簇索引 B+ 树中查 id = 18
4. 找到完整行
```

第 3 步就是回表。

```text
辅助索引查询一次 + 聚簇索引查询一次 = 回表
```

### 6.2 覆盖索引

如果查询字段都在辅助索引里，就不需要回表。

```sql
SELECT id, name FROM user WHERE name = 'Tom';
```

`idx_name(name)` 的叶子节点里有：

```text
name + id
```

所以可以直接返回。

这叫覆盖索引：

```text
查询需要的字段被当前索引完全覆盖
```

优势：

```text
减少回表
减少随机 IO
减少读取完整行的成本
```

### 6.3 为什么 select * 容易慢？

因为 `select *` 往往需要完整行数据。

即使 where 条件走了辅助索引，也可能要大量回表：

```sql
SELECT * FROM order WHERE status = 1;
```

如果 `status = 1` 命中 100 万行，那就可能回表 100 万次。

优化器可能判断：

```text
走辅助索引 + 大量回表
```

还不如：

```text
直接全表扫描
```

这就是“有索引但不一定走索引”的底层原因。

---

## 7. 联合索引底层：最左前缀不是口诀，是排序规则

假设有联合索引：

```sql
CREATE INDEX idx_bcd ON t(b, c, d);
```

这棵 B+ 树不是分别给 b、c、d 建三棵树，而是一棵按照 `(b,c,d)` 组合排序的 B+ 树。

排序规则：

```text
先按 b 排序
b 相同，再按 c 排序
c 相同，再按 d 排序
```

类似字典排序：

```text
(1,1,1)
(1,1,2)
(1,2,1)
(2,1,1)
(2,2,1)
```

### 7.1 为什么能用最左前缀？

因为联合索引的有序性从最左列开始。

可用：

```sql
WHERE b = 1
WHERE b = 1 AND c = 2
WHERE b = 1 AND c = 2 AND d = 3
```

原因：这些条件都能利用 `(b,c,d)` 的连续有序性。

不可直接高效使用完整索引：

```sql
WHERE c = 2
WHERE d = 3
WHERE c = 2 AND d = 3
```

原因：如果不知道 b，c 和 d 在整棵树上不是全局连续的。

### 7.2 where 条件顺序不重要

下面两个 SQL 对优化器来说通常等价：

```sql
WHERE b = 1 AND c = 2
WHERE c = 2 AND b = 1
```

最左前缀看的是索引定义：

```text
idx_bcd(b, c, d)
```

不是 where 书写顺序。

### 7.3 范围条件会影响后续列使用

```sql
WHERE b = 1 AND c > 10 AND d = 3
```

通常可以利用：

```text
b = 1
c > 10
```

但 `d = 3` 很难继续用于精确定位。

原因：`c > 10` 是范围扫描，范围内的 d 不再是一个可直接定位的连续整体。

不过在某些版本和场景下，索引下推 ICP 仍然可以在存储引擎层用 d 做过滤，但它和“继续精确定位索引范围”不是一回事。

---

## 8. 索引下推 ICP：减少回表的过滤优化

索引下推，全称：

```text
Index Condition Pushdown
```

它的核心作用是：

```text
把部分 where 条件下推到存储引擎层，在索引遍历阶段先过滤，减少回表次数
```

假设索引：

```sql
CREATE INDEX idx_name_age ON user(name, age);
```

SQL：

```sql
SELECT * FROM user
WHERE name LIKE '张%' AND age = 20;
```

没有 ICP 时可能是：

```text
1. 用 name LIKE '张%' 找到一批索引项
2. 对每条索引项都回表
3. Server 层判断 age = 20
```

有 ICP 时：

```text
1. 用 name LIKE '张%' 找到一批索引项
2. 在索引里先判断 age = 20
3. 满足条件的才回表
```

区别：

```text
ICP 不一定减少扫描索引的数量
但可以减少回表数量
```

---

## 9. 索引失效：底层原因不是“规则”，而是破坏有序性或成本太高

常见索引失效场景：

### 9.1 对索引列使用函数

```sql
WHERE DATE(create_time) = '2026-05-29'
```

如果索引是：

```sql
INDEX(create_time)
```

B+ 树里存的是原始 `create_time` 的有序值，不是 `DATE(create_time)` 的结果。

对列做函数，相当于要把每个值计算后再比较，无法直接利用原本有序性。

改法：

```sql
WHERE create_time >= '2026-05-29 00:00:00'
  AND create_time <  '2026-05-30 00:00:00'
```

### 9.2 隐式类型转换

字段是字符串：

```sql
phone VARCHAR(20)
```

错误写法：

```sql
WHERE phone = 13800138000
```

MySQL 可能会把字段值转换成数字再比较，这会导致索引难以正常使用。

正确写法：

```sql
WHERE phone = '13800138000'
```

### 9.3 LIKE 左模糊

```sql
WHERE name LIKE '%abc'
```

B+ 树按从左到右排序。左边不确定，就无法定位起点。

可用：

```sql
WHERE name LIKE 'abc%'
```

### 9.4 OR 条件

```sql
WHERE a = 1 OR b = 2
```

如果 a 有索引但 b 没索引，优化器可能放弃索引。

因为最终需要合并两个条件结果，如果其中一边全表扫描，整体可能不划算。

### 9.5 选择性太差

```sql
WHERE gender = 'M'
```

如果表里一半都是 M，走索引可能要回表大量数据，不如全表扫描。

所以低基数字段不一定适合单独建索引。

---

## 10. SQL 执行底层：优化器到底在选什么？

SQL 执行大致分三层：

```text
Server 层：解析、优化、执行调度
存储引擎层：索引查找、行读取、加锁、MVCC
磁盘/内存层：Buffer Pool、数据页、日志
```

### 10.1 优化器的核心任务

优化器不是机械地“有索引就用索引”，而是估算成本。

它会考虑：

```text
扫描多少行？
是否需要回表？
是否需要排序？
是否需要临时表？
索引选择性如何？
数据页是否可能在缓存里？
join 顺序怎么选？
```

所以会出现：

```text
明明有索引，却走全表扫描
```

本质原因：

```text
优化器认为全表扫描成本更低
```

### 10.2 EXPLAIN 看什么？

常看字段：

```text
type          访问类型
possible_keys 可能用到的索引
key           实际使用的索引
rows          预估扫描行数
filtered      预估过滤比例
Extra         额外信息
```

访问类型从好到差大致：

```text
system
const
eq_ref
ref
range
index
ALL
```

重点解释：

```text
const：主键或唯一索引等值查询，最多一行
ref：普通非唯一索引等值查询
range：范围查询
index：扫描整个索引树
ALL：全表扫描
```

Extra 常见：

```text
Using index        覆盖索引
Using where        Server 层还要过滤
Using index condition  索引下推
Using filesort     需要额外排序，不一定真的写文件
Using temporary    使用临时表
```

---

## 11. Buffer Pool：为什么数据库不是直接读磁盘？

InnoDB 的数据页和索引页都会被缓存到 Buffer Pool。

查询时：

```text
先查 Buffer Pool
  ↓ 命中
直接读内存页

未命中
  ↓
从磁盘读取页到 Buffer Pool
```

### 11.1 Buffer Pool 里有什么？

```text
数据页
索引页
undo 页
change buffer 页
自适应哈希索引相关结构
锁信息等
```

### 11.2 脏页

如果修改了一行数据，InnoDB 不是立即把数据页刷回磁盘，而是：

```text
1. 修改 Buffer Pool 里的数据页
2. 这个页变成脏页
3. 写 redo log 保证崩溃恢复
4. 之后由后台线程慢慢刷脏页
```

这就是 WAL 思想：

```text
Write-Ahead Logging
先写日志，再写数据页
```

### 11.3 LRU 和预读

Buffer Pool 空间有限，需要淘汰旧页。

InnoDB 使用改进版 LRU，不是简单最近最少使用。

原因：如果一次全表扫描把大量冷数据页读进来，可能把热点页挤出去，造成缓存污染。

所以 InnoDB 会把 LRU 分成 young 区和 old 区，尽量保护热点页。

---

## 12. Change Buffer：为什么普通二级索引写入能缓冲？

当更新一个二级索引页时，如果这个页不在 Buffer Pool 中，直接读磁盘页再修改会产生随机 IO。

Change Buffer 的作用：

```text
对非唯一二级索引的变更，如果目标页不在内存中，可以先缓存在 Change Buffer 中
等以后该页被读入内存时再合并
```

适用：

```text
非唯一二级索引
写多读少场景
```

不适用：

```text
唯一索引
```

原因：唯一索引必须检查唯一性，必须读页确认是否冲突。

---

## 13. Redo Log：崩溃恢复的核心

### 13.1 为什么需要 redo log？

如果每次 update 都直接把数据页写回磁盘，会非常慢，因为数据页位置随机，随机 IO 成本高。

InnoDB 采用：

```text
先改内存页
再顺序写 redo log
后台慢慢刷脏页
```

redo log 是物理日志，记录的是：

```text
某个表空间、某个页、某个偏移量做了什么修改
```

它用于崩溃恢复。

### 13.2 WAL 过程

```sql
UPDATE user SET age = 20 WHERE id = 1;
```

大致过程：

```text
1. 找到 id = 1 所在数据页
2. 如果页不在 Buffer Pool，读入内存
3. 修改 Buffer Pool 中的记录
4. 生成 undo log，用于回滚和 MVCC
5. 生成 redo log，记录物理修改
6. redo log 写入 redo log buffer
7. 提交时按策略刷 redo log 到磁盘
8. 返回成功
9. 后台线程稍后刷脏页
```

![](/blogs/mysql-innodb-underlying-mechanism/wal-two-phase-commit.png)

如果第 8 步后 MySQL 崩溃，数据页可能还没刷盘，但 redo log 已经刷盘。重启后可以根据 redo log 重做修改。

这就是持久性的基础。

### 13.3 redo log 和 binlog 的两阶段提交

MySQL 有两套日志：

```text
redo log：InnoDB 引擎层日志，用于崩溃恢复
binlog：Server 层日志，用于主从复制、数据恢复
```

问题：一个事务提交时，要同时保证 redo log 和 binlog 一致。

否则可能出现：

```text
redo log 写了，binlog 没写
主库有数据，从库没数据
```

或者：

```text
binlog 写了，redo log 没写
从库有数据，主库崩溃恢复后没有
```

所以 MySQL 使用两阶段提交：

```text
1. redo log prepare
2. 写 binlog
3. redo log commit
```

崩溃恢复时根据 redo log 和 binlog 状态判断事务是否提交。

---

## 14. Undo Log：回滚和 MVCC 的基础

undo log 记录的是逻辑上的反向操作。

例如：

```sql
UPDATE user SET age = 20 WHERE id = 1;
```

如果原来 age = 18，undo log 里会记录类似：

```text
把 age 改回 18
```

作用：

```text
事务回滚
MVCC 读取旧版本
```

### 14.1 update 的版本链

一行记录内部有：

```text
DB_TRX_ID
DB_ROLL_PTR
```

每次修改记录：

```text
1. 当前记录写入新的事务 ID
2. 旧版本写入 undo log
3. 当前记录的 DB_ROLL_PTR 指向旧版本
```

多次修改形成版本链：

```text
当前版本 trx_id=100
  ↓ roll_ptr
旧版本 trx_id=90
  ↓ roll_ptr
更旧版本 trx_id=80
```

MVCC 读数据时，就沿着版本链找对当前事务可见的版本。

### 14.2 undo log 什么时候删除？

不能事务一提交就删。

因为可能还有老事务需要读旧版本。

例如：

```text
事务 A 很早开启，还没提交
事务 B 修改并提交了很多数据
```

事务 A 做一致性读时，可能还要通过 undo log 看到旧版本。

所以 undo log 需要等没有 Read View 依赖它时，由 purge 线程清理。

这也是为什么长事务很危险：

```text
长事务会阻止 undo log 清理
导致历史版本堆积
影响性能和空间
```

---

## 15. MVCC：多版本并发控制

MVCC，全称：

```text
Multi-Version Concurrency Control
多版本并发控制
```

它解决的问题：

```text
读写并发时，读不阻塞写，写不阻塞普通一致性读
```

普通 select 通常不加锁，而是读快照版本。

### 15.1 MVCC 三个核心

```text
隐藏字段：DB_TRX_ID、DB_ROLL_PTR
undo log：保存旧版本
Read View：判断版本可见性
```

### 15.2 Read View 里有什么？

Read View 可以理解为事务开始读取时的一张“活跃事务快照”。

核心字段：

```text
m_ids       创建 Read View 时活跃事务 ID 列表
min_trx_id  活跃事务中最小事务 ID
max_trx_id  下一个将要分配的事务 ID
creator_trx_id 当前事务 ID
```

### 15.3 可见性判断简化版

一行版本的事务 ID 记为 `trx_id`。

判断规则：

```text
trx_id == creator_trx_id
  当前事务自己改的，可见

trx_id < min_trx_id
  说明创建 Read View 前已经提交，可见

trx_id >= max_trx_id
  说明创建 Read View 后才出现，不可见

min_trx_id <= trx_id < max_trx_id
  如果 trx_id 在 m_ids 中，说明创建 Read View 时还未提交，不可见
  如果不在 m_ids 中，说明已经提交，可见
```

如果当前版本不可见，就沿着 undo log 版本链找旧版本。

![](/blogs/mysql-innodb-underlying-mechanism/mvcc-version-chain.png)

---

## 16. RC 和 RR 的底层区别

MySQL InnoDB 默认隔离级别通常是：

```text
REPEATABLE READ
可重复读
```

### 16.1 Read Committed

RC，读已提交。

特点：

```text
每次普通 select 都生成新的 Read View
```

所以同一个事务里两次查询，可能看到不同结果。

```text
事务 A 第一次查：age = 18
事务 B 修改 age = 20 并提交
事务 A 第二次查：age = 20
```

这就是不可重复读。

### 16.2 Repeatable Read

RR，可重复读。

特点：

```text
一个事务中第一次普通 select 生成 Read View
后续普通 select 复用这个 Read View
```

所以同一个事务里多次读取结果一致。

```text
事务 A 第一次查：age = 18
事务 B 修改 age = 20 并提交
事务 A 第二次查：仍然 age = 18
```

### 16.3 快照读和当前读

快照读：

```sql
SELECT * FROM user WHERE id = 1;
```

通常使用 MVCC，不加锁，读取快照版本。

当前读：

```sql
SELECT * FROM user WHERE id = 1 FOR UPDATE;
SELECT * FROM user WHERE id = 1 LOCK IN SHARE MODE;
UPDATE user SET age = 20 WHERE id = 1;
DELETE FROM user WHERE id = 1;
INSERT INTO user ...
```

当前读读取最新已提交版本，并且可能加锁。

面试里一定要区分：

```text
普通 select 走 MVCC
update/delete/select for update 是当前读，会加锁
```

---

## 17. 幻读：为什么 RR 下还要 Next-Key Lock？

幻读指：

```text
同一个事务中，两次范围查询，第二次多出了第一次没有的行
```

例如：

```sql
事务 A:
SELECT * FROM user WHERE age BETWEEN 10 AND 20;

事务 B:
INSERT INTO user(age) VALUES(15);
COMMIT;

事务 A:
SELECT * FROM user WHERE age BETWEEN 10 AND 20;
```

第二次多出来 age=15，就是幻读。

### 17.1 快照读下的幻读

在 RR 隔离级别下，普通 select 使用同一个 Read View，所以通常看不到新插入的数据。

也就是说快照读层面，RR 已经避免了幻读。

### 17.2 当前读下的幻读

但是当前读读的是最新版本。

```sql
SELECT * FROM user WHERE age BETWEEN 10 AND 20 FOR UPDATE;
```

如果只锁已有记录，不锁记录之间的间隙，其他事务仍然可以插入 age=15。

所以 InnoDB 用：

```text
Record Lock：记录锁
Gap Lock：间隙锁
Next-Key Lock：记录锁 + 间隙锁
```

来阻止范围内插入新记录。

---

## 18. InnoDB 锁底层：行锁、间隙锁、Next-Key Lock

### 18.1 行锁是锁索引，不是直接锁行

InnoDB 的行锁是加在索引记录上的。

这点非常重要。

如果 where 条件能走索引：

```sql
UPDATE user SET name='A' WHERE id = 1;
```

只锁 id=1 这条索引记录。

如果 where 条件不走索引：

```sql
UPDATE user SET name='A' WHERE no_index_col = 1;
```

可能扫描大量记录并加锁，甚至看起来像“锁表”。

所以：

```text
行锁依赖索引
不走索引可能导致锁范围扩大
```

### 18.2 共享锁和排他锁

共享锁 S Lock：

```text
多个事务可以同时持有共享锁
共享锁之间兼容
共享锁和排他锁冲突
```

排他锁 X Lock：

```text
一个事务持有排他锁后，其他事务不能再加共享锁或排他锁
```

常见语句：

```sql
SELECT ... LOCK IN SHARE MODE; -- 共享锁
SELECT ... FOR UPDATE;          -- 排他锁
UPDATE / DELETE                 -- 排他锁
```

### 18.3 Record Lock

锁住某一条索引记录。

```text
锁记录本身
```

### 18.4 Gap Lock

锁住两个索引记录之间的间隙。

例如索引里有：

```text
10, 20, 30
```

间隙包括：

```text
(-∞, 10)
(10, 20)
(20, 30)
(30, +∞)
```

Gap Lock 锁的是“范围”，不锁具体已有记录。

作用：

```text
防止其他事务往间隙里插入新记录
```

### 18.5 Next-Key Lock

Next-Key Lock = Record Lock + Gap Lock。

锁的是：

```text
左开右闭区间
```

例如：

```text
(10, 20]
```

既锁住 20 这条记录，也锁住 10 到 20 的间隙。

作用：

```text
解决当前读下的幻读问题
```

![](/blogs/mysql-innodb-underlying-mechanism/next-key-lock.png)

### 18.6 插入意向锁

Insert Intention Lock 是插入时使用的一种特殊间隙锁。

多个事务如果插入到同一个间隙的不同位置，插入意向锁之间通常不冲突。

例如间隙：

```text
(10, 20)
```

事务 A 插入 12，事务 B 插入 15，它们可以并发。

但如果有事务持有这个间隙的 Gap Lock，就会阻塞插入。

---

## 19. 死锁底层：为什么发生，怎么排查？

死锁例子：

```text
事务 A 锁住 id=1
事务 B 锁住 id=2
事务 A 想锁 id=2，等待 B
事务 B 想锁 id=1，等待 A
```

形成循环等待。

### 19.1 死锁产生条件

```text
互斥
占有且等待
不可抢占
循环等待
```

数据库中常见原因：

```text
多个事务更新顺序不一致
范围锁重叠
索引不合适导致锁范围扩大
批量更新数据量太大
```

### 19.2 如何减少死锁？

```text
统一访问顺序
小事务，尽快提交
where 条件尽量走索引
避免大范围更新
降低不必要的锁范围
必要时拆批
合理设计唯一索引
```

### 19.3 如何排查？

常用命令：

```sql
SHOW ENGINE INNODB STATUS;
```

关注：

```text
LATEST DETECTED DEADLOCK
事务持有哪些锁
事务等待哪些锁
执行的 SQL
锁在哪个索引上
```

重点是看：

```text
锁的是哪个索引
锁范围多大
为什么没有精准命中
```

---

## 20. 事务 ACID 底层如何保证？

ACID：

```text
Atomicity     原子性
Consistency   一致性
Isolation     隔离性
Durability    持久性
```

不要只背中文，要能说底层机制。

### 20.1 原子性：undo log

事务要么全部成功，要么全部失败。

如果执行到一半失败，需要回滚。

靠：

```text
undo log
```

### 20.2 持久性：redo log

事务提交后，即使宕机也不能丢。

靠：

```text
redo log + WAL
```

### 20.3 隔离性：锁 + MVCC

不同事务之间不能互相乱影响。

靠：

```text
锁机制：解决写写冲突、当前读幻读
MVCC：解决读写并发、一致性读
```

### 20.4 一致性：最终目标

一致性不是单独某一个日志保证的，而是事务机制、约束、业务逻辑共同保证的结果。

数据库能保证：

```text
主键唯一
外键约束
非空约束
事务回滚
隔离级别
```

业务也要保证：

```text
余额不能扣成负数
库存不能超卖
订单状态不能乱跳
```

所以严谨回答：

```text
原子性由 undo log 保证；
持久性由 redo log 保证；
隔离性由锁和 MVCC 保证；
一致性是事务追求的目标，由 A/I/D、数据库约束和业务逻辑共同保证。
```

---

## 21. Binlog、Redo Log、Undo Log 对比

| 日志 | 所属层 | 类型 | 主要作用 |
|---|---|---|---|
| undo log | InnoDB | 逻辑日志 | 回滚、MVCC |
| redo log | InnoDB | 物理日志 | 崩溃恢复 |
| binlog | Server 层 | 逻辑日志 | 主从复制、时间点恢复 |

### 21.1 redo log 和 binlog 区别

redo log：

```text
InnoDB 独有
循环写
记录物理页修改
用于崩溃恢复
```

binlog：

```text
Server 层
追加写
记录逻辑变更
用于主从复制和数据恢复
```

### 21.2 binlog 三种格式

```text
STATEMENT：记录 SQL 语句
ROW：记录行变更
MIXED：混合模式
```

ROW 更常用，因为更安全、复制更准确，但日志量更大。

---

## 22. 慢 SQL 底层优化思路

慢 SQL 不要上来就说“加索引”。

应该按链路排查：

```text
SQL 写法
  ↓
执行计划
  ↓
索引设计
  ↓
扫描行数
  ↓
回表次数
  ↓
排序/临时表
  ↓
锁等待
  ↓
Buffer Pool 命中
  ↓
磁盘 IO / CPU / 网络
  ↓
表结构和架构设计
```

### 22.1 第一步：看执行计划

```sql
EXPLAIN SELECT ...
```

关注：

```text
type 是否是 ALL
key 是否为预期索引
rows 是否过大
Extra 是否有 filesort / temporary
是否 Using index
是否 Using index condition
```

### 22.2 第二步：看索引是否合理

好索引应该符合：

```text
高选择性字段靠前
常用于等值匹配的字段靠前
范围字段尽量靠后
排序字段尽量纳入索引
查询字段尽量被覆盖
```

### 22.3 第三步：减少回表

从：

```sql
SELECT * FROM order WHERE user_id = 1;
```

改为：

```sql
SELECT id, status, amount FROM order WHERE user_id = 1;
```

然后设计覆盖索引：

```sql
CREATE INDEX idx_user_status_amount ON order(user_id, status, amount);
```

注意：索引不是越多越好。每个索引都是一棵 B+ 树，写入时都要维护。

### 22.4 第四步：避免额外排序

如果经常：

```sql
WHERE user_id = ?
ORDER BY create_time DESC
LIMIT 20
```

可以考虑：

```sql
INDEX(user_id, create_time)
```

这样能先按 user_id 定位，再按 create_time 顺序扫描。

### 22.5 第五步：分页优化

慢分页：

```sql
SELECT * FROM order ORDER BY id LIMIT 1000000, 20;
```

问题：

```text
要跳过 1000000 行
```

优化：

```sql
SELECT * FROM order
WHERE id > last_id
ORDER BY id
LIMIT 20;
```

或者先用覆盖索引查 id，再回表：

```sql
SELECT * FROM order o
JOIN (
  SELECT id FROM order ORDER BY id LIMIT 1000000, 20
) t ON o.id = t.id;
```

---

## 23. 主从复制底层

MySQL 主从复制主要依赖 binlog。

经典流程：

```text
主库提交事务，写 binlog
  ↓
从库 IO 线程连接主库
  ↓
主库 dump 线程发送 binlog
  ↓
从库 IO 线程写 relay log
  ↓
从库 SQL 线程读取 relay log 并重放
```

简图：

```text
Master
  ├─ binlog
  └─ dump thread
        ↓
Slave
  ├─ IO thread → relay log
  └─ SQL thread → apply
```

![](/blogs/mysql-innodb-underlying-mechanism/master-slave-replication.png)

### 23.1 为什么主从会延迟？

原因：

```text
主库写入太快
从库 SQL 线程重放慢
大事务执行时间长
从库机器性能差
网络延迟
锁等待
从库并行复制配置不足
```

### 23.2 主从复制类型

异步复制：

```text
主库提交不等从库确认
性能好，但可能丢数据
```

半同步复制：

```text
主库至少等一个从库确认收到日志后再返回
降低数据丢失风险
性能略受影响
```

全同步复制：

```text
所有节点确认后才提交
一致性强，性能成本高
```

---

## 24. 分库分表底层问题

分库分表不是银弹。它解决的是单库单表容量和并发瓶颈，但会引入复杂性。

### 24.1 什么时候考虑分表？

大致信号：

```text
单表数据量过大
索引高度增加
查询扫描行数过多
DDL 成本很高
历史数据占比太大
冷热数据明显
```

不要只看“多少万行”。字段宽度、索引数量、查询模式、机器配置都会影响。

### 24.2 分表带来的问题

```text
分布式 ID
跨库 join
跨库事务
分页排序
聚合查询
全局唯一约束
数据迁移
扩容 re-sharding
```

### 24.3 分片键选择

好的分片键：

```text
查询经常带上
分布均匀
不容易变更
能避免热点
```

常见：

```text
user_id
tenant_id
order_id
```

不好的分片键：

```text
低基数字段，如 status
频繁变化字段
查询很少带的字段
```

---

## 25. 分布式 ID 底层方案

### 25.1 UUID

优点：

```text
本地生成
性能高
几乎全局唯一
```

缺点：

```text
太长
无序
作为主键会导致页分裂
索引占用大
可读性差
```

不适合作 InnoDB 聚簇主键，尤其是字符串 UUID。

### 25.2 数据库自增步长

多个库设置不同起点和步长：

```text
DB1: 1, 3, 5, 7...
DB2: 2, 4, 6, 8...
```

优点：

```text
简单
趋势递增
```

缺点：

```text
扩容麻烦
依赖数据库
性能有限
```

### 25.3 Redis INCR

优点：

```text
性能高
递增
实现简单
```

缺点：

```text
依赖 Redis
需要考虑持久化和高可用
```

### 25.4 Snowflake

典型结构：

```text
符号位 + 时间戳 + 机器 ID + 序列号
```

优点：

```text
趋势递增
性能高
不依赖数据库
适合分布式
```

缺点：

```text
依赖时钟
机器 ID 管理复杂
时钟回拨要处理
```

---

## 26. 底层高频问题的底层回答方式

### 26.1 问：MySQL 为什么用 B+ 树？

可以这样展开：

```text
第一，数据库索引主要瓶颈是磁盘 IO，不只是 CPU 比较。
第二，B+ 树节点对应 InnoDB 页，一页能存很多 key，所以树高低。
第三，B+ 树非叶子节点只存 key 和指针，比 B 树更适合降低树高。
第四，所有数据在叶子节点，叶子节点之间有链表，范围查询和排序更友好。
第五，Hash 虽然等值快，但不支持范围和排序，所以不适合作为通用索引结构。
```

### 26.2 问：聚簇索引和非聚簇索引区别？

可以这样展开：

```text
InnoDB 中聚簇索引就是按主键组织的 B+ 树，叶子节点存完整行数据。
辅助索引也是 B+ 树，但叶子节点存索引列和主键值。
所以通过辅助索引查非索引字段时，需要先查辅助索引得到主键，再查聚簇索引，这就是回表。
聚簇索引一张表只能有一个，因为数据只能按一种顺序物理组织；辅助索引可以有多个。
```

### 26.3 问：MVCC 是什么？

可以这样展开：

```text
MVCC 是多版本并发控制，用来实现普通读和写之间不互相阻塞。
InnoDB 通过隐藏字段 DB_TRX_ID、DB_ROLL_PTR、undo log 版本链和 Read View 实现。
每次修改会生成新版本，旧版本放到 undo log，并通过 roll pointer 串成版本链。
查询时根据 Read View 判断当前版本是否可见，不可见就沿版本链找旧版本。
RC 和 RR 的主要区别是 Read View 生成时机不同：RC 每次 select 生成，RR 通常事务内第一次 select 生成后复用。
```

### 26.4 问：ACID 怎么保证？

可以这样展开：

```text
原子性依赖 undo log，失败时可以按反向日志回滚。
持久性依赖 redo log，提交后即使脏页没刷盘，也可以崩溃恢复。
隔离性依赖 MVCC 和锁，普通读用 MVCC，当前读和写冲突用锁。
一致性是最终目标，由原子性、隔离性、持久性、数据库约束和业务逻辑共同保证。
```

### 26.5 问：为什么有索引还慢？

可以这样展开：

```text
第一，可能没有真正用上索引，比如函数、隐式转换、左模糊、最左前缀不满足。
第二，可能用了索引但扫描范围太大。
第三，可能大量回表，导致随机 IO 成本高。
第四，可能需要 filesort 或 temporary。
第五，可能锁等待、Buffer Pool 命中率低、磁盘 IO 或 CPU 瓶颈。
所以要结合 EXPLAIN、慢日志、扫描行数、回表次数和系统指标排查。
```

---


## 27. 理解 MySQL 底层机制的判断标准

如果你只会说：

```text
MySQL 用 B+ 树
聚簇索引叶子节点存数据
MVCC 通过版本链和 Read View 实现
redo log 保证持久性
undo log 保证原子性
```

这仍然偏概念层面。

更深入的理解，体现在能继续追问并解释：

```text
B+ 树节点为什么刚好适合页？
为什么非叶子节点不存完整行能降低树高？
辅助索引为什么存主键而不是行地址？
回表为什么可能导致优化器放弃索引？
Read View 为什么 RC 和 RR 表现不同？
undo log 为什么不能事务提交后立刻删除？
Gap Lock 为什么锁的是间隙而不是记录？
为什么行锁锁的是索引？
redo log 已经有了，为什么还要 binlog？
主从延迟为什么经常卡在从库 SQL 重放？
```

理解 MySQL 底层机制的关键，不是堆叠名词，而是把这些机制串成一条链路：

```text
页 → B+ 树 → 索引 → 执行计划 → Buffer Pool → undo/redo → MVCC/锁 → 复制/分片
```

把这条链路讲顺，很多看似分散的问题都会变成同一套底层机制的不同切面。