# 捏捏跑酷 · PINCH RUN

玩具厂倒闭那晚，车间里没做完的小家伙全跑了。

一个纯前端的 3 跑道无尽跑酷网页游戏（手机上玩）。**除了一首 BGM，零外部素材**——
15 个角色、8 张景片、全部障碍与场景都是代码程序化生成的；
音效与「八音盒」BGM 由 Web Audio 实时合成。没有一张贴图文件，没有一个模型文件。

世界观是一张**手工微缩景观**：冰棍棒当枕木、瓦楞纸当道砟、快递箱当楼房、纽扣当金币，
一盏暖台灯从右后方打光，影子软软地摊在地上。

## 在线游玩

**https://naiwa-parkour-xunozih0.edgeone.cool**

本地跑：`node tools/serve.js 8899`，然后开 `http://localhost:8899`

## 部署

线上跑在 **EdgeOne Pages（国内站）**，项目 `naiwa-parkour` / ID `makers-fslmnfenvrcn`。

⚠️ 注意：这个项目是**直传（direct upload）类型**，不是 Git 连接类型——
**推 GitHub 不会触发自动部署**，改完要手动跑一次：

```bash
git push origin main                  # 1. 先把代码推到 GitHub（留个版本）
PAGES_SOURCE=skills edgeone makers deploy   # 2. 再直传到 EdgeOne（production 环境）
```

`edgeone` CLI 全局已装（当前 1.6.33，要求 ≥ 1.2.30），账号已登录。
部署会输出一行 `EDGEONE_DEPLOY_URL=`，里面带 `?eo_token=...` 参数——
**这串参数不能截断**，但实测去掉 token 也能正常访问，稳定地址就是上面那个域名。

⚠️ **直传部署不遵循 `.gitignore`**（只有 `node_modules/` 是 CLI 单独排除的）。
项目目录里的东西会原样打进上传包——`shots/` 是开发截图，几十 MB，
留在项目里会拖垮上传，典型表现是 `edge-functions/index.js`、`project.json`
这些关键文件 ECONNRESET 上传失败 → 部署 Failed。
**部署前先把 `shots/` 挪出项目目录**，传完再挪回来：

```bash
mv shots ../.naiwa-shots-hold                    # 1. 挪走开发截图
PAGES_SOURCE=skills edgeone makers deploy --json # 2. 直传（--json 拿一行机器可读结果）
mv ../.naiwa-shots-hold shots                    # 3. 挪回来
```

另外 `edgeone makers deploy` 的退出码和回显都不完全可信——
**别只看退出码**，用 `curl` 打线上端点看实际响应才算数
（比如 `/api/rank` 的返回里带 `howto` 字段就说明是新版）。

### 自定义域名（短链）

默认域名 `naiwa-parkour-xunozih0.edgeone.cool` 太长，绑了用户自己的子域名：

> **https://run.liuyushan.top** （正式地址）

（`liuyushan.top` 已在腾讯云完成 ICP 备案，国内可走大陆节点。
⚠️ 用户明确**不要用根域 `liuyushan.top`**——根域留着做别的，这个项目只占 `run` 子域。）

⚠️ **绑域名只能在控制台做，CLI 没有这个能力**——排查过：`edgeone makers` 没有 domain
子命令，`edgeone.schema.json` 里也没有 domain 字段，CLI 包里只有 `DescribePagesZones`
（那是 AI Gateway 的接口）。配置式绑定这条路走不通。

步骤：控制台 → 项目详情 → **域名管理** → 添加自定义域名 → 填 `run.liuyushan.top`
→ 按弹窗在**阿里云云解析**加记录 → 证书自动签发。

域名现状（2026-10-05 实测）：
- NS 是 `dns23.hichina.com`，所以加记录要去**阿里云云解析**，不是 DNSPod。
- `site.liuyushan.top` 已占用（河科大新生指南站）；`download.liuyushan.top` 已占用（闪星勇者安装包）。
- 根域 `@` 和 `www` 各有一条废弃 A 记录 → `82.156.57.227`（端口能连但不应答 HTTP），
  绑子域不用管它。

