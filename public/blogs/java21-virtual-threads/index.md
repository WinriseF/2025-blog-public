# Java 21 虚拟线程：它到底解决了什么问题

---

Java 21 里，虚拟线程正式发布。这个名字听起来很底层，但它解决的是一个很直观的问题：程序经常不是一直在计算，而是在等待。

比如一个网站同时来了很多请求，每个请求可能都要等数据库、等远程接口、等文件读取。传统线程在等待时也会占着系统资源；虚拟线程的价值，就是让这些“正在等待”的任务变得更轻，不必每一个都长期占住昂贵的操作系统线程。

这篇文章从这个问题讲起，介绍虚拟线程是什么、为什么 Java 21 要把它正式带进来、它适合解决哪些场景，以及使用时有哪些边界。

![Java 21 虚拟线程概览](/blogs/java21-virtual-threads/virtual-threads-overview.png)

---

## 1. 为什么 Java 需要虚拟线程

传统 Java 服务端通常有两种并发写法。

第一种是线程按请求分配。一个请求进来，分配一个线程，从 Controller、Service、Repository 一路执行到返回响应。它的优点是代码直观，调试友好，异常栈清楚，日志上下文也容易跟踪。缺点是平台线程通常一对一绑定操作系统线程，数量受 OS 线程成本限制。请求越多，线程越多，内存、调度和上下文切换成本越高。

第二种是异步或响应式。请求在等待数据库、Redis、HTTP 调用时释放线程，把后续逻辑注册成回调、`CompletableFuture` 链或者响应式流水线。它能提升线程利用率，但代码会从顺序流程变成分段流程。异常处理、调用栈、日志上下文、调试体验都会变复杂。

虚拟线程要解决的是这个矛盾：

| 目标 | 传统平台线程 | 异步/响应式 | 虚拟线程 |
|---|---|---|---|
| 保持同步代码 | 好 | 差 | 好 |
| 支持大量并发 I/O | 受线程数限制 | 好 | 好 |
| 调试和栈追踪 | 好 | 较复杂 | 好 |
| 代码侵入性 | 低 | 高 | 低 |
| 适合 CPU 密集任务 | 可以，但受核心数限制 | 可以，但不一定更简单 | 没有额外收益 |

虚拟线程的核心价值不是替代所有并发模型，而是让“一个任务一个线程”的模型重新变得可扩展。

---

## 2. 虚拟线程是什么

在 Java 21 中，虚拟线程仍然是 `java.lang.Thread` 的实例。它不是新的语言语法，也不是另一个和 `Thread` 无关的协程类型。

区别在于：

| 类型 | 调度者 | 与 OS 线程关系 | 成本 | 典型用途 |
|---|---|---|---|---|
| 平台线程 | 操作系统 | 通常 1:1 绑定 OS 线程 | 高 | CPU 计算、少量长生命周期任务、传统线程池 |
| 虚拟线程 | JVM | 多个虚拟线程复用少量平台线程 | 低 | 大量短生命周期、经常阻塞等待的任务 |

可以把虚拟线程理解为 JVM 管理的轻量级线程。一个虚拟线程执行 Java 代码时，会被挂载到某个底层平台线程上。这个底层平台线程通常被称为 carrier thread。虚拟线程遇到支持的阻塞 I/O 时，JVM 可以把它从 carrier 上卸载，carrier 继续执行其他虚拟线程。等 I/O 就绪后，虚拟线程再被调度回来继续执行。

这个过程对业务代码是透明的。你写的仍然是普通阻塞代码：

```java
String body = httpClient.send(request, HttpResponse.BodyHandlers.ofString()).body();
```

当这段代码在虚拟线程中执行并等待网络 I/O 时，等待本身不需要长期占住一个平台线程。这就是虚拟线程能提高 I/O 密集型服务吞吐的根本原因。

---

## 3. Java 21 里的关键特性

### 3.1 正式发布，不再是预览特性

虚拟线程最早在 JDK 19 以预览特性出现，在 JDK 20 再次预览，最终通过 JEP 444 在 JDK 21 正式发布。Java 21 是 LTS 版本，这意味着虚拟线程可以进入长期维护项目的技术选型，而不再只是实验性质的能力。

Java 21 中的几个重要点：

1. `Thread.ofVirtual()` 用于创建虚拟线程 builder。
2. `Thread.startVirtualThread(Runnable)` 可以快速创建并启动虚拟线程。
3. `Executors.newVirtualThreadPerTaskExecutor()` 创建“每个任务一个虚拟线程”的 `ExecutorService`。
4. 虚拟线程支持 `ThreadLocal` 和 `InheritableThreadLocal`，方便迁移已有代码。
5. JDK 调试、JFR、线程 dump 对虚拟线程做了支持，但部分传统线程统计 API 仍主要面向平台线程。

