# 一次 Ubuntu Server 故障排查：Wi-Fi 看似在线却无法 SSH，以及一个吃掉 30GB 内存的 Ruby

> 这次服务器其实出了两个问题。一个看上去像 SSH 挂了，最后发现 ARP 都没通；另一个日志里写着 postgres invoked oom-killer，最后把整台机器内存几乎吃完的却是一个 Jekyll 容器里的 Ruby。它们都不是什么特别玄学的故障，只是都很容易让人先相信最显眼的那条错误信息。

![服务器 OOM 与 Wi-Fi 故障排查封面](/blogs/server-oom-and-network-troubleshooting/cover.png)

先把结论说了吧。

网络的问题不在 SSH，不在 IPv6，也不能简单叫“服务器断网”。Ubuntu 一直能上网，只是它和 Windows 开发机虽然挂着同一个 Wi-Fi 名称、拿着同一个网段的地址，却刚好连在两个不同的 BSSID 上。当时这两个 BSSID 之间的二层通信出了问题，所以两台机器连 ARP 都解析不出来，SSH 自然也不可能连上。

另一个 OOM 也不是 PostgreSQL 吃满了内存。PostgreSQL 只是那个恰好在内存不足时又申请了一次内存的进程，内核于是开始 OOM。真正被杀的是 Jekyll 容器里的 Ruby；它已经占了大约 23 GiB RAM，再加上 7 GiB 左右的 Swap，基本一个进程就快把整台 30 GiB 内存的机器吃完了。

## 先说这台机器

服务器是 Ubuntu Server 26.04 LTS，30 GiB 内存、8 GiB Swap，装着 Intel Wi-Fi 6E AX210。Windows 开发机是 AX211：

~~~text
Ubuntu Server: 192.168.42.142
Windows 开发机: 192.168.42.207
网关:          192.168.42.1
网段:          192.168.42.0/24
~~~

服务器上又不是只有一个小服务，Docker 里跑着聊天、AI、时间服务、Portainer、Jekyll 之类的一堆容器。于是看到 SSH 连不上、内核还有 iwlwifi 和 OOM 日志的时候，第一反应就会非常不健康：

> 这台机器炸了。

还好最后看下来，它没有寄，只是同时给我上了两堂课。

## 看起来像 SSH 挂了，其实根本还没到 SSH

最开始 Windows 上连服务器：

~~~bash
ssh ops@192.168.42.142
~~~

返回：

~~~text
ssh: connect to host 192.168.42.142 port 22: Connection timed out
~~~

这两个词其实很重要。要是看到的是 Connection refused，通常说明网络包已经到了服务器，只是 22 端口没有东西接；而 timeout 的意思是 SYN 发出去了，后面什么都没回来。

所以我先没有急着重装 sshd，也没有开始检查用户名密码。服务器本机终端还能动，那就先看最基础的东西：

~~~bash
free -h
uptime
ip link
ip addr show wlp3s0
~~~

内存没有满，load 也很低，wlp3s0 是 UP，192.168.42.142/24 还好好地挂在上面。这个时候最容易觉得“网卡 UP、IP 也在，那网络肯定没问题”。

## 那条 iwlwifi Fatal，差点把我带沟里

内核日志里能看到类似这样的东西：

~~~text
iwlwifi
NMI_INTERRUPT_LMAC_FATAL
Microcode SW error detected
Device error - SW reset
~~~

这个看着确实挺吓人的。AX210 的固件报 fatal，怎么想都很像“网卡炸了”。而且说实话，Intel 无线网卡在 Linux 上也不是会让人放心。

但把完整日志按时间捋一遍才发现，那个 NMI_INTERRUPT_LMAC_FATAL 是之前留下的历史事故，并不是这次 SSH 断开时刚发生的。

这个事情听起来很简单，但实际排查时特别容易忘：**日志不是只看内容，还要看它到底是什么时候发生的。** 一条很严重的错误放在错误的时间点上，就会变成一条很会误导人的错误。

当时还没有重启，所以先把现场留了下来：

~~~bash
sudo journalctl -k -b --no-pager \
  | grep -Ei 'iwlwifi|NMI|firmware|Microcode|Device error' \
  > ~/wifi-error.log

sudo journalctl -k -b --no-pager \
  | grep -Ei 'Out of memory|Killed process|oom' \
  > ~/oom-error.log

sudo dmesg -T | tail -300 > ~/dmesg-last300.log
sudo journalctl -k -b --no-pager > ~/kernel-full.log
~~~