⚠️ 阿里云冲突规则有个**反直觉**的点：根域 `@` 上 CNAME 与 TXT 不冲突，
但**非根域（子域）上 CNAME 与 TXT 冲突**（RFC 规定 CNAME 不能与其他记录共存）。
我原先担心 EdgeOne 会在 `run` 子域上要一条同名的 TXT 归属权验证记录、于是卡住——
**实测不会**：EdgeOne 只让你加**一条 CNAME**，验证跟着 CNAME 走，没有 TXT 记录。
这条担心作废，记在这儿免得下次再绕一遍。

实测结果（2026-10-05）：

    run.liuyushan.top → run.liuyushan.top.pages.dnsoe6.com → 43.174.247.110 / 43.174.246.110

证书自动签发：`CN=run.liuyushan.top`，签发者 TrustAsia，有效期 2026-10-05 ~ 2027-01-02。

⚠️ **本机 curl 打不通这个域名**（走代理时 TLS 在 ALPN 后就断，退出码 35），
但**浏览器打得通**。要验证域名是否真的活着，别用 curl，用 `tools/shot.js` 跑一次无头浏览器。

代码侧不用改：全项目没有任何写死的域名，接口和分享都用相对路径 / `location`。

## 后端

线上跑 **EdgeOne Pages 边缘函数 + KV 命名空间**，两个端点：

| 端点 | 方法 | 用途 |
| --- | --- | --- |
| `/api/rank` | GET | 取云端排行榜（按 `map` / `diff` 过滤），返回 `list` + `total` |
| `/api/rank` | POST | 上传成绩 `{name,score,dist,map,diff}`，返回 `rank` 与玩家码 |
| `/api/save` | POST | 存进度 `{code?,data}`，返回 6 位取件码 |
| `/api/save` | GET | 按取件码取回进度 |

三档难度各有各的榜（KV key 带 `diff`）；同名同图的玩家只留最好成绩，榜单截到 300 条。
存档只收 `coins / chars / best / bestByMap / skills …` 这些进度字段，单份上限 48KB，
取回时**往多了并**（数值取大、列表取并集），不会把本机现有进度冲掉。

### 开启：绑定 KV

这两个端点都靠 KV 落数据。**没绑定时它们照常跑，只是返回 `{"ok":false,"error":"KV 未绑定"}`，
前端把云端那几块折起来、退回纯单机，不会报错。** 绑定的步骤（控制台操作，一次就行）：

