# 课堂笔记网站（NoteWeb）

一个把 Markdown 笔记变成网站的本地程序。特点：

- **直接看 `.md` 文档** —— 表格、代码块（带语法高亮和一键复制）、引用、标题锚点、本页目录，全都渲染好。
- **零依赖、不联网也能跑** —— Markdown 解析库已经放进 `web/vendor/`，咖啡厅没网也照样开。
- **改完笔记自动刷新** —— 保存 md 文件，浏览器里的页面自己就更新了，不用按 F5。
- **一套文件，两种用法** —— 平时当本地服务器给同学看；哪天想要永久网址，一条命令打包成静态网站上传。

---

## 目录结构

```
NoteWeb/
├─ config.mjs              ← 想改网站标题、端口、笔记来源，只改这里
├─ package.json            快捷命令（npm start / npm run build …）
├─ README.md               你正在看的这份说明
├─ 部署到网上.md            ★ 想让别人关机后也能看，看这份
├─ .github/workflows/      自动发布到 GitHub Pages 的流程（配好一次即可）
├─ data/manifest.json      自动生成的笔记清单（不用手动改）
├─ data/music.json         自动生成的曲库清单（跑扫描/打包时生成）
├─ music/                  ★ 音乐文件放这里（原样播放，不转码）
├─ music.overrides.json    手填元数据/封面/歌词/「原创」标记（可选）
├─ notes/                  笔记副本（由同步脚本从「已总结稿.md」复制过来）
├─ web/                    网站本体：css / js / vendor（内置的 Markdown 库）
│   ├─ css/style.css       全部样式，改颜色改这里
│   ├─ img/                全站背景图（bg-palace-day.webp / bg-palace-night.webp）
│   ├─ js/app.js           深色模式、搜索、目录、自动刷新等交互
│   ├─ music/              音乐播放器（player.js / player.css / default-cover.svg）
│   │   └─ covers/         从音频文件里抽出来的封面（自动生成）
│   └─ vendor/             markdown-it + highlight.js（离线可用）
├─ scripts/
│   ├─ sync-notes.mjs      把「已总结稿.md」的笔记同步到 notes/ 并重建清单
│   ├─ serve.mjs           ★ 启动本地服务器（日常主要用这个）
│   ├─ build.mjs           打包成静态网站（输出到 dist/）
│   ├─ preview.mjs         预览打包结果
│   ├─ music-scan.mjs      扫描 music/ 生成曲库清单 + 抽封面
│   ├─ manifest.mjs        扫描笔记、生成清单
│   ├─ renderer.mjs        Markdown → HTML
│   ├─ site.mjs            页面骨架（侧边栏 + 正文 + 音乐库页）
│   └─ selftest.mjs        渲染自检（改完渲染逻辑跑一下）
└─ dist/                   打包产物（只有跑过 build 才有）
```

---

## 一、日常使用（本机）

```powershell
cd D:\录音中转站\整理部署\NoteWeb
npm start
```

然后浏览器打开 **http://localhost:5173**。停止服务器：在那个窗口按 `Ctrl + C`。

> 记不住 `npm start` 也行，等价的写法是 `node scripts/serve.mjs`。

> **最省事：直接双击本目录里的两个 bat**
> - **`_启动网站.bat`** —— 本地预览（等价于 `npm start`），关掉窗口就停止；
> - **`_打包网站.bat`** —— 同步笔记 → 打包静态网站 → 自检，一条龙，跑完自动打开 `dist`。