### 3.2 它是 daemon thread

虚拟线程总是 daemon thread，不能改成非 daemon。它不会阻止 JVM 退出。

这在普通 Web 服务里通常不是问题，因为应用还有主线程、容器线程或其他非 daemon 线程。但在只靠定时任务、后台任务维持进程的程序里要注意：如果所有剩余线程都是虚拟线程，JVM 可以直接退出。

### 3.3 它没有默认名字

平台线程通常会有自动生成的名字，而虚拟线程默认名字可以是空字符串。生产环境建议给关键虚拟线程 factory 设置前缀，方便日志和线程 dump 识别。

```java
ThreadFactory factory = Thread.ofVirtual()
	.name("order-fetch-", 0)
	.factory();
```

---

## 4. 最小用法：直接创建虚拟线程

最直接的写法是 `Thread.ofVirtual().start(...)`：

```java
public class VirtualThreadHello {
	public static void main(String[] args) throws InterruptedException {
		Thread thread = Thread.ofVirtual()
			.name("fetch-user-profile")
			.start(() -> {
				Thread current = Thread.currentThread();
				System.out.printf("name=%s, virtual=%s%n", current.getName(), current.isVirtual());
			});

		thread.join();
	}
}
```

运行：

```powershell
javac VirtualThreadHello.java
java VirtualThreadHello
```

可能输出：

```text
name=fetch-user-profile, virtual=true
```

如果只是临时启动一个任务，也可以用便捷方法：

```java
Thread thread = Thread.startVirtualThread(() -> {
	System.out.println(Thread.currentThread().isVirtual());
});
thread.join();
```

直接操作 `Thread` 适合演示、少量后台任务或自定义线程工厂。真实业务里，更常见的是交给 `ExecutorService` 管理。

---

## 5. 推荐入口：每个任务一个虚拟线程

Java 21 提供了 `Executors.newVirtualThreadPerTaskExecutor()`：

```java
import java.time.Duration;
import java.util.concurrent.Executors;
import java.util.stream.IntStream;

public class ManyBlockingTasks {
	public static void main(String[] args) {
		long started = System.currentTimeMillis();

		try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
			IntStream.range(0, 10_000).forEach(i ->
				executor.submit(() -> {
					Thread.sleep(Duration.ofSeconds(1));
					return i;
				})
			);
		}

		long elapsed = System.currentTimeMillis() - started;
		System.out.println("elapsed = " + elapsed + "ms");
	}
}
```

这里创建了 10,000 个任务，每个任务睡眠 1 秒。睡眠可以近似模拟“等待 I/O”。在虚拟线程模型下，这类任务不需要 10,000 个 OS 线程来支撑。

注意这个 executor 的语义：

1. 每提交一个任务，就创建并启动一个新的虚拟线程。
2. 线程数量是不固定上限的。
3. `try-with-resources` 退出时会关闭 executor，并等待已提交任务结束。
4. 它不是线程池。它不会复用虚拟线程。

这点很重要：虚拟线程便宜，所以不应该池化。一个虚拟线程对应一个应用任务，任务结束，线程也结束。

---

## 6. 虚拟线程不是“更快的线程”

虚拟线程容易被误解成性能开关。更准确的说法是：

> 虚拟线程提高的是大量阻塞任务下的可扩展性和吞吐，不是单个任务的执行速度。

如果你的任务是 CPU 密集型，比如压缩图片、训练模型、加密计算、排序大型数组，虚拟线程不会让 CPU 算得更快。CPU 核心数没有变，同一时间真正执行 Java 字节码的 carrier 线程也受核心数影响。

适合虚拟线程的任务通常有这些特征：

| 场景 | 是否适合 | 原因 |
|---|---|---|
| HTTP 服务调用下游 API | 适合 | 大量时间在等待网络 I/O |
| JDBC 查询 | 适合 | 查询等待期间可释放 carrier |
| Redis / MQ / 文件网络存储调用 | 多数适合 | 关键看客户端阻塞点是否能友好释放 carrier |
| 大量 `Thread.sleep` 或阻塞队列等待 | 适合 | 等待任务可以低成本挂起 |
| CPU 密集计算 | 不适合单靠虚拟线程优化 | 线程数超过核心数不能提升计算速度 |
| 已经全链路响应式 | 收益不一定明显 | 原本已经避免平台线程阻塞 |