1. 打开 [EdgeOne 控制台](https://console.cloud.tencent.com/edgeone) → 「存储」→「KV 命名空间」
   → 新建命名空间，名字随意（比如 `pinchrun-kv`）。
2. 回到项目 `naiwa-parkour` → 「边缘函数」/「环境变量与绑定」→ 绑定 KV，
   **变量名一定填 `KV`**（大小写敏感，代码里按这个名字取）。
3. 重新部署一次：`PAGES_SOURCE=skills edgeone makers deploy`。

验证：打开 `https://run.liuyushan.top/api/rank?diff=normal`
应该返回 `{"ok":true,"list":[...],"total":N}` 而不再是 `KV 未绑定`。

**实测（2026-10-05，命名空间 `run_game`、变量名 `KV`）**，四项都过：

| 用例 | 结果 |
| --- | --- |
| `GET /api/rank?diff=normal` | `{"ok":true,"list":[],"total":0}` —— 不再是「KV 未绑定」 |
| `POST /api/save` 建一份档，再 `GET` 读回 | 拿到码 `W2Y83N`，字段原样返回 |
| `POST /api/rank` 同名连传两次（4321 → 9999） | `total` 始终 1、玩家码不变 —— 同名合并生效，没重复插入 |
| `GET /api/save?code=ZZZZZZ` | `没找到这个存档码`（404 语义正确） |

⚠️ **验证完记得清掉测试数据**——榜单是玩家能看见的，留一条「KV自检 9999 分」很难看。
KV 没有 HTTP 层的删除接口，`edgeone` CLI 也没有 KV 子命令（只有 init/dev/deploy/link/claim/create），
所以清理得临时部署一个带 token 的一次性端点、调完立刻删掉重部署。
（KV API 本身有 `delete(key)` 和 `list({prefix,limit,cursor})`，注意 key 只允许字母数字下划线。）

本地 `node tools/serve.js` 只服务静态文件，没有边缘函数运行时，
所以本地面板里云端那块会显示"连不上"——这是正常的，不影响单机玩。

## 玩法

| 操作 | 键盘 | 触屏 |
| --- | --- | --- |
| 左右变道 | ← / → 或 A / D | 左右滑动、底部箭头按钮 |
| 跳跃 | ↑ / W | 上滑、点按屏幕、跳按钮 |
| 滑铲 | ↓ / S | 下滑、铲按钮 |
| 悬浮板 | 空格 / Shift / B | 双击屏幕、右上角悬浮板按钮 |
| 暂停 | P / Esc | 右上角暂停按钮 |

核心系统：

- **三条轨道**：护栏、交通锥、垃圾箱（跳），限高架（滑铲），隧道（滑铲）
- **车厢**：矮车厢可直接跳上车顶，中车厢靠跑鞋或斜坡，高车厢只能变道；迎面列车有警示提示
- **道具**：金币磁铁 / 喷射背包 / 双倍金币 / 超级跑鞋 / 悬浮板（挡一次撞击）/ 护盾
- **追逐**：撞一次引来追兵（铁皮发条**检票员** + 他那只**铁皮狗**），7 秒内再撞就被抓
- **难度**：简单 / 普通 / 困难，三档速度曲线与障碍密度
- **模式**：无尽奔跑 / 60 秒挑战
- **昼夜天气**：晴日 / 黄昏 / 霓虹夜 / 雨夜，平滑过渡
- **角色**：13 个可解锁角色，材质各异（黏土 / 纸板 / 毛线 / 铁皮 / 橡皮 / 毛毡 / 木头 /
  塑料 / 瓷 / 透明 / 黄铜 / 金属 / 棉花），各自带被动技能，每人 6 套配色
- **成长**：金币商店、技能升级、每日任务（按日期种子生成）、15 个成就、最佳成绩记录
- **BGM 音源**：设置里可在「八音盒」（实时合成，默认）和「原声」（`audio/bgm-sport.mp3`）
  之间切；浏览器不支持 MP3 时会如实显示并自动回落到八音盒

存档默认在浏览器 `localStorage`（键名 `pinchRun.save.v1`）；榜单和跨设备进度走上面的云端端点。

## 渲染

两套渲染器共用同一套游戏逻辑，靠一层接缝切换：

- **3D（默认）**：Three.js r170，`vendor/three.min.js` 本地化打包（全局 IIFE，不联网）
- **2D（回退）**：Canvas 2D 伪 3D 透视投影，`js/draw.js`

`index.html` 启动时调 `Pinch3D.init()`，成功则 `Object.assign(Renderer, Pinch3D.api)` 整体替换渲染实现，
失败自动退回 2D。游戏逻辑（`js/game.js`）对用哪套渲染器无感知。

3D 侧的美术手段：顶点扰动做出「捏痕」、BackSide 描边、flatShading 哑光、
6 步定格动画、网格池复用（不产生 GC 抖动）、自适应画质。
地面阴影用**贴地软斑**而不是 shadowMap——手机上每帧重画全场太贵，
而且柔光箱拍出来的微缩模型，边缘化开的软影本来就更对。

⚠️ 一个坑，改代码前先看：相机朝 +z 看、+y 朝上时，「屏幕右」对应的世界方向是 **-x**
（`cross(up, -forward)`），但游戏世界和 2D 渲染器都约定「世界 +x 在屏幕右」。
两边不一致的结果是按 ← 角色往右跑。所以 `init()` 把三个挂载点整体塞进
`scale.x = -1` 的镜像组，相机 / 灯 / 天空幕布 / `proj` 这几个不在组里的手动取负。
整体镜像而不是逐个取负，是因为逐个取负会漏掉旋转（绕 y、绕 z 的旋转也要反号）。

### 画质：别拿分辨率换性能

**渲染分辨率是观感的第一决定因素，比任何特效都重要。** 这条踩得很深。

分辨率被三个旋钮各自压过一遍，而且它们是**相乘**的：

| 旋钮 | 位置 | 老值 | 现在 |
| --- | --- | --- | --- |
| `DPR_MAX[quality]` | `js/config.js` | 1.5 / 1.25 / 0.95 | 2.0 / 1.75 / 1.25 |
| `Renderer.dprScale` | `js/game.js` `trackFps()` | 1 → 0.84 → 0.68 | 1 → 0.90 → 0.82 |
| `Pinch3D.resScale` | `js/pinch3d.js` `tickPerf()` | 1 → … → 0.62 | 1 → … → 0.86 |

手机上 `devicePixelRatio` 普遍是 2~3，被 `DPR_MAX.mid = 1.25` 一压就只剩一半，
再乘 0.68 和 0.62 —— 最终渲染分辨率只有屏幕的 **约 53%**，被浏览器拉伸铺满全屏。
玩家的原话是「**感觉就跟打了一层马赛克一样**」。

改完之后画布从 `355x770` 变成 `682x1477`，像素量 1.83 倍。
`antialias` 也打开了 —— 箱体边缘的锯齿在低分辨率下会被放大成"脏边"。

**降档阈值也别设太高**：`trackFps` 原来 52fps 就降档，可很多手机稳定在 50fps 上下，
本来玩着不卡，却被判成性能不足降到糊画质。现在放到 46fps。

⚠️ **两个动态旋钮是相乘关系**，改其中一个之前先看另一个，别让它们同时往低处跑。

#### 顺带挖出来的：2D 叠加层只清了 1/dpr 的宽度

`drawSky()` 里清 2D 叠加层时写的是：

```js
c2.setTransform(Renderer.dpr, 0, 0, Renderer.dpr, 0, 0);
c2.clearRect(0, 0, Renderer.W / Renderer.dpr, Renderer.H / Renderer.dpr);   // ← 错
```

`setTransform(dpr, ...)` 之后逻辑坐标系**就等于 CSS 像素坐标系**了，
所以清满整张位图应该用 `Renderer.W` / `Renderer.H`，**不能再除一次 dpr**。
除以 dpr 只会清掉 `1/dpr` 的宽度：dpr=1.25 时清 80%，dpr=1.75 时只剩 57%，
剩下那半边留着上一帧的旧天空（不透明），把 3D 层整个盖住 ——
表现就是「**画面只有左半边是 3D，右半边一块死色**」。

这个 bug 在 dpr=1 时完全看不出来，所以一直潜伏着，**把 DPR_MAX 提上去才炸出来**。
同文件里 5 处同类写法（`clearRect` / `drawWeather` / `overlay` / `grain` / `vignette`）一并修正。

教训：改渲染分辨率这种"全局旋钮"时，要连带回归检查所有按 dpr 换算尺寸的地方。

### 性能上踩过的坑

手机上真正吃性能的是 **draw call 数**，不是 JS。目前一场对局平均 ~125 个
（优化前 205~233）。几处关键改动：

- **描边整批剔除**：角色/物体的 BackSide 描边 mesh 全挂 `layer 1`，
  低画质或低分辨率时 `camera.layers.disable(1)` 一把关掉，省掉三四十个 draw call。
- **每帧 `new THREE.Color()` 是隐形杀手**：`drawSky` 每帧 new 5 个（一秒 300 个），
  楼房亮度抖动、`dark()` 颜色微调也是每次调用都 new 一个再转字符串。
  前者按「夜色档 + 主题 + 两色」缓存，后者按 `hex|k` 建备忘表——一秒上千次分配全免。
- **远景楼只留剪影**：一栋楼的窗户/空调/雨棚/天线加起来十几个 draw call，
  而 44 米外它们只有几个像素大，直接跳过。
- **自适应画质不能是棘轮**：以前降档后永远升不回来，还直接改玩家选的 `quality`
  （面板显示"中"实际跑 low）。现在只动 `resScale` 这一个动态旋钮，
  降档看**最差帧**（体感卡顿来自长帧，不是平均值），升档要求连续两个窗口都稳。
  同理 `Game.trackFps` 的 `dpr` 也改成双向可逆。
- 天空/楼房那几处颜色缓存，见 `js/pinch3d.js` 的 `dark()` 与 `drawSky()`。

## 目录结构

```
index.html            入口，含全部界面骨架与启动脚本
css/style.css         全部界面样式（HUD、菜单、面板、结算）
js/config.js          常量、13 个角色数据、道具、成就、存档系统
js/world.js           出逃路线（8 张景片）、难度、衣橱、障碍图鉴、挑战之路
js/audio.js           Web Audio 实时合成音效 + 八音盒 BGM，兼管「原声」音轨的播放/切换
js/chars.js           2D 角色绘制（矢量骨架 + 跑步/跳跃/滑铲/翻滚动画）
js/pinchchars.js      3D 角色建模与动画（程序化几何 + 定格动画）
js/draw.js            2D 回退渲染器：透视投影、天地景、铁轨、接触网、车厢、粒子
js/pinch3d.js         3D 渲染器（Three.js）：天空、轨道、城市、软影、网格池、自适应画质
js/artwork.js         外部素材管线（已停用，manifest 为空，恒返回 null）
js/ui.js              界面交互、商店、任务、成就、设置
js/panels.js          面板系统（出逃路线 / 障碍图鉴 / 挑战之路 / 服装商城 / 排行榜 / 加入我们）
js/game.js            游戏主循环、物理、碰撞、道具、追逐、关卡生成器
functions/api/rank.js 云端排行榜边缘函数
functions/api/save.js 云端存档边缘函数
audio/bgm-sport.mp3   可选原声 BGM（CC0 公有领域，设置里切「原声」才加载）
vendor/three.min.js   Three.js r170（本地打包，全局 IIFE）
tools/selftest.js     headless 自测（mock canvas/DOM 跑完整对局 + 智能 bot 可通过性验证）
tools/test-collide.js 碰撞回归测试：直接驱动 Game.update()，含掉帧/迎面列车穿模用例
tools/test-api.mjs    云端接口回归测试：用内存假 KV 跑排行榜与存档的读写
tools/serve.js        极简静态服务器
tools/shot.js         用本机 Edge 无头模式截图（开发自用）
tools/zoom.js         放大截图局部（排查渲染问题用）
```

## 开发自测

```bash
npm test              # 主自测：完整游戏循环 + 智能 bot 可通过性
npm run test:collide  # 碰撞回归（需要先 npm run serve）
npm run test:api      # 云端接口回归（内存假 KV，不需要真后端）
```

`selftest.js` 用 mock 的 DOM / canvas / localStorage 跑完整游戏循环：13 个角色绘制、面板、
商店、4 分钟随机输入对局、5 分钟智能 bot 生存、音频、存档读写，并捕捉 NaN 绘制参数。
bot 会读赛道信息做避让，用来验证「关卡一定有解」（不会三条道全封死）。

`test-collide.js` 直接驱动 `Game.update()` 不看画面，专门盯碰撞：
掉帧下最高速冲栏杆、迎面列车 78m/s 对撞、跳跃过栏杆、滑铲过高栏、跳上车顶、相邻车道不误伤。
其中**穿模用例是回归重点**——旧版用 `travel ± 0.42` 的瞬时窗口（共 0.84m）判定，
而最高速一帧就走 1.57m（掉帧时），整段障碍会从窗口里跳过去不触发碰撞。
现在改成扫掠区间（上一帧位置 → 这一帧位置），不会再漏。

`test-api.mjs` 把边缘函数复制到临时 `.mjs` 再 import，配一个内存 Map 当 KV，
把排行榜的覆盖/隔离/注入过滤和存档的存/取/超限/空码全跑一遍。

## 调试参数

网址后追加查询参数，仅用于开发和截图，不影响正常游玩：

- `?dev=run` 直接开跑；`&god=1` 无敌；`&warp=900` 快进 900 帧后冻结
- `&theme=night|dusk|rain|day` 指定天气
- `&q=high|mid|low` 锁定画质；`&noperf=1` 关掉自适应降档
- `?chars=1` 角色面板；`?panel=maps|codex|path|outfits|rank|join` 指定面板
- `&skin=ni` 指定角色

## 说明

- 角色、场景、音效全部原创，代码生成。
- 唯一的外部文件是 `audio/bgm-sport.mp3`（设置里「BGM 音源 → 原声」才会用到）：
  **Retro Sports (Stage 3) — Juhani Junkala / SubspaceAudio**，
  **CC0 1.0 公有领域**（来源 OpenGameArt `12-music-loops`）。
  原始素材是 OGG，本地用 ffmpeg 转成 128kbps MP3 并去掉 Xing 头做成整 60 秒无缝循环
  ——iOS Safari 不支持 OGG，统一出 MP3。不想用外部文件就把设置切回「八音盒」。
- 玩法灵感来自《地铁跑酷（Subway Surfers）》，角色与美术为原创设计。