> **本工作区自带 Node.js，不用另外装**：在 `D:\录音中转站\运行环境\nodejs\`。上面两个 bat 用的就是它。要在命令行里自己敲，用完整路径：
>
> ```powershell
> $node = "D:\录音中转站\运行环境\nodejs\node.exe"
> $npm  = "D:\录音中转站\运行环境\nodejs\node_modules\npm\bin\npm-cli.js"
> & $node $npm start
> ```

### 改了笔记怎么办

笔记有两个位置，别搞混：

| 项目 | 位置 | 说明 |
|---|---|---|
| **笔记原稿** | `D:\录音中转站\整理部署\已总结稿.md\` | 你平时写笔记的地方 |
| **网站用的副本** | `NoteWeb\notes\` | 由同步脚本复制过来，**不要手动改** |

**改原稿之后，让网站也更新：**

```powershell
npm run sync      # 把原稿复制到 notes/ 并重建清单
```

服务器开着的时候，执行完 `npm run sync`（或者手动改了 `notes/` 里的文件），网页会**自动刷新**，不需要重启服务器。

> 只改"错别字、措辞"这种小修，因为要重走一遍复制，所以必须跑 `npm run sync`。
> 如果你直接编辑 `NoteWeb\notes\` 里的文件，保存那一刻网页就会自动刷新。

### 笔记上显示的日期

每篇笔记标题下面那个日期（例如 `2026-09-08 12:57`）按这个顺序取：

1. `NoteWeb\note-dates.json` 里手填的日期（**优先级最高**，有就用它）；
2. 文件修改时间 与 它在 git 里最后一次提交时间，取更早的那个。

为什么要这么一个文件：GitHub Actions 每次发布都是**重新检出仓库**，文件的修改时间会变成"检出时间"，
结果线上每篇笔记都显示成同一天（2026-10-12）。把真实日期写进 `note-dates.json` 之后，本地和线上就一致了。

新笔记不用管它：没写进去的会自动用上面第 2 条。想给某篇笔记固定一个日期，加一行即可（键是相对 `notes\` 的路径）：

```json
{
  "linux操作系统_md/Linux1to4.markdown": "2026-09-08 12:57"
}
```

### 加了新课程 / 新笔记

直接在「已总结稿.md」里新建一个文件夹或 md 文件，然后 `npm run sync`，它会自动出现在网站上，不用改任何代码。

想让分类名显示得好看点（默认会去掉 `_md`、`.md` 这类后缀），在 `config.mjs` 的 `courseDisplay` 里加一行：

```js
courseDisplay: {
  'linux操作系统_md': 'Linux 操作系统',
  '新文件夹名': '我想显示的名字',     // ← 加这行
},
```

### 常用命令

| 命令 | 作用 |
|---|---|
| `npm start` | 启动网站（局域网可访问） |
| `npm start -- --local` | 启动网站（只有本机能访问） |
| `npm start -- --port=8080` | 换端口（5173 被占用时用） |
| `npm run sync` | 同步原稿 → notes/ 并重建清单 |
| `npm run build` | 打包成静态网站（输出 `dist/`） |
| `npm run preview` | 预览打包结果 |
| `npm run music` | 重新扫描 `music/` 生成曲库清单（加歌之后跑，或直接 build） |
| `npm run check` | 渲染自检（改过渲染相关代码后跑） |

**两个一键脚本**（双击就行，不用敲命令）：

| 脚本 | 作用 |
|---|---|
| `_打包网站.bat` | 同步 + 打包 + 自检 → `dist\`（**带无损音乐，470 MB**，本地/局域网用） |
| `_打包网页版.bat` | 打包成能上传的版本 → `dist-网页版\` + `_发布包_网页版.zip`。**有 `music-web\` 就一起装上**（14 首 MP3，约 54 MB，线上有播放器）；没有就打成纯笔记版（约 2 MB） |
| `..\_更新到GitHub.bat` | 在仓库根 `整理部署\` 里：提交 + 推送到 GitHub，推完 GitHub 自动重新打包发布（**日常更新用这个**）。推送失败或没推上去会明确报出来，并自动改用本机代理再试一次 |
| `..\_一键发布到GitHub.bat` | 同样在仓库根：首次发布用（问用户名/仓库名、连远端、开 Pages） |

> 网页版等价于：`NW_MUSIC_DIR=music-web` + `NW_DIST=dist-网页版` 跑 `npm run build`（没有 `music-web\` 时用 `NW_NO_MUSIC=1`）；
> 输出目录用 `NW_DIST` 换，所以原来的 `dist\` 不会被覆盖。
> 音频目录用 `NW_MUSIC_DIR` 换（默认 `music`），清单会分别存成 `data/music.json` 与 `data/music-web.json`，互不覆盖。

> 如果 PowerShell 报错说不认识 `npm`，说明 Node.js 没装好或没进 PATH，参考下面的"故障排查"。

---

## 一之二、音乐库（底部播放器）

侧边栏的 **音乐库** 就是这一套：页面底部常驻一条迷你播放器，站内任何页面都在，切到别的笔记不会中断。

**加歌**：把音频文件丢进 `music/`，然后 `npm run build`（或双击 `_打包网站.bat`）。曲库清单 `data/music.json` 是**自动扫描生成**的，不手写。

- 支持的格式直接播：`.flac .mp3 .wav .m4a .mp4 .aac .ogg .oga .opus .weba .webm`；
- 浏览器放不了的（`.ape .wma .alac .dsf .dff .mpc .wv .tak .mka`、`.aiff` 视浏览器而定）**不会被丢掉**：照样列在曲库里，标红说明"不能直接播放"，需要你自己转码；
- **不转码、不降码率**：播放的是原文件；无损容器（FLAC/WAV/ALAC…）标"无损容器"，有损的标"有损"，不会把有损标成无损；
- 标题/艺术家/专辑/采样率/位深/时长优先读文件内嵌标签（FLAC 的 Vorbis Comment、MP3 的 ID3v2、WAV 头）；内嵌封面会抽出来放到 `web/music/covers/`，没有封面的用统一占位图；
- 想让某首歌显示别的名字、补封面、配歌词，或者**你自己创作的**要挂「原创」徽章，写进 `music.overrides.json` 就行：
  ```json
  {
    "tracks": {
      "我的原创.flac": { "title": "…", "artist": "…", "original": true, "lyrics": "…" }
    }
  }
  ```
  `original: true` 才显示「原创」徽章——别人的商业唱片**不要**勾这个，那是虚假署名。

**播放器能做什么**：播放/暂停、上一首/下一首、拖动进度条、音量与静音、随机播放、列表循环/单曲循环、展开曲库面板、独立小窗。

**关于"切页不断音"（要如实理解）**：

- 点播放条右侧的 **🎧** 会开一个**独立小窗**，只有一条播放器。**只有这个窗口在放**，你在主页面里怎么翻笔记都不会中断——这是本项目里唯一真正"无缝"的做法；
- 不点小窗、直接在页面上放时，**切页/刷新会停**，但会记住听到哪一秒，回来时可以点弹出来的「▶ 从 mm:ss 继续」接着听——这是**断点续播，不是无缝播放**；
- 同一个站点里只有一个地方出声：你在别处点了播放，原来那个窗口（含小窗）会在两三秒内自动停下。

**版权**：音乐库页脚写明了"版权归原作者及发行方所有，本站仅为个人学习整理，仅供个人试听，请勿转载传播"。把商业唱片传到公开网站上是有风险的，发布前想清楚（见 `部署到网上.md`）。

### 线上版音频（`music-web\`，MP3 160 kbps）

两套音频分工，别搞混：

| 目录 | 内容 | 体积 | 进不进 git / 上不上线 | 谁在用 |
|---|---|---|---|---|
| `music\` | 14 首 FLAC 原文件 | 467.9 MB | **不进仓库**（`.gitignore` 排除）、不上线 | 本地/局域网（`dist\`） |
| `music-web\` | 同样 14 首，转成 MP3 160 kbps | 52.0 MB，单首最大 5.1 MB | **进仓库**，线上就用它 | 线上（`dist-网页版\`、GitHub Pages、Netlify） |

- 转码命令（有 ffmpeg 就能重跑，改 `<音乐名>` 即可；`-map 0:v? -disposition:v attached_pic` 是把内嵌封面一起带过去）：
  ```bat
  ffmpeg -hide_banner -loglevel error -y -i "music\<音乐名>.flac" ^
    -map 0:a:0 -map 0:v? -c:v copy -disposition:v attached_pic ^
    -c:a libmp3lame -b:a 160k -map_metadata 0 -id3v2_version 3 -write_id3v1 0 "music-web\<音乐名>.mp3"
  ```
- 时长/采样率/码率是**按 MPEG 帧头算的**（优先读 Xing/Info 帧数），界面显示的时长与 ffprobe 差在 0.1 秒以内；
- MP3 是**有损**格式，界面会老老实实标「有损」，不会冒充无损；
- 加了新歌想让线上也有：把 FLAC 丢进 `music\` → 用上面的命令转一份到 `music-web\` → `npm run music`（会分别生成 `data/music.json` 和 `data/music-web.json`）→ 双击 `_打包网页版.bat` → push。

---

## 二、让其他用户也能看到（重点）

浏览器出于安全限制，**不能直接读取你硬盘上的 md 文件**，所以不能靠"把文件夹发过去双击打开"。要让别人看到，只有三条路，按你的需求挑一条：

| 方案 | 别人怎么访问 | 你的电脑要开着吗 | 改了笔记之后 | 适合场景 |
|---|---|---|---|---|
| **A. 局域网** | `http://你的IP:5173` | 要开着 | **刷新就是最新的** | 同一个 WiFi / 校园网里的同学 |
| **B. 公网隧道** | 一个临时公网网址 | 要开着 | **立即生效** | 不在同一个网络的人，临时看一次 |
| **C. 静态托管** | 一个永久固定网址 | **不用开** | 要重新发布一次 | 长期分享、放进简历/作业链接 |

