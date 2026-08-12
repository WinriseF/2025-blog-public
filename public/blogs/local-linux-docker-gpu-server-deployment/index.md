# 本地 Linux + Docker + GPU 服务器部署完整流程记录

---

![本地 Linux、Docker 与 GPU 服务器部署示意图](/blogs/local-linux-docker-gpu-server-deployment/docker.png)

## 0. 最终完成状态

当前服务器底座状态：

```text
Ubuntu Server 26.04 LTS           ✅
Windows C/D 数据保留              ✅
局域网 SSH                        ✅
WiFi 联网                         ✅
APT 国内源                         ✅
Docker Engine                     ✅
Docker Compose Plugin             ✅
Portainer                         ✅
NVIDIA 驱动                       ✅
RTX 5060 Ti 识别                  ✅
NVIDIA Container Toolkit           ✅
Docker 容器调用 GPU               ✅
8GB swap                          ✅
```

常用入口：

```text
SSH：
ssh admin@192.168.50.162

Portainer：
http://192.168.50.156:9000
https://192.168.50.156:9443
```

常用检查命令：

```bash
hostname -I
df -h
free -h
swapon --show
docker ps
docker compose version
nvidia-smi
systemctl status docker --no-pager
```

---

## 1. 初始硬件与磁盘情况

### 1.1 硬件配置

本机配置：

```text
CPU：Intel i7-14700
内存：32GB
硬盘：1TB NVMe SSD
显卡：NVIDIA GeForce RTX 5060 Ti 16GB
原系统：Windows 10
```

这台机器适合做本地服务器，能够承担 Docker、数据库、Web 服务、AI 推理、局域网文件传输等任务。

### 1.2 原始磁盘情况

最开始 Windows 磁盘情况大致为：

```text
C盘：139GB，剩余约 4GB
D盘：813GB，剩余约 781GB
```

目标：

1. 不删除 Windows。
2. 不破坏 C/D 盘原始数据。
3. 从 D 盘切出一部分空间安装 Ubuntu Server。
4. 让 Ubuntu 长期运行，Windows 仅保留为备用系统和数据来源。

---

## 2. Windows 阶段准备

### 2.1 清理 C 盘

C 盘最开始只剩 4GB，不适合继续折腾分区和安装系统。后来清理到约 50GB。

管理员 CMD 中执行：

```cmd
powercfg -h off
```

清理临时目录：

```cmd
del /f /s /q "%TEMP%\*"
for /d %i in ("%TEMP%\*") do rd /s /q "%i"

del /f /s /q "C:\Windows\Temp\*"
for /d %i in ("C:\Windows\Temp\*") do rd /s /q "%i"
```

清理系统组件缓存：

```cmd
Dism.exe /Online /Cleanup-Image /StartComponentCleanup
```

也可以运行系统磁盘清理：

```cmd
cleanmgr
```

最终 C 盘剩余空间提升到约 50GB。

### 2.2 检查 BitLocker

安装 Linux 前确认 C/D 盘没有 BitLocker 加密。

```cmd
manage-bde -status
```

结果显示：

```text
C盘：完全解密，保护关闭
D盘：完全解密，保护关闭
```

因此后续安装 Linux 不会遇到 BitLocker 恢复密钥问题。

### 2.3 从 D 盘压缩 Linux 空间

打开磁盘管理：

```text
Win + R → diskmgmt.msc
```

右键 D 盘，选择“压缩卷”，填写：

```text
512000 MB
```

压缩后结构：

```text
磁盘 0：953.74GB
├─ 100MB EFI 启动分区
├─ C盘 139.86GB Windows 系统
├─ D盘 313.79GB Windows 数据盘
└─ 500.00GB 未分配空间
```

这个 500GB 用来安装 Ubuntu Server。

---

## 3. 制作 Ubuntu Server 启动 U 盘

### 3.1 下载工具与镜像

下载：

```text
Rufus：rufus-4.15.exe
Ubuntu Server：ubuntu-26.04-live-server-amd64.iso
```