一句话判断：如果瓶颈是“线程都在等 I/O”，虚拟线程值得试；如果瓶颈是“CPU 已经打满”，应该先看算法、批处理、并行计算、缓存或扩容。

---

## 7. 实战模式一：阻塞 HTTP 调用并发聚合

虚拟线程让我们可以保留同步代码，同时把多个 I/O 子任务并发执行。下面是一个聚合两个下游 HTTP 调用的模式：

```java
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;

public class HttpAggregateExample {
	private static final HttpClient HTTP = HttpClient.newBuilder()
		.connectTimeout(Duration.ofSeconds(3))
		.build();

	public static void main(String[] args) throws Exception {
		String result = aggregate();
		System.out.println(result);
	}

	static String aggregate() throws InterruptedException, ExecutionException {
		try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
			var user = executor.submit(() -> get("https://example.com/users/1"));
			var orders = executor.submit(() -> get("https://example.com/users/1/orders"));

			return """
				user=%s
				orders=%s
				""".formatted(user.get(), orders.get());
		}
	}

	static String get(String url) throws IOException, InterruptedException {
		var request = HttpRequest.newBuilder(URI.create(url))
			.timeout(Duration.ofSeconds(5))
			.GET()
			.build();

		return HTTP.send(request, HttpResponse.BodyHandlers.ofString()).body();
	}
}
```

这段代码没有回调，没有响应式链，也没有手动切线程。`HTTP.send(...)` 是阻塞调用，但在虚拟线程里，等待网络响应时不会像平台线程那样长期占住 OS 线程。

不过这个例子仍有一个工程问题：如果 `user` 已经失败，`orders` 可能还在执行。Java 21 同时引入了结构化并发预览 API `StructuredTaskScope`，用于把一组子任务作为一个整体处理失败、取消和生命周期。但它在 Java 21 中仍是 preview API，生产项目采用前需要明确接受 `--enable-preview` 的成本。仅使用正式 API 时，可以先用 `ExecutorService`，并在更高层做好超时、取消和资源隔离。

---

## 8. 实战模式二：用 Semaphore 限制下游并发，而不是池化虚拟线程

很多人习惯用固定线程池限制并发：

```java
Executors.newFixedThreadPool(20)
```

在平台线程时代，这既是在复用昂贵线程，也顺便限制了并发。迁移到虚拟线程后，不要为了“最多 20 并发”去创建一个“20 个虚拟线程的池”。虚拟线程本身不需要池化；真正需要保护的是数据库连接池、下游服务、磁盘、第三方 API 限额这些资源。

应该用 `Semaphore` 这类同步工具表达资源限制：

```java
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;

public class DownstreamLimiter {
	private final Semaphore permits = new Semaphore(20);

	public void fetchAll(List<String> ids) {
		try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
			for (String id : ids) {
				executor.submit(() -> fetchWithLimit(id));
			}
		}
	}

	private String fetchWithLimit(String id) throws InterruptedException {
		permits.acquire();
		try {
			return callDownstream(id);
		} finally {
			permits.release();
		}
	}

	private String callDownstream(String id) throws InterruptedException {
		Thread.sleep(100);
		return "result-" + id;
	}
}
```

这个写法表达得更准确：

1. 任务仍然可以很多，每个任务一个虚拟线程。
2. 下游资源最多允许 20 个并发访问。
3. 其余虚拟线程阻塞在 `Semaphore.acquire()`，等待许可。

阻塞虚拟线程本身成本很低。你限制的是真实稀缺资源，而不是线程对象。

---

## 9. Spring Boot 中怎么用

Spring Boot 3.2 开始支持在 Java 21+ 上通过配置启用虚拟线程：

```properties
spring.threads.virtual.enabled=true
```

如果应用依赖 `@Scheduled` 或其他后台任务维持进程，也建议加上：

```properties
spring.main.keep-alive=true
```

原因是虚拟线程是 daemon thread。只剩 daemon thread 时，JVM 可以退出。

启用后，Spring Boot 在没有自定义 `Executor` bean 的情况下，会把自动配置的 `AsyncTaskExecutor` 切换为使用虚拟线程的 `SimpleAsyncTaskExecutor`。它会影响 `@EnableAsync`、Spring MVC 异步请求处理、Spring WebFlux 阻塞执行支持等集成点。

如果项目里已经定义了自己的 executor，需要逐个确认：

```java
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class VirtualThreadConfig {
	@Bean(destroyMethod = "close")
	ExecutorService applicationExecutor() {
		return Executors.newVirtualThreadPerTaskExecutor();
	}
}
```