三种方案的网站文件是同一套，随时可以切换。

> **想让电脑关机后别人也能看**，用方案 C。完整的保姆级步骤见 **[`部署到网上.md`](部署到网上.md)**，
> 里面写了 GitHub Pages（配好后 `git push` 就自动更新）、Netlify Drop（30 秒拿到网址）、
> Cloudflare Pages 三种免费做法，以及发布前该注意什么。

---

### 方案 A：局域网共享（最快，推荐先用这个）

**前提**：你和同学连的是**同一个网络**（同一个 WiFi、同一个宿舍路由器、或同一个校园网）。

**第 1 步**：启动服务器

```powershell
cd D:\录音中转站\整理部署\NoteWeb
npm start
```

启动后会打印出几行地址，长这样：

```
本机打开：      http://localhost:5173

发给同学用这些地址（需连同一个 WiFi / 校园网）：
    http://192.168.130.99:5173    （网卡：以太网 4）
    http://192.168.121.1:5173    （网卡：VMware Network Adapter VMnet1）
    http://192.168.41.1:5173     （网卡：VMware Network Adapter VMnet8）
```

**第 2 步**：**挑对你真正在用的那个网卡**，把对应的地址发给同学。

这一步最容易搞错，判断方法：

- 名字里带 **VMware / VirtualBox / Hyper-V / VMnet** 的是虚拟网卡，**同学连不上，不要发**。
- 名字是 **WLAN / Wi-Fi / 无线网络连接** 的 → 你在用 WiFi，发它。
- 名字是 **以太网 / Ethernet / 本地连接** 的 → 你插了网线，发它。
- 实在分不清：把 `192.168.x.x` 那几个都发过去，让同学一个个试，能打开的就是对的。