注意：

```text
Rufus 在 Windows 里运行，不需要复制到 U 盘。
Ubuntu ISO 也放在 Windows 里，由 Rufus 选择。
制作启动盘会清空 U 盘。
```

### 3.2 Rufus 设置

Rufus 中选择：

```text
设备：KINGSTON U盘
引导类型：ubuntu-26.04-live-server-amd64.iso
分区类型：GPT
目标系统：UEFI
文件系统：Large FAT32 / 默认
```

点击“开始”。如果出现写入模式选择，一般选择：

```text
ISO 镜像模式
```

如果后续启动异常，可重新写入并改用：

```text
DD 镜像模式
```

---

## 4. 从 U 盘启动

### 4.1 F12 不生效

最开始疯狂按 F12 仍然直接进入 Windows。后来通过 Windows 高级启动进入 U 盘启动项。

Windows 中执行：

```cmd
shutdown /r /o /f /t 0
```

或者：

```text
开始菜单 → 电源 → 按住 Shift → 重启
```

进入后选择：

```text
使用设备
```

选择带 `UEFI` 的 U 盘项，例如：

```text
UEFI: KingstonDataTraveler...
```

不要选择：

```text
UEFI: PXE IPv4
UEFI: PXE IPv6
```

那是网卡启动。

### 4.2 U 盘启动短暂黑屏

第一次从 U 盘启动时出现短暂黑屏，等待一段时间后进入 Ubuntu Server 安装器。

如果持续黑屏，可以：

```text
1. 等 2~3 分钟。
2. 长按电源键关机。
3. 重新选择 UEFI U盘启动。
4. 仍失败时，考虑关闭 Secure Boot 或用 Rufus DD 模式重写 U 盘。
```

---

## 5. Ubuntu Server 安装过程

### 5.1 基础页面选择

安装器中选择：

```text
Language：English
Keyboard：English (US)
Install type：Ubuntu Server
Third-party drivers：不勾选
```

不选择 minimized，因为 minimized 太精简，后续补工具可能麻烦。

### 5.2 网络阶段 WiFi 崩溃

安装过程中尝试连接 WiFi 后，Ubuntu 安装器崩溃并出现错误报告页面。

处理：

```text
1. Close report / Reboot Now。
2. 重新进入安装器。
3. 网络页面不再连接 WiFi。
4. 直接跳过网络。
```

安装阶段可以不联网，后面进系统后再配置 WiFi。

### 5.3 APT Mirror 页面

因为没有联网，安装器提示无法验证软件源。保持默认即可：

```text
http://archive.ubuntu.com/ubuntu/
```

后续联网后再改国内源。

---

## 6. 手动分区

### 6.1 必须选择 Custom Storage Layout

Storage 页面绝对不能选：

```text
Use an entire disk
Erase disk
使用整块磁盘
```

必须选：

```text
Custom storage layout
```

这是整个安装过程中风险最高的一步。选错可能清掉 Windows C/D 盘。

### 6.2 第一次未显示 500GB free space

第一次进入手动分区页面，安装器没有明显显示 500GB 未分配空间，只看到：

```text
partition 1    128M
partition 2    100M ESP
partition 3    139.859G NTFS
partition 4    313.785G NTFS
```

没有看到：

```text
free space 500G
```

所以没有继续乱点，也没有执行 Format/Reformat。

### 6.3 回 Windows 创建临时 NTFS 分区

为了让安装器明确识别目标分区，回 Windows 磁盘管理，将 500GB 未分配空间创建为一个空 NTFS 分区。

设置：

```text
大小：默认全部 500GB
盘符：E:
文件系统：NTFS
卷标：UBUNTU
快速格式化：勾选
```

这个分区只是临时给安装器识别，后续会在 Ubuntu 安装器里格式化为 ext4。

### 6.4 第二次进入分区页面

第二次进入安装器，成功看到：

```text
partition 5 existing, already formatted as ntfs, not mounted 500.000G
```

这就是目标分区。