实际项目中不要只看“配置能不能打开”。更重要的是验证：

1. 请求处理线程是否真的变成虚拟线程。
2. 数据库连接池、HTTP client、Redis client 是否是主要等待点。
3. 是否有长时间 `synchronized` 包住 I/O。
4. 连接池大小、下游限流、超时和熔断是否合理。
5. 打开后吞吐、延迟、GC、JFR 事件是否符合预期。

---

## 10. Pinning：虚拟线程最容易踩的坑

理想情况下，虚拟线程阻塞时会从 carrier thread 上卸载。但 Java 21 中存在 pinning 场景：虚拟线程在某些情况下阻塞时不能卸载，会把 carrier 一起占住。

常见 pinning 场景：

1. 在 `synchronized` 方法或代码块中执行阻塞操作。
2. 执行 native method 或 foreign function 时阻塞。

pinning 不代表程序错误，但频繁、长时间 pinning 会损害可扩展性。例如：

```java
public class BadCacheClient {
	private final Object lock = new Object();

	public String get(String key) {
		synchronized (lock) {
			return slowRemoteCall(key);
		}
	}

	private String slowRemoteCall(String key) {
		// 模拟远程 I/O
		return key;
	}
}
```

如果 `slowRemoteCall` 是高频、长时间 I/O，这个 `synchronized` 会让虚拟线程阻塞时无法释放 carrier。更好的做法是缩小锁范围，或者在确实需要包住阻塞操作时评估 `ReentrantLock`：

```java
import java.util.concurrent.locks.ReentrantLock;

public class BetterCacheClient {
	private final ReentrantLock lock = new ReentrantLock();

	public String get(String key) {
		lock.lock();
		try {
			return slowRemoteCall(key);
		} finally {
			lock.unlock();
		}
	}

	private String slowRemoteCall(String key) {
		return key;
	}
}
```

不要机械替换所有 `synchronized`。短生命周期、纯内存操作、启动期初始化里的 `synchronized` 通常没必要动。真正需要处理的是“高频 + 长时间 + 包含阻塞 I/O”的锁。

排查 pinning 可以用：

```powershell
java -Djdk.tracePinnedThreads=full YourApp
```

也可以通过 JDK Flight Recorder 观察 `jdk.VirtualThreadPinned` 事件。JFR 默认会记录超过阈值的 pinned 事件，适合在线上压测或灰度阶段定位问题。

---

## 11. ThreadLocal：兼容，但要重新审视用途

Java 21 的虚拟线程支持 `ThreadLocal`，这是为了让大量已有框架可以低成本迁移。比如请求 ID、租户 ID、用户上下文、日志 MDC 这类“当前任务上下文”，在虚拟线程里仍然有合理用途。

真正危险的是把 `ThreadLocal` 当作“线程级对象缓存”。

平台线程池里可能只有几十个线程，所以每个线程缓存一个昂贵对象，看起来成本可控。虚拟线程模型下，每个任务都有自己的虚拟线程。如果每个虚拟线程都初始化一个昂贵对象，内存和构造成本会直接按并发任务数放大。

不推荐：

```java
static final ThreadLocal<SomeHeavyFormatter> FORMATTER =
	ThreadLocal.withInitial(SomeHeavyFormatter::new);
```

更推荐：

1. 使用线程安全、不可变、可共享的对象。
2. 使用对象池时明确池化真实资源，而不是池化线程。
3. 对请求上下文使用 `try/finally` 清理。
4. 在 Java 21 里谨慎评估 Scoped Values，因为它仍是预览特性。

示例：

```java
MDC.put("requestId", requestId);
try {
	return handleRequest();
} finally {
	MDC.clear();
}
```

虚拟线程让“线程就是任务”这个模型更自然，但也意味着 ThreadLocal 生命周期更接近任务生命周期，而不是线程池生命周期。

---

## 12. 观测与排查

虚拟线程数量可以非常大，传统 `jstack` 那种扁平线程列表不适合直接展示所有虚拟线程。Java 21 提供了新的 `jcmd` dump 能力：

```powershell
jcmd <pid> Thread.dump_to_file -format=text threads.txt
jcmd <pid> Thread.dump_to_file -format=json threads.json
```

JSON 格式更适合工具分析，也更适合观察结构化并发形成的任务层级。

JFR 中和虚拟线程相关的重要事件包括：