这里还有一个很小的坑。普通用户直接跑 dmesg，会得到 read kernel buffer failed: Operation not permitted。这个不是 dmesg 又坏了，只是读 kernel buffer 也需要权限。

保存完再 reboot。重启后 SSH 立刻恢复了，这至少说明 sshd 的配置本身没有突然自己修好，问题还是在网络状态。

## 重启以后，Docker 又给了一个小插曲

服务器起来以后，大部分容器都跟着起来了，只有 deploy-web-1 和 deploy-db-1 没有。

~~~bash
docker inspect -f \
  '{{.Name}} restart={{.HostConfig.RestartPolicy.Name}} OOMKilled={{.State.OOMKilled}} ExitCode={{.State.ExitCode}} FinishedAt={{.State.FinishedAt}}' \
  deploy-web-1 deploy-db-1
~~~

结果大概是：

~~~text
/deploy-web-1 restart=no OOMKilled=false ExitCode=137
/deploy-db-1  restart=no OOMKilled=false ExitCode=0
~~~

这里的 137 也很容易让人紧张。它确实等于 128 + 9，也就是进程最后收到 SIGKILL；但 OOMKilled=false 已经说明它不是 Docker cgroup OOM 的那种“直接证据”。

结合服务器关机时间，我更倾向于这是 Docker 先要求容器退出，容器没能在 timeout 内结束，最后才被强制杀掉。另一个数据库容器 ExitCode=0，就是正常退出。

真正导致它们没有自动恢复的原因反而很朴素：两个容器都是 restart=no。

~~~bash
docker start deploy-db-1 deploy-web-1
docker update --restart unless-stopped deploy-db-1 deploy-web-1
~~~

## 网络又复现了一次，这才抓住了它

如果它只坏一次，那其实很难真的定位。比较有价值的是，后来它又复现了。

这次我没急着重启。Ubuntu 本机：

~~~bash
ping baidu.com
~~~

正常，0% packet loss。Windows ping 网关也正常：

~~~powershell
ping 192.168.42.1
Test-NetConnection 192.168.42.142 -Port 22
~~~

但是 Windows 到服务器的 Ping 和 TCP 22 都失败了。到这一步，问题已经不只是“SSH 不通”，而是 Windows 连 192.168.42.142 这个 IP 本身都碰不到。

所以 sshd、端口、认证、密码、Xshell，这些都可以暂时丢到一边。

两边又确认了一下地址：

~~~text
Windows: 192.168.42.207/24
Ubuntu:  192.168.42.142/24
~~~

明明都在同一个 192.168.42.0/24 里，按道理应该二层直接互通。于是看 ARP。

Windows：

~~~powershell
arp -a | findstr 192.168.42.142
~~~

没有记录。

Ubuntu：

~~~bash
ping -c 4 192.168.42.207
ip neigh show 192.168.42.207
~~~

返回：

~~~text
192.168.42.207 dev wlp3s0 FAILED
~~~

看到 FAILED 的时候，事情一下就清楚很多了。Ubuntu 在广播“谁是 192.168.42.207”，但对方根本没有回应。还没轮到 TCP，更没轮到 SSH，连对方 MAC 地址都没有。

大概就是：

~~~text
SSH
↑
TCP
↑
IP
↑
ARP / 二层  ← 问题在这里
↑
Wi-Fi
~~~

这时候也有人会想到 IPv6，不过这里 SSH 用的是 IPv4 地址，失败的是 IPv4 的 ARP，IPv6 在这一段根本没有参与。

## 同一个 Wi-Fi 名称，原来真的不代表同一个接入点

Windows 上：

~~~powershell
netsh wlan show interfaces
~~~

显示它连到：

~~~text
SSID:  Maple Lab
BSSID: 02:7a:91:4c:20:a1
Band:  5 GHz
~~~

Ubuntu 原本没有 iw，装好以后：

~~~bash
sudo apt install iw
iw dev wlp3s0 link
~~~

却显示：

~~~text
Connected to 02:7a:91:4c:20:a0
SSID: Maple Lab
freq: 2462
~~~

2462 MHz 对应 2.4GHz。于是现场其实是这样的：

~~~text
                    Maple Lab
                 同一个 SSID / 密码
                        │
             ┌──────────┴──────────┐
             │                     │
          2.4 GHz               5 GHz
        BSSID ...a0            BSSID ...a1
             │                     │
          Ubuntu                Windows
    192.168.42.142        192.168.42.207
~~~