### 6.5 设置启动分区

选择主硬盘：

```text
Lenovo_E680_SSD-M.2-2280S-NVMe-1TB
```

选择：

```text
Use As Boot Device
```

这会挂载原 EFI 分区到：

```text
/boot/efi
```

注意：不要格式化 EFI 分区。

### 6.6 设置 Ubuntu 根分区

选择：

```text
partition 5 500.000G ntfs
```

编辑为：

```text
Format：ext4
Mount：/
```

最终总览中显示：

```text
/           500.000G   new ext4
/boot/efi   100.000M   existing vfat
```

确认只会格式化：

```text
partition 5 500GB
```

不会格式化：

```text
partition 2 EFI
partition 3 Windows C盘
partition 4 Windows D盘
```

然后选择 Continue 开始安装。

---

## 7. 创建用户与 OpenSSH

创建用户：

```text
用户名：admin
主机名：local-server
```

Ubuntu 默认 root 没有密码，因此后续不要使用：

```bash
su
```

正确方式：

```bash
sudo 命令
```

或进入 root shell：

```bash
sudo -i
```

OpenSSH 页面勾选：

```text
[x] Install OpenSSH server
[x] Allow password authentication over SSH
```

这样安装完成后可以直接局域网 SSH。

---

## 8. 安装完成并首次登录

安装完成后选择：

```text
Reboot Now
```

若提示：

```text
Please remove the installation medium, then press ENTER
```

拔掉 U 盘并按 Enter。

首次登录后检查：

```bash
df -h
lsblk
free -h
swapon --show
cat /etc/fstab
```

确认结果：

```text
/ 使用约 500GB ext4 分区
/swap.img 8GB swap 文件
/boot/efi 使用原 EFI 分区
```

swap：

```text
/swap.img file 8G
```

`/etc/fstab` 中存在：

```text
/swap.img none swap sw 0 0
```

说明 swap 已启用且开机自动挂载。

---

## 9. 配置 WiFi

### 9.1 系统没有 nmcli / iw

安装完成后没有：

```text
nmcli
iw
```

所以不能直接图形化扫描 WiFi，只能用 netplan 手动配置。

查看网卡：

```bash
ip link
```

看到：

```text
lo
eno1
wlp3s0
```

其中：

```text
wlp3s0 是 WiFi 网卡
eno1 是有线网卡
```

### 9.2 编辑 netplan

查看配置文件：

```bash
ls /etc/netplan
```

结果：

```text
00-installer-config.yaml
```

编辑：

```bash
sudo nano /etc/netplan/00-installer-config.yaml
```

原文件中：

```yaml
wifis: {}
```

需要改为多行配置。示例：

```yaml
network:
  ethernets:
    eno1:
      match:
        macaddress: xx:xx:xx:xx:xx:xx
      set-name: eno1
  version: 2
  wifis:
    wlp3s0:
      dhcp4: true
      optional: true
      access-points:
        "你的WiFi名称":
          password: "WiFi密码"
```

WiFi 名称带空格也可以，但必须用英文双引号：

```yaml
"你的WiFi名称":
  password: "WiFi密码"
```

保存 nano：

```text
Ctrl + O
Enter
Ctrl + X
```

应用配置：

```bash
sudo chmod 600 /etc/netplan/00-installer-config.yaml
sudo netplan generate
sudo netplan apply
```

检查：

```bash
ip a
ping -c 4 baidu.com
```

最终 WiFi 能 ping 通百度，说明联网成功。

---

## 10. 修改 APT 国内源

Ubuntu 26.04 使用 deb822 `.sources` 格式。源文件类似：

```text
/etc/apt/sources.list.d/ubuntu.sources
```

编辑：

```bash
sudo nano /etc/apt/sources.list.d/ubuntu.sources
```

将：

```text
URIs: http://archive.ubuntu.com/ubuntu/
URIs: http://security.ubuntu.com/ubuntu/
```

改为清华源：

```text
URIs: https://mirrors.tuna.tsinghua.edu.cn/ubuntu/
```