| 事件 | 用途 |
|---|---|
| `jdk.VirtualThreadStart` | 虚拟线程开始，默认关闭 |
| `jdk.VirtualThreadEnd` | 虚拟线程结束，默认关闭 |
| `jdk.VirtualThreadPinned` | 虚拟线程 pinned 超过阈值 |
| `jdk.VirtualThreadSubmitFailed` | 虚拟线程启动或恢复失败 |

上线前建议做一次专门压测：

1. 对比启用前后的吞吐、p95、p99。
2. 观察 CPU 是否已经打满。
3. 观察数据库连接池、HTTP 连接池是否成为瓶颈。
4. 用 JFR 检查 pinning。
5. 用 `jcmd` 看线程 dump 是否符合预期。

虚拟线程不是绕过容量规划的工具。它降低的是线程等待成本，不会让数据库、下游接口、连接池凭空变大。

---

## 13. 迁移建议

### 13.1 优先迁移 I/O 密集路径

先选择这样的路径：

1. 请求量高。
2. 大量时间等待数据库、HTTP、Redis、MQ。
3. 当前线程池经常打满。
4. 代码主要是同步阻塞风格。
5. 下游资源有明确限流和超时。

不要一开始就全局开启后直接上线。先做灰度，拿指标说话。

### 13.2 不要混用过多异步层

如果一条链路已经是 `CompletableFuture`、响应式框架、事件循环、回调风格，直接套虚拟线程通常收益有限，还可能制造额外上下文切换和 ThreadLocal 成本。

更好的迁移方向是二选一：

1. 继续保持响应式架构，把 backpressure、异步链路、线程模型做完整。
2. 回到同步阻塞代码，把请求和子任务放进虚拟线程，让栈和异常处理回归直接。

### 13.3 保留资源边界

虚拟线程便宜，但业务依赖不便宜。必须保留这些边界：

| 资源 | 建议 |
|---|---|
| 数据库连接 | 连接池仍要设置上限 |
| 下游 HTTP | 设置连接池、超时、重试和限流 |
| 第三方 API | 用 `Semaphore`、RateLimiter 或网关限流 |
| 本地磁盘 | 压测文件 I/O 行为，不假设一定收益 |
| CPU 计算 | 用固定大小的计算线程池或并行计算模型 |

---

## 14. 常见误区

### 误区一：虚拟线程越多越好

虚拟线程很多只是说明你可以表达很多并发任务，不代表下游资源能承受。该限流仍要限流。

### 误区二：把固定线程池改成固定虚拟线程池

这通常是在保留旧模型的惯性。虚拟线程不需要池化。要限制并发，用 `Semaphore` 或资源池。

### 误区三：CPU 密集任务也会提升

不会。虚拟线程不是 SIMD，也不是更多 CPU 核心。

### 误区四：所有阻塞都免费

不是。大多数 JDK 阻塞 I/O 能友好卸载，但 pinning、某些文件系统操作、native 调用、第三方库实现细节仍可能影响效果。

### 误区五：打开 Spring Boot 配置就完事

配置只是入口。真正要看的是请求线程模型、executor 覆盖情况、连接池、pinning、压测结果和观测数据。

---

## 15. 总结

Java 21 虚拟线程的意义，不是让 Java 变成另一种语言，而是把 Java 原本擅长的同步、阻塞、线程按任务建模重新带回高并发服务端开发。

它适合这样的系统：

1. 业务代码主要是同步阻塞风格。
2. 并发任务数量大。
3. 大部分时间在等待 I/O。
4. 需要保持清晰调用栈和调试体验。
5. 愿意用连接池、限流、超时、JFR 去认真验证效果。

它不适合被当成万能性能按钮。CPU 密集任务、下游资源瓶颈、错误的 ThreadLocal 缓存、长时间 pinning，都不会因为启用虚拟线程自动消失。

对多数 Java 后端项目来说，最稳妥的落地方式是：从一条 I/O 密集链路开始，用 Java 21 的 `newVirtualThreadPerTaskExecutor()` 或 Spring Boot 3.2+ 的配置做灰度验证，配合 JFR 和压测确认收益，再逐步扩大范围。

---

## 参考资料

1. [JEP 444: Virtual Threads](https://openjdk.org/jeps/444)
2. [Oracle Java 21 Virtual Threads Guide](https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html)
3. [Java SE 21: Thread API](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Thread.html)
4. [Java SE 21: Executors API](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/Executors.html)
5. [JEP 453: Structured Concurrency (Preview)](https://openjdk.org/jeps/453)
6. [Spring Boot 3.2 Reference: Virtual threads](https://docs.spring.io/spring-boot/docs/3.2.10/reference/html/features.html)