**第 3 步**：同学在他的浏览器里输入那个地址（`http://192.168.130.99:5173`）就能看了，手机也行。

#### 同学打不开？按顺序排查

**① 先在本机试**：你自己访问 `http://localhost:5173` 正常吗？不正常说明服务器没起来。

**② 在同一个网络里吗**：同学连的是不是同一个 WiFi？校园网常有"学生网段互相隔离"，这种情况局域网方案直接走不通，改用方案 B 或 C。

**③ 防火墙（最常见的原因）**：Windows 防火墙默认拦外部访问。**用管理员身份**打开 PowerShell（开始菜单搜 PowerShell → 右键 → 以管理员身份运行），粘贴执行：

```powershell
netsh advfirewall firewall add rule name="NoteWeb 5173" dir=in action=allow protocol=TCP localport=5173
```

执行一次就永久有效，以后不用再执行。要撤销的话把 `add` 换成 `delete`：

```powershell
netsh advfirewall firewall delete rule name="NoteWeb 5173"
```

**④ 确认你的 IP 没变**：换个网络（比如从宿舍 WiFi 换到教室 WiFi）后 IP 通常会变，重新启动服务器看新打印的地址。想固定查看当前 IP：

```powershell
ipconfig | Select-String "IPv4"
```

**⑤ 端口被占用**：启动时报 `EADDRINUSE`，换个端口：

