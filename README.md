# 捏捏跑酷 · PINCH RUN

玩具厂倒闭那晚，车间里没做完的小家伙全跑了。

一个纯前端的 3 跑道无尽跑酷网页游戏（手机上玩）。**零外部素材**——15 个角色、8 张景片、
全部障碍与场景，都是代码程序化生成的；音效与 BGM 由 Web Audio 实时合成。
没有一张贴图文件，没有一个模型文件。

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

CLI 自动忽略 `node_modules/`，并遵循 `.gitignore`（所以 `shots/`、`.edgeone/` 不会被打包上传）。

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

验证：打开 `https://naiwa-parkour-xunozih0.edgeone.cool/api/rank?diff=normal`
应该返回 `{"ok":true,"list":[...],"total":N}` 而不再是 `KV 未绑定`。

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

## 目录结构

```
index.html            入口，含全部界面骨架与启动脚本
css/style.css         全部界面样式（HUD、菜单、面板、结算）
js/config.js          常量、13 个角色数据、道具、成就、存档系统
js/world.js           出逃路线（8 张景片）、难度、衣橱、障碍图鉴、挑战之路
js/audio.js           Web Audio 实时合成音效与循环 BGM（无音频文件）
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

- 角色、场景、音效全部原创，代码生成，不含任何第三方素材文件。
- 玩法灵感来自《地铁跑酷（Subway Surfers）》，角色与美术为原创设计。