两个机器同 SSID、同网段、都能访问网关、都能上互联网，但就是互相 ARP 不到。

这里不能得出“2.4G 和 5G 天生不能互通”这种结论。正常家庭路由器应该把两个频段桥接到同一个 LAN。更准确的说法是：**当时这个 AP 或路由器在两个 BSSID 之间的客户端二层通信出了问题。**

至于到底是跨频段桥接、Client Isolation、AP Isolation，还是路由器自己状态不太对，我没有拿到更底层的 AP 日志，所以不能硬说是哪一个。先把服务器恢复稳定访问比当场把路由器底裤扒干净更重要。

## 最小实验比猜一百遍都有用

Windows 已经在 5GHz，于是我让 Ubuntu 也强制去 5GHz。

原来的 Netplan 没有指定 band：

~~~yaml
network:
  version: 2
  wifis:
    wlp3s0:
      dhcp4: true
      optional: true
      access-points:
        "Maple Lab":
          password: "<REDACTED>"
~~~

先备份，再加一行：

~~~bash
sudo cp /etc/netplan/00-installer-config.yaml \
  /etc/netplan/00-installer-config.yaml.bak.$(date +%F-%H%M%S)

sudo grep -q 'band: 5GHz' /etc/netplan/00-installer-config.yaml || \
  sudo sed -i '/password:/a\          band: 5GHz' \
  /etc/netplan/00-installer-config.yaml

sudo netplan generate
sudo netplan apply
~~~

netplan apply 的那一瞬间 SSH 断掉是正常的，毕竟 wlp3s0 要重新关联 AP。几秒以后重新连上，再看：

~~~text
Connected to 02:7a:91:4c:20:a1
SSID: Maple Lab
freq: 5300
~~~

Ubuntu 和 Windows 落到了同一个 BSSID，ARP 恢复，SSH 也立即恢复。

这个实验比前面所有猜测都更有价值：

~~~text
Ubuntu 在 2.4GHz / ...a0
Windows 在 5GHz / ...a1
↓
ARP FAILED，SSH timeout
↓
Ubuntu 切到 5GHz / ...a1
↓
ARP 恢复，SSH 立即恢复
~~~

所以这台服务器从来不是“没网”。它有 Internet，只是没有 LAN。

## 然后再回头看那个真正可怕的 OOM

网络搞完以后，才有空回头分析此前留出来的 OOM 日志。

最关键的一次发生在 2026-08-26 17:06:32。日志里面有一行：

~~~text
postgres invoked oom-killer
~~~

这个东西非常会骗人。第一眼看到自然会想 PostgreSQL 把内存吃爆了，但它的真正意思只是 PostgreSQL 当时又申请了一块内存，内核发现“真的没有了”，于是开始 OOM 处理。

真正被选中杀掉的是：

~~~text
task=ruby
pid=3850752
anon-rss ≈ 24092592 kB
~~~

也就是大约 23 GiB RAM。再看 Swap，已经到了 7 GiB 左右。

30 GiB 内存、8 GiB Swap 的机器，被一个 Ruby 占了 23 GiB RAM 加 7 GiB Swap。现在回头看，PostgreSQL 再申请内存只是压垮系统的最后一下，它甚至有点冤。

OOM 日志里面至少有三个地方要一起看：

- 谁 invoked oom-killer；
- 谁被 Killed process；
- 被杀进程的 RSS、Swap 和 cgroup 是什么。

只看第一行，很容易把元凶抓错。

## Ruby 又到底属于谁

OOM 日志中还有：

~~~text
task_memcg=
/system.slice/docker-a1b2c3d4e5f6...scope
~~~

这个 a1b2c3d4e5f6 就是容器 ID 前缀。对照 docker ps -a：

~~~text
a1b2c3d4e5f6
amirpourmand/al-folio:latest
portfolio-jekyll-1
~~~

于是事情终于可以从“一个叫 ruby 的进程”落到具体业务：

~~~text
Ruby
↓
Docker
↓
portfolio-jekyll-1
↓
al-folio / Jekyll
~~~

这个过程很重要。内核其实只知道它要杀一个任务，日志里也只会告诉你 ruby；如果不沿着 cgroup 往回找，很难知道到底是哪一个项目在拖机器下水。

## Jekyll 并不是每次只生成了一页 HTML

为了看 OOM 前发生了什么，按时间窗口把容器日志取出来：