```powershell
npm start -- --port=8080
```

（换了端口，发给同学的地址里的端口号也要一起改。）

#### 安全提醒

局域网模式下，**同一个网络里的人只要知道地址就能看**。如果笔记里有不希望别人看到的内容，用 `npm start -- --local` 启动，这样只有你自己能访问。

---

### 方案 B：公网临时分享（不在同一网络也能看）

原理：在本机和公网之间建一条"隧道"，把 `localhost:5173` 映射成一个公网网址。**你的电脑关掉，网址就失效。**

推荐 **Cloudflare Tunnel**（免费、不用注册账号、不限时）：

**第 1 步**：先启动网站（另开一个窗口，别关）

```powershell
cd D:\录音中转站\整理部署\NoteWeb
npm start
```

**第 2 步**：下载 cloudflared

打开 https://github.com/cloudflare/cloudflared/releases/latest ，下载 `cloudflared-windows-amd64.exe`，改名为 `cloudflared.exe`，放到一个好找的地方，比如 `D:\tools\cloudflared.exe`。

**第 3 步**：开一条隧道

**再开一个新的 PowerShell 窗口**（前一个窗口要一直留着跑服务器），执行：

```powershell
D:\tools\cloudflared.exe tunnel --url http://localhost:5173
```

等十几秒，它会打印出类似这样的一行：

```
+--------------------------------------------------------------------------------------------+
|  Your quick Tunnel has been created! Visit it at:                                          |
|  https://random-words-here.trycloudflare.com                                               |
+--------------------------------------------------------------------------------------------+
```

那个 `https://xxxx.trycloudflare.com` 就是**可以发给任何人的公网网址**，手机用流量也能打开。

**第 4 步**：分享完不想用了，在那个窗口按 `Ctrl + C` 关掉隧道，再关掉服务器窗口。网址随即失效。

> 注意：这是**临时**网址，每次重新执行命令都会生成一个新的随机网址。要固定网址得注册 Cloudflare 账号做命名隧道，或者直接用方案 C。
> ngrok 也是同类工具（`ngrok http 5173`），用过的话换成它也行。

---

### 方案 C：部署到静态托管（得到永久网址）

原理：把网站**打包成一堆普通网页文件**上传到托管平台，别人随时能访问，**你的电脑可以关掉**。

代价：**以后每次改笔记，都要重新发布一次**，网上才会更新。因为平台保存的是你发布那一刻的快照，它看不到你本地文件夹后续的变化。

**完整步骤请看 [`部署到网上.md`](部署到网上.md)**，这里只给个概览：

#### 第 1 步：打包

```powershell
cd D:\录音中转站\整理部署\NoteWeb
npm run build
```