示例：

```text
Types: deb
URIs: https://mirrors.tuna.tsinghua.edu.cn/ubuntu/
Suites: resolute resolute-updates resolute-backports
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

Types: deb
URIs: https://mirrors.tuna.tsinghua.edu.cn/ubuntu/
Suites: resolute-security
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
```

更新：

```bash
sudo apt update
sudo apt upgrade -y
```

---

## 11. 局域网 SSH

服务器确认 IP：

```bash
hostname -I
```

当前服务器 IP：

```text
192.168.50.156
```

Windows 使用：

```powershell
ssh admin@192.168.50.156
```

Xshell 配置：

```text
协议：SSH
主机：192.168.50.156
端口：22
用户名：admin
认证：Password
```

首次成功后会显示：

```text
Welcome to Ubuntu 26.04 LTS
admin@local-server:~$
```

遇到：

```text
su: Authentication failure
```

原因：Ubuntu 默认 root 没有密码。

正确方式：

```bash
sudo -i
```

或者：

```bash
sudo apt update
```

---

## 12. 安装 Docker

### 12.1 安装 Docker 官方版

不要安装 Ubuntu 仓库里的 `docker.io`，安装 Docker 官方源中的：

```text
docker-ce
docker-ce-cli
containerd.io
docker-buildx-plugin
docker-compose-plugin
```

删除旧包：

```bash
for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
  sudo apt remove -y $pkg 2>/dev/null || true
done
```

安装依赖：

```bash
sudo apt update
sudo apt install -y ca-certificates curl
```

添加 key：

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
```

添加 Docker 官方源：

```bash
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF2
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF2
```

安装：

```bash
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

启动并开机自启：

```bash
sudo systemctl enable docker
sudo systemctl start docker
sudo systemctl status docker --no-pager
```

状态为：

```text
active (running)
```

### 12.2 Docker Hub 拉取超时

第一次测试：

```bash
sudo docker run hello-world
```

报错：

```text
failed to resolve reference "docker.io/library/hello-world:latest"
dial tcp ... i/o timeout
```

原因：Docker Hub 网络访问慢或超时。

配置 Docker 镜像加速和日志限制：

```bash
sudo mkdir -p /etc/docker
sudo nano /etc/docker/daemon.json
```

写入：

```json
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io"
  ],
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "3"
  }
}
```

重启：

```bash
sudo systemctl daemon-reload
sudo systemctl restart docker
```

检查：

```bash
sudo docker info | grep -A 10 "Registry Mirrors"
```

再次测试：

```bash
sudo docker run hello-world
```

成功。

### 12.3 Docker 用户组权限

一开始直接运行：

```bash
docker info
```

出现：

```text
permission denied while trying to connect to the docker API at unix:///var/run/docker.sock
```

原因：当前用户 `admin` 不在 docker 组。

执行：

```bash
sudo usermod -aG docker $USER
```

退出 SSH 并重新登录：

```bash
exit
```

重新连接后测试：

```bash
docker ps
docker run hello-world
```

---

## 13. 安装 Portainer

创建目录：

```bash
mkdir -p ~/docker/portainer
cd ~/docker/portainer
```

创建 compose 文件：

```bash
nano docker-compose.yml
```

内容：

```yaml
services:
  portainer:
    image: portainer/portainer-ce:latest
    container_name: portainer
    restart: unless-stopped
    ports:
      - "9000:9000"
      - "9443:9443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./data:/data
```

启动：

```bash
docker compose up -d
```

访问：

```text
http://192.168.50.156:9000
https://192.168.50.156:9443
```

Portainer 首次配置需要 setup token。

查看 token：

```bash
docker logs portainer 2>&1 | grep setup_token
```

如果容器名不同：

```bash
docker ps
docker logs 容器名 2>&1 | grep setup_token
```

首次进入后创建管理员账号。Portainer 本身没有默认账号密码。

---

## 14. NVIDIA 驱动配置

### 14.1 检查显卡

执行：