~~~bash
docker logs --timestamps \
  --since "2026-08-26T16:30:00+08:00" \
  --until "2026-08-26T17:10:00+08:00" \
  portfolio-jekyll-1 \
  > ~/jekyll-oom-window.log 2>&1
~~~

40 分钟里一共 8,135 行日志，接近 751 KB。筛选以后可以看到好多次：

~~~text
08:48:39  Regenerating
08:51:03  Regenerating
08:55:12  Regenerating
08:59:15  Regenerating
09:05:16  Regenerating

09:06:32  OOM

09:06:39  Regenerating
09:09:04  Regenerating
~~~

每次 regeneration 跑的也不只是 Jekyll 本体。JekyllGetJson、Jekyll Scholar、Archives、Jupyter Notebook、Terser、Imagemagick、Feed、Sitemap 都在工作，连 test 目录的 JS 都能看到 Terser 去压。

Notebook 转换也在反复出现：

~~~text
[NbConvertApp] Converting notebook
/tmp/jekyll-jupyter-notebook....ipynb to html
~~~

## 真正危险的是：watch、bind mount 和自动部署凑到了一起

再看容器本身：

~~~text
Image:       amirpourmand/al-folio:latest
Command:     /srv/jekyll/entry_point.prod.sh
Host path:   /srv/sites/portfolio
Container:   /srv/jekyll
Mount:       RW
~~~

OOM 附近的进程表中，还能看到 redeploy.sh、git、git-remote-http、cron。

整个事情连起来以后就很像这样：

~~~text
cron
↓
redeploy.sh
↓
git fetch / pull / reset
↓
宿主机项目目录变化
↓
bind mount 立即同步进容器
↓
Jekyll watcher 发现变化
↓
Regenerating
↓
Ruby 不退出，继续活着
↓
下一次、下下一次 regeneration
↓
内存一点一点涨
~~~

能确定的事情其实已经很多：OOM 确实发生了；被杀的是 Ruby；Ruby 属于 portfolio-jekyll-1；它占了约 23 GiB RAM；OOM 前有大量 regeneration；同时有自动部署和 Git 更新。

但我也不能直接说“肯定是某个 Jekyll 插件内存泄漏”。因为没有 Ruby heap dump、memory profiler 或对象分配分析，精确到哪个 Gem、哪个 class、哪个对象，证据还不够。

更诚实的结论应该是：**长生命周期的 Jekyll/Ruby 在多次 regeneration 中发生了严重内存增长，最后耗尽了机器资源。至于泄漏点究竟在哪里，还需要 profiler 级别的证据。**

## 静态站生产环境，还是别让 Ruby 一直活着了

这件事之后我越来越觉得，生产环境长期跑 Jekyll watch 本身就不是一个特别好的主意。

它当然方便。改了文件，页面就自己更新。可代价是一个 Ruby 进程可能活几天、几周，哪怕每次 regeneration 只残留几十 MB，次数多了也能慢慢把机器拖死。

对静态站来说，更稳一点的结构反而很朴素：

~~~text
git pull
↓
jekyll build
↓
生成 _site
↓
Ruby 退出
↓
Nginx 提供静态文件
~~~

Ruby 一退出，内核会把它的 heap 和匿名页一起回收。哪怕构建过程里有一些没完全释放的对象，也没有跨下一次部署继续累积的机会。

Docker 的 memory limit 也应该补上。不过这里不该把所有容器一刀切成同一个值，数据库、构建容器和普通服务的需要完全不同。Jekyll 这类工作负载可以按真实需求给一个边界，例如：

~~~bash
docker update \
  --memory 4g \
  --memory-swap 4g \
  portfolio-jekyll-1
~~~

这样即使它以后又开始无限涨，最坏也只是容器自己的 cgroup OOM，而不是一个 Ruby 把整个宿主机、连同别的业务一起带走。

后续新建容器时，限额也要放到部署配置里，而不能只靠事后 docker update。

## 最后

这次最有意思的地方，是两个问题都很像某种“显而易见”的答案。

网络问题看着像 SSH 挂了，实际上 ARP 都失败了。

OOM 看着像 PostgreSQL 爆内存，实际上 Ruby/Jekyll 已经吃掉了接近 30 GB 的 RAM 加 Swap。

以后再遇到这种事情，大概还是这个顺序最靠谱：

~~~text
先确认故障在哪一层
↓
先留现场
↓
把日志和时间线对上
↓
用一个最小实验验证猜测
↓
最后再改配置
~~~

比起看到第一条报错以后直接开始“修”，这个过程慢一点，但最后通常少走很多弯路。