输出在 `NoteWeb\dist\`。

> ⚠️ **有音乐库时别直接传这个 `dist`**：它现在有 **470 MB**（14 首 FLAC 占 467.9 MB，
> 单首最大 92.9 MB），而 Netlify / Cloudflare Pages 这类托管对体积很敏感
> （Netlify 官方建议整个站点 50 MB 以内、**单个文件 10 MB 以内**，超了会一直卡在 Uploading）。
>
> 只把笔记放上网、音频留本地听：双击 **`_打包网页版.bat`**（或设置环境变量
> `NW_NO_MUSIC=1`、`NW_DIST=dist-网页版` 再 `npm run build`），会生成
> `dist-网页版\`（**2.2 MB / 65 个文件**）和 `_发布包_网页版.zip`（0.74 MB），传这个秒过。
> 带音乐的 `dist\` 不会被覆盖，本地照旧能听。
>
> 想把音乐也放上网，需要先把音频压到单首 10 MB 以内（例如 MP3 160 kbps，14 首约 55 MB），本地无损件保持原样。

#### 第 2 步：先本地验证打包结果

```powershell
npm run preview
```

浏览器打开 **http://localhost:5174**，确认每一页都能点开、样式正常，再上传。

#### 第 3 步：选一个平台上传

| 平台 | 特点 | 更新方式 |
|---|---|---|
| **Netlify Drop** | 不注册、30 秒拿到网址 | 重新拖一次 `dist` 文件夹 |
| **Cloudflare Pages** | 国内访问通常更快 | 重新拖一次 `dist` 里的内容 |
| **GitHub Pages** | **配好一次后，`git push` 就自动更新** | 只需 `git add -A; git commit; git push` |

GitHub Pages 的自动发布流程已经写在项目里（`.github/workflows/deploy.yml`），
你把项目推上去、在仓库 **Settings → Pages → Source** 选 **GitHub Actions**，
以后每次 push 平台就会自己重新打包发布，不用再手动上传。

具体每个平台的点击路径、认证方式、常见报错处理，都在 **[`部署到网上.md`](部署到网上.md)**。

#### 发布前请确认

- 网上的静态站**基本没法加密码**，公开之后任何人都能访问。
- 用 GitHub Pages 时仓库必须是 **Public**，也就是**源码任何人都能看**。
- 所以发布前检查笔记里有没有：真实姓名 / 学号 / 手机号 / 邮箱 / 密码 / 老师同学的个人信息 / 有版权风险的课件。有就先删掉。

#### 提示：不要用 URL 里带查询参数的方式分享

网上的免费静态托管有些会把 `?p=xxx` 这种带问号的地址当成同一个页面，导致刷新后 404。本项目的静态打包用的是**每个笔记一个独立 html 文件**（`/n/web7to10.html`），所以不存在这个问题，放心分享。

---

## 三、想改网站的样子

| 想改什么 | 改哪里 |
|---|---|
| 网站标题、副标题 | `config.mjs` → `siteTitle` / `siteTagline` |
| 端口号 | `config.mjs` → `port` |
| 笔记来源文件夹 | `config.mjs` → `sourceDir` |
| 分类显示名 | `config.mjs` → `courseDisplay` |
| 分类排列顺序 | `config.mjs` → `courseOrder`（写关键词，能对上即可） |
| 某篇笔记的标题 | `config.mjs` → `noteTitles` |
| 配色、字号、间距 | `web/css/style.css` 顶部的 `:root` 变量 |
| 深色模式配色 | `web/css/style.css` 的 `[data-theme="dark"]` |
| **全站背景图（宫殿大厅）** | `web/img/bg-palace-day.webp`（浅色用）/ `bg-palace-night.webp`（深色用），浓淡改 `style.css` 里的 `--bg-veil` |
| 搜索、目录、深色模式等交互 | `web/js/app.js` |
| 页面结构（侧边栏、翻页） | `scripts/site.mjs` |
| Markdown 渲染规则 | `scripts/renderer.mjs` |

### 全站背景图怎么换、怎么调浓淡

- 图放在 `web/img/`，两套：**浅色模式用 `bg-palace-day.webp`（大厅昼景）**，**深色模式用 `bg-palace-night.webp`（大厅夜景）**，各约 100 KB（1920 宽、WebP）。
- 背景不是画在 `body` 上，而是 `body::before`（固定定位、铺满视口）——这样滚长文章时图片不会被拉长，手机上也不会失效。
- 图上面压了一层**同色半透明遮罩**保证字看得清：浅色 `--bg-veil: rgba(247,247,245,.83)`、深色 `rgba(18,20,26,.86)`。**想让图更明显就调小透明度**（例如 `.75`），想更淡就调大（例如 `.92`）。
- 换图：把自己的图按同样文件名放进 `web/img/` 重新打包即可；只想换一张也行（例如深色还用大厅夜景、浅色换成自己的图）。
- 打印时背景图会自动隐藏（省墨）。

> 图片来源：本机 DSH 皮肤插件 `maid-atelier`（女仆工坊）里的宫殿大厅场景图。自己本地/局域网用没问题；**如果要公开部署，注意这张图是别人做的美术素材**，公开场合最好注明来源或换成自己的图。


改完 `scripts/` 或 `site.mjs` → **重启服务器**（`Ctrl + C` 后重新 `npm start`）。
改 `web/css` 或 `web/js` → **刷新浏览器即可**，不用重启。

### 让服务器开机自动运行（可选）

如果希望电脑一开机笔记网站就在线，可以用"任务计划程序"：

1. 开始菜单搜 **任务计划程序**，打开
2. 右侧 **创建任务** → 常规里勾选"使用最高权限运行"
3. **触发器** → 新建 → "登录时"
4. **操作** → 新建 → 程序或脚本填 `D:\录音中转站\运行环境\nodejs\node.exe`，添加参数填 `scripts\serve.mjs`，起始于填 `D:\录音中转站\整理部署\NoteWeb`
5. 确定保存

以后开机登录后网站会自动在后台跑，同学随时能访问。

---

## 四、故障排查

| 现象 | 原因与解决 |
|---|---|
| `npm : 无法将"npm"项识别为...` | 现在**不需要装 Node.js**：本工作区自带（`..\..\运行环境\nodejs\`）。直接双击 `_启动网站.bat` / `_打包网站.bat` 就行；想在命令行里敲，用「一、日常使用」里的完整路径写法 |
| `EADDRINUSE` / 端口被占用 | 换端口：`npm start -- --port=8080` |
| 页面 404 / 笔记没更新 | 忘了同步：跑 `npm run sync` |
| 同学打不开局域网地址 | 见"方案 A 第 3 步排查"，八成是防火墙或不在同一网段 |
| 页面样式全没了（纯文字） | 说明用的不是服务器方式打开的。必须通过 `http://localhost:5173` 访问，不能双击 html 文件 |
| 笔记里出现原始 `**` 星号 | 源 markdown 的加粗语法写错了（正常情况程序会自动补救）。用 `npm run check` 看有没有异常 |
| 想彻底重来 | 删掉 `notes/` 和 `data/manifest.json`，重新 `npm run sync` |