```bash
ubuntu-drivers devices
```

识别到：

```text
model    : GB206 [GeForce RTX 5060 Ti]
driver   : nvidia-driver-595-open - distro non-free recommended
```

同时出现：

```text
ERROR:root:aplay command not found
```

这是因为系统没有音频工具，不影响显卡驱动安装。

### 14.2 安装 NVIDIA 驱动

执行：

```bash
sudo ubuntu-drivers install --gpgpu
```

它安装的是 headless / server / compute 驱动组件，包括：

```text
nvidia-headless-no-dkms-595-server-open
linux-modules-nvidia-595-server-open-7.0.0-27-generic
libnvidia-compute-595-server
nvidia-compute-utils-595-server
```

安装后执行：

```bash
nvidia-smi
```

一开始提示命令不存在：

```text
Command 'nvidia-smi' not found
```

原因：驱动主体已安装，但 `nvidia-smi` 工具包没装。

补装：

```bash
sudo apt install -y nvidia-utils-595-server
sudo reboot
```

重启后验证：

```bash
nvidia-smi
```

成功显示：

```text
NVIDIA-SMI 595.71.05
Driver Version: 595.71.05
CUDA Version: 13.2
NVIDIA GeForce RTX 5060 Ti
Memory: 16311MiB
```

---

## 15. NVIDIA Container Toolkit

目标：让 Docker 容器调用 RTX 5060 Ti。

添加 NVIDIA Container Toolkit 源：

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
```

```bash
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
```

安装：

```bash
sudo apt update
sudo apt install -y nvidia-container-toolkit
```

配置 Docker：

```bash
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

测试：

```bash
docker run --rm --gpus all nvidia/cuda:13.0.0-base-ubuntu24.04 nvidia-smi
```

测试成功，容器内也显示：

```text
NVIDIA GeForce RTX 5060 Ti
Driver Version: 595.71.05
CUDA Version: 13.2
```

说明：

```text
Ubuntu NVIDIA 驱动       ✅
Docker Engine            ✅
NVIDIA Container Toolkit ✅
Docker GPU 调用          ✅
```

---

## 16. WiFi 掉线问题

中途出现过 SSH 断开和本机屏幕输出：

```text
iwlwifi ... Not associated and the session protection is over already...
```

这不是系统崩溃，而是 Intel WiFi 驱动日志，说明 WiFi 掉线或关联失败了一次。

处理：

```bash
ip a
sudo netplan apply
ping -c 4 baidu.com
```

---

## 17. Swap 状态

当前 swap：

```bash
free -h
```

显示：

```text
Mem: 30Gi
Swap: 8.0Gi
```

查看：

```bash
swapon --show
```

显示：

```text
/swap.img file 8G
```

`/etc/fstab` 中：

```text
/swap.img none swap sw 0 0
```

说明 8GB swap 已启用且重启自动挂载。

如果希望降低系统过早使用 swap：

```bash
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
sudo sysctl -p /etc/sysctl.d/99-swappiness.conf
cat /proc/sys/vm/swappiness
```

看到：

```text
10
```

即可。

---

## 18. 服务器配置备份方案

创建配置备份：

```bash
mkdir -p ~/server-backup
cd ~/server-backup

BACKUP_DIR="server-config-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

cat /etc/os-release > "$BACKUP_DIR/os-release.txt"
uname -a > "$BACKUP_DIR/kernel.txt"
hostnamectl > "$BACKUP_DIR/hostnamectl.txt"
df -h > "$BACKUP_DIR/df-h.txt"
free -h > "$BACKUP_DIR/free-h.txt"
lsblk -f > "$BACKUP_DIR/lsblk-f.txt"
swapon --show > "$BACKUP_DIR/swapon.txt"
ip a > "$BACKUP_DIR/ip-a.txt"

dpkg --get-selections > "$BACKUP_DIR/packages-dpkg.txt"
apt-mark showmanual > "$BACKUP_DIR/packages-manual.txt"

mkdir -p "$BACKUP_DIR/apt"
sudo cp -a /etc/apt/sources.list "$BACKUP_DIR/apt/" 2>/dev/null || true
sudo cp -a /etc/apt/sources.list.d "$BACKUP_DIR/apt/" 2>/dev/null || true

mkdir -p "$BACKUP_DIR/network"
sudo cp -a /etc/netplan "$BACKUP_DIR/network/" 2>/dev/null || true

mkdir -p "$BACKUP_DIR/ssh"
sudo cp -a /etc/ssh/sshd_config "$BACKUP_DIR/ssh/" 2>/dev/null || true
sudo cp -a ~/.ssh "$BACKUP_DIR/ssh/user-ssh" 2>/dev/null || true

mkdir -p "$BACKUP_DIR/docker"
sudo cp -a /etc/docker "$BACKUP_DIR/docker/etc-docker" 2>/dev/null || true
docker version > "$BACKUP_DIR/docker/docker-version.txt" 2>&1
docker compose version > "$BACKUP_DIR/docker/docker-compose-version.txt" 2>&1
docker ps -a > "$BACKUP_DIR/docker/docker-ps-a.txt" 2>&1
docker images > "$BACKUP_DIR/docker/docker-images.txt" 2>&1
docker volume ls > "$BACKUP_DIR/docker/docker-volumes.txt" 2>&1
docker network ls > "$BACKUP_DIR/docker/docker-networks.txt" 2>&1
docker info > "$BACKUP_DIR/docker/docker-info.txt" 2>&1

mkdir -p "$BACKUP_DIR/gpu"
nvidia-smi > "$BACKUP_DIR/gpu/nvidia-smi.txt" 2>&1
dpkg -l | grep -i nvidia > "$BACKUP_DIR/gpu/nvidia-packages.txt" 2>&1

mkdir -p "$BACKUP_DIR/systemd"
systemctl list-unit-files --type=service > "$BACKUP_DIR/systemd/services.txt"
systemctl list-units --type=service --state=running > "$BACKUP_DIR/systemd/running-services.txt"

tar -czf "$BACKUP_DIR.tar.gz" "$BACKUP_DIR"
ls -lh "$BACKUP_DIR.tar.gz"
```

从 Windows 下载备份：

```powershell
scp admin@192.168.50.156:/home/admin/server-backup/server-config-*.tar.gz D:\server-backup\
```

注意：备份包可能包含 WiFi 密码、SSH 配置、Docker 源配置，不要随便发给别人。

## 19. 关键经验总结

### 19.1 不要在安装器里乱点 Format

安装器中：

```text
Format
Reformat
Use entire disk
```

都有风险。必须确认选中的是目标分区。

本次正确目标：

```text
partition 5 500GB
```

不能动：

```text
partition 2 EFI
partition 3 Windows C盘
partition 4 Windows D盘
```

### 19.2 未分配空间不显示时的处理

如果 Ubuntu 安装器不显示 Windows 中压缩出的未分配空间，可以先在 Windows 中将其创建为临时 NTFS 分区，再在 Ubuntu 安装器中将该分区格式化为 ext4 并挂载为 `/`。

### 19.3 Ubuntu Server 默认没有 root 密码

不要用：

```bash
su
```

应使用：

```bash
sudo -i
```

或：

```bash
sudo 命令
```

### 19.4 Docker 成功不代表 Docker Hub 网络正常

`systemctl status docker` 为 active 只是说明 Docker 服务运行正常。若拉镜像超时，需要配置镜像源或使用加速前缀。

### 19.5 NVIDIA 驱动和 nvidia-smi 不是一回事

驱动主体安装后，`nvidia-smi` 可能仍不存在。需要补装对应工具：

```bash
sudo apt install -y nvidia-utils-595-server
```

### 19.6 主机无需安装完整 CUDA Toolkit

对于 Docker/AI 服务，主机只需要：

```text
NVIDIA Driver
NVIDIA Container Toolkit
Docker
```

CUDA 运行环境可以由 Docker 镜像提供。

---