---

## 五、技术说明（想了解原理再看）

- **Markdown 解析**：markdown-it 15（UMD 版，放在 `web/vendor/`），代码高亮用 highlight.js 11。都是本地文件，不联网可用。
- **中文标点的坑**：Markdown 官方规范要求结束的 `**` 后面还得有字符，所以 `**"变量一"可以放心重新赋值了**。` 这种以中文句号结尾的加粗会被官方解析器放弃解析。`renderer.mjs` 里加了一层补救（`repairBold`），本次 22 篇笔记里有若干篇、约 37 处受益。
- **本地模式**：服务器在**每次请求时**重新渲染 md 并返回完整 HTML，所以内容永远是最新的，不需要打包步骤，也不依赖浏览器的 fetch。
- **静态模式**：`build.mjs` 把每篇笔记预渲染成一个独立 html（`n/*.html`），资源用相对路径，因此放在任何子目录（包括 GitHub Pages 的 `/仓库名/`）都能正常显示。
- **实时刷新**：浏览器通过 `EventSource` 连到 `/__live`，服务器用 `fs.watch` 监听 `notes/`，有改动就推送事件让页面重载。静态部署时没有这个接口，会自动忽略、不报错。
- **自检**：`npm run check` 会跑一遍常见写法的渲染断言（表格、代码、引用、中文标点加粗、锚点、标题提取等）。

---

## 六、许可与来源

网站代码为本项目自建。内置的第三方库及其许可见 `web/vendor/VERSIONS.txt`、`markdown-it-LICENSE.txt`、`hljs-LICENSE.txt`。
