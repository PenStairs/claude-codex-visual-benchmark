<div align="center">
  <img src="assets/readme/hero.jpg" alt="Claude、Codex 与任意模型视觉测评" width="100%" />
</div>

<div align="center">

[English](README.md) · [简体中文](README.zh-CN.md)

**最全、最好看、还能复现的 Claude、Codex 与自定义模型视觉测评工具。**

一条真实提示词，两个隔离 Agent，一份可以反复观看的视觉证据。

<a href="docs/benchmark-gallery.md"><img src="https://img.shields.io/badge/浏览评测-7c3aed?style=for-the-badge" alt="浏览评测" /></a>
<a href="docs/quick-start.zh-CN.md"><img src="https://img.shields.io/badge/运行自己的对比-0284c7?style=for-the-badge" alt="运行自己的对比" /></a>

</div>

## 精选测评画面

<img src="assets/readme/benchmark-highlights.jpg" alt="六个精选原帖视频画面：程序化世界、沉没城市、日系街道、赛博朋克竞速、调查板和安妮女王复仇号" width="100%" />

上图直接从公开原帖视频中挑选画面并拼成，没有包含 Tweet 界面。六个案例分别是[程序化 3D 世界](https://x.com/slash1sol/status/2084590501685043400)、[沉没城市](https://x.com/emollick/status/2064424775527624736)、[日系郊区街道](https://x.com/gmi_cloud/status/2080834581247435102)、[赛博朋克悬浮车竞速](https://x.com/eyishazyer/status/2072677773655838950)、[犯罪调查板](https://x.com/0x0SojalSec/status/2085440893994365214)和[安妮女王复仇号](https://x.com/TimJayas/status/2087474534924550433)。

<sub>原帖媒体帧采集于 2026-09-03，用于提示词发现和来源说明，不是本仓库运行出来的测评成绩。媒体版权仍属于对应创作者；收录不代表本项目拥有、背书或已独立复现原帖效果。</sub>

### 本项目真实运行样例

<img src="assets/readme/sample-military-armory.png" alt="GPT-5.6 Sol 与 Claude Fable 5.1 的真实 Three.js 军械库对比画面" width="100%" />

<p align="center"><sub>上方 GPT-5.6 Sol，下方 Claude Fable 5.1；两边使用同一条 Three.js 提示词和同一套录制策略。这个真实样例用于展示输出形式，不代表任何模型在所有任务中普遍获胜。</sub></p>

## 浏览测评库

<img src="assets/readme/explore.svg" alt="浏览 18 条 Three.js 提示词、2 条 Twigl 提示词、11 个模型配置和自定义模型组合" width="100%" />

<table>
  <tr>
    <th width="33%">按测评方式</th>
    <th width="34%">按模型系列</th>
    <th width="33%">按结果状态</th>
  </tr>
  <tr>
    <td valign="top">
      <a href="docs/prompt-gallery.md#threejs-18"><strong>Three.js</strong></a> · 18 个世界<br />
      <a href="docs/prompt-gallery.md#twigl-2"><strong>Twigl</strong></a> · 2 个 Shader
    </td>
    <td valign="top">
      <a href="docs/model-gallery.md"><strong>Claude</strong></a> · <a href="docs/model-gallery.md"><strong>Codex</strong></a> · <a href="docs/model-gallery.md"><strong>DeepSeek</strong></a> · <a href="docs/model-gallery.md"><strong>GLM</strong></a> · <a href="docs/add-your-model.zh-CN.md"><strong>Custom</strong></a>
    </td>
    <td valign="top">
      <a href="benchmarks/official/README.md"><strong>Official</strong></a> · <a href="benchmarks/community/README.md"><strong>Community</strong></a> · <a href="https://github.com/PenStairs/claude-codex-visual-benchmark/releases/latest"><strong>Latest</strong></a>
    </td>
  </tr>
</table>

[浏览全部提示词](docs/prompt-gallery.md) · [查看全部模型](docs/model-gallery.md) · [打开测评结果画廊](docs/benchmark-gallery.md)

## 任意选择两个模型

比较哪两个模型完全由用户决定。可以选两个内置配置、添加两个私有配置，也可以混合使用。“模型配置”会同时声明模型、供应商端点、鉴权类别、Runner 和推理档位，所以同一个底层模型可以有多个不同执行路径。

<img src="assets/readme/runner-routing.svg" alt="模型 A 与模型 B 分别选择 Codex CLI 或 Claude Code Runner，写入隔离工作区后再合并视频" width="100%" />

| Runner 路径 | 内置配置数 | 兼容方式 |
|---|---:|---|
| **Codex CLI** | 6 | OpenAI 原生登录、Responses 兼容端点 |
| **Claude Code** | 5 | Anthropic 原生登录、Anthropic 兼容端点 |
| **自定义配置** | 不限 | 经过验证、使用上述任一 Runner 的模型配置 |

[添加 OpenAI Responses 兼容模型](examples/custom-models/openai-responses-compatible.json) · [添加 Anthropic 兼容模型](examples/custom-models/anthropic-compatible.json) · [阅读自定义模型说明](docs/add-your-model.zh-CN.md)

## 运行流程

<img src="assets/readme/workflow.svg" alt="同一条提示词、两个 Agent、隔离工作区、验证、录屏和最终合并视频" width="100%" />

**Same prompt → two agents → isolated workspaces → verify → record → merge。**

两个 Agent 接收相同的标准化提示词字节和等价的干净脚手架。系统验证两边项目，按照相同的浏览器运动方式录制，再输出一条适合 X 发布的高清 H.264 对比视频。计划哈希、耗时、Token、录屏参数、修复、重试和失败原因都保留在本地运行报告中。

整个流程默认在本地完成。代码和证据保存在被 Git 忽略的 `runs/`；凭据保留在 CLI 原生登录状态或环境变量里。只有用户明确选择发布时，最终视频才会上传。

## 每条提示词的案例

每条提示词都有来自原帖媒体的视觉帧、直接 X 来源、实际测评文本、方法分类和独立证据页面。点击缩略图可以打开完整记录。

<table>
  <tr>
    <td width="33%" valign="top"><a href="docs/prompts/anime-japanese-suburban-street-v1.md"><img src="assets/readme/prompt-thumbnails/anime-japanese-suburban-street-v1.jpg" alt="日系动漫郊区街道原帖视频画面" width="100%" /></a><br /><strong>日系动漫郊区街道</strong><br /><sub>Three.js · <a href="https://x.com/gmi_cloud/status/2080834581247435102">X 原帖</a></sub></td>
    <td width="34%" valign="top"><a href="docs/prompts/city-eating-hole-game-v1.md"><img src="assets/readme/prompt-thumbnails/city-eating-hole-game-v1.jpg" alt="吞噬城市的黑洞游戏原帖视频画面" width="100%" /></a><br /><strong>吞噬城市的黑洞游戏</strong><br /><sub>Three.js · <a href="https://x.com/givros/status/2078391824343880158">X 原帖</a></sub></td>
    <td width="33%" valign="top"><a href="docs/prompts/cod-zombies-clone-v1.md"><img src="assets/readme/prompt-thumbnails/cod-zombies-clone-v1.jpg" alt="COD 僵尸模式复刻原帖视频画面" width="100%" /></a><br /><strong>COD 僵尸模式复刻</strong><br /><sub>Three.js · <a href="https://x.com/om_patel5/status/2064549188671508690">X 原帖</a></sub></td>
  </tr>
  <tr>
    <td valign="top"><a href="docs/prompts/crime-investigation-board-v1.md"><img src="assets/readme/prompt-thumbnails/crime-investigation-board-v1.jpg" alt="3D 犯罪调查板原帖视频画面" width="100%" /></a><br /><strong>3D 犯罪调查板</strong><br /><sub>Three.js · <a href="https://x.com/0x0SojalSec/status/2085440893994365214">X 原帖</a></sub></td>
    <td valign="top"><a href="docs/prompts/crossy-road-game-v1.md"><img src="assets/readme/prompt-thumbnails/crossy-road-game-v1.jpg" alt="天天过马路游戏原帖视频画面" width="100%" /></a><br /><strong>高质量《天天过马路》游戏</strong><br /><sub>Three.js · <a href="https://x.com/markksantos/status/2068962823007285628">X 原帖</a></sub></td>
    <td valign="top"><a href="docs/prompts/cyberpunk-hovercar-racing-v1.md"><img src="assets/readme/prompt-thumbnails/cyberpunk-hovercar-racing-v1.jpg" alt="赛博朋克悬浮车竞速原帖视频画面" width="100%" /></a><br /><strong>赛博朋克悬浮车竞速</strong><br /><sub>Three.js · <a href="https://x.com/eyishazyer/status/2072677773655838950">X 原帖</a></sub></td>
  </tr>
  <tr>
    <td valign="top"><a href="docs/prompts/eiffel-tower-paris-v1.md"><img src="assets/readme/prompt-thumbnails/eiffel-tower-paris-v1.jpg" alt="巴黎埃菲尔铁塔原帖视频画面" width="100%" /></a><br /><strong>巴黎埃菲尔铁塔</strong><br /><sub>Three.js · <a href="https://x.com/Bhavani_00007/status/2079944268744155325">X 原帖</a></sub></td>
    <td valign="top"><a href="docs/prompts/european-roulette-wheel-v1.md"><img src="assets/readme/prompt-thumbnails/european-roulette-wheel-v1.jpg" alt="写实欧式轮盘原帖视频画面" width="100%" /></a><br /><strong>写实欧式轮盘</strong><br /><sub>Three.js · <a href="https://x.com/thehypedotnews/status/2077924746415518033">X 原帖</a></sub></td>
    <td valign="top"><a href="docs/prompts/japanese-castle-v1.md"><img src="assets/readme/prompt-thumbnails/japanese-castle-v1.jpg" alt="程序化日本城堡原帖视频画面" width="100%" /></a><br /><strong>程序化日本城堡</strong><br /><sub>Three.js · <a href="https://x.com/karankendre/status/2025624483000963350">X 原帖</a></sub></td>
  </tr>
  <tr>
    <td valign="top"><a href="docs/prompts/las-vegas-slot-machine-v1.md"><img src="assets/readme/prompt-thumbnails/las-vegas-slot-machine-v1.jpg" alt="拉斯维加斯老虎机原帖视频画面" width="100%" /></a><br /><strong>拉斯维加斯老虎机</strong><br /><sub>Three.js · <a href="https://x.com/thehypedotnews/status/2077924746415518033">X 原帖</a></sub></td>
    <td valign="top"><a href="docs/prompts/military-armory-v1.md"><img src="assets/readme/prompt-thumbnails/military-armory-v1.jpg" alt="写实军械库原帖对比视频画面" width="100%" /></a><br /><strong>写实军械库</strong><br /><sub>Three.js · <a href="https://x.com/Bhavani_00007/status/2077798166729208223">结果原帖</a> · <a href="https://x.com/Bhavani_00007/status/2077895351600918899">提示词</a></sub></td>
    <td valign="top"><a href="docs/prompts/offshore-rocket-landing-v1.md"><img src="assets/readme/prompt-thumbnails/offshore-rocket-landing-v1.jpg" alt="海上火箭回收模拟原帖视频画面" width="100%" /></a><br /><strong>海上火箭回收模拟</strong><br /><sub>Three.js · <a href="https://x.com/Cryptor_dot/status/2076083000777883785">X 原帖</a></sub></td>
  </tr>
  <tr>
    <td valign="top"><a href="docs/prompts/open-world-bazooka-rpg-v1.md"><img src="assets/readme/prompt-thumbnails/open-world-bazooka-rpg-v1.jpg" alt="开放世界火箭筒 RPG 原帖视频画面" width="100%" /></a><br /><strong>开放世界火箭筒 RPG</strong><br /><sub>Three.js · <a href="https://x.com/dangreenheck/status/2064736699469459753">X 原帖</a></sub></td>
    <td valign="top"><a href="docs/prompts/procedural-3d-world-v1.md"><img src="assets/readme/prompt-thumbnails/procedural-3d-world-v1.jpg" alt="程序化可探索 3D 世界原帖视频画面" width="100%" /></a><br /><strong>程序化可探索 3D 世界</strong><br /><sub>Three.js · <a href="https://x.com/slash1sol/status/2084590501685043400">X 原帖</a></sub></td>
    <td valign="top"><a href="docs/prompts/procedural-character-generator-v1.md"><img src="assets/readme/prompt-thumbnails/procedural-character-generator-v1.jpg" alt="程序化角色生成器原帖视频画面" width="100%" /></a><br /><strong>程序化角色生成器</strong><br /><sub>Three.js · <a href="https://x.com/TimJayas/status/2073250825858892241">X 原帖</a></sub></td>
  </tr>
  <tr>
    <td valign="top"><a href="docs/prompts/queen-annes-revenge-v1.md"><img src="assets/readme/prompt-thumbnails/queen-annes-revenge-v1.jpg" alt="安妮女王复仇号原帖视频画面" width="100%" /></a><br /><strong>安妮女王复仇号</strong><br /><sub>Three.js · <a href="https://x.com/TimJayas/status/2087474534924550433">X 原帖</a></sub></td>
    <td valign="top"><a href="docs/prompts/steam-engine-prototype-v1.md"><img src="assets/readme/prompt-thumbnails/steam-engine-prototype-v1.jpg" alt="可运行蒸汽机原型原帖视频画面" width="100%" /></a><br /><strong>可运行蒸汽机原型</strong><br /><sub>Three.js · <a href="https://x.com/vikktorrrre/status/2090369860672856279">X 原帖</a></sub></td>
    <td valign="top"><a href="docs/prompts/wright-flyer-v1.md"><img src="assets/readme/prompt-thumbnails/wright-flyer-v1.jpg" alt="莱特飞行器原帖视频画面" width="100%" /></a><br /><strong>莱特飞行器</strong><br /><sub>Three.js · <a href="https://x.com/TimJayas/status/2087277264744718510">X 原帖</a></sub></td>
  </tr>
  <tr>
    <td valign="top"><a href="docs/prompts/drowned-city-v1.md"><img src="assets/readme/prompt-thumbnails/drowned-city-v1.jpg" alt="无限新哥特式沉没城市原帖视频画面" width="100%" /></a><br /><strong>无限新哥特式沉没城市</strong><br /><sub>Twigl · 两轮 · <a href="https://x.com/emollick/status/2064424775527624736">X 原帖</a></sub></td>
    <td valign="top"><a href="docs/prompts/lost-carcosa-v1.md"><img src="assets/readme/prompt-thumbnails/lost-carcosa-v1.jpg" alt="失落的卡尔克萨原帖视频画面" width="100%" /></a><br /><strong>失落的卡尔克萨</strong><br /><sub>Twigl · <a href="https://x.com/emollick/status/2091001394534707474">X 原帖</a></sub></td>
    <td valign="top"><strong>添加下一个案例</strong><br /><br />一条来源清楚的 Three.js 或 Twigl 提示词，可以成为下一个测评案例。<br /><br /><a href="CONTRIBUTING_PROMPTS.md">贡献提示词 →</a></td>
  </tr>
</table>

<sub>画面于 2026-09-03 从公开原帖媒体中提取。“已经关联来源”不等于“本次重新独立核验”。每个详情页会展示准确的证据状态、历史互动快照、改写说明和实际提示词字节。</sub>

## 快速开始 / 安装 Skill

```bash
git clone https://github.com/PenStairs/claude-codex-visual-benchmark.git
cd claude-codex-visual-benchmark
npm install
npx playwright install chromium
npm run fetch:bgm
npm run benchmark -- doctor
```

把仓库安装成 Agent Skill：

```bash
npx skills add PenStairs/claude-codex-visual-benchmark --global --all --copy
```

然后让 Agent 使用 `$visual-code-model-benchmark`。它会依次引导用户选择两个模型、测评方法和提示词，展示运行计划，并在明确确认后才开始消耗额度。阅读[五分钟快速开始](docs/quick-start.zh-CN.md)或[完整执行流程](USAGE.zh-CN.md)。

## 公平性与证据链

<img src="assets/readme/provenance.svg" alt="原始 X 来源、提示词原文、不可变计划哈希、运行报告和最终视频" width="100%" />

| 官方测评中统一控制 | 无法消除、必须披露 |
|---|---|
| 相同的标准化提示词字节和轮次顺序 | Codex CLI 或 Claude Code Runner 路径 |
| 等价的干净脚手架和文件规则 | 供应商端点和鉴权类别 |
| 明确推理策略，禁止静默降档 | 不同模型对 `high` 或 `max` 的具体含义 |
| 并行生成和相同录制策略 | 硬件、录屏回退、修复、重试和失败 |

- **推理强度：**Flash 配置使用 `max`，其他内置配置统一使用 `high`。
- **超时：**60 分钟软提醒、180 分钟硬上限、15 分钟无活动上限；Three.js 启动等待放宽至 60 秒。
- **硬件：**本地 CPU、GPU 和录屏回退方式必须写进运行披露，不能藏在所谓统一总榜后面。
- **来源：**原帖 URL、提示词字节、方法来源、历史快照和改写说明分开记录。
- **结果：**[官方测评](benchmarks/official/README.md)与[社区测评](benchmarks/community/README.md)回答不同问题，不会被静默混在一起。

一次运行只能支持这样的结论：在已经声明的提示词、模型配置、Runner、推理强度、策略和硬件下，模型产出了这些结果；不能证明某个模型在所有任务中普遍更强。详见[公平性规则](docs/fairness.md)和[提示词溯源规则](docs/prompt-provenance.md)。

## 参与贡献

- [添加模型配置](CONTRIBUTING_MODELS.md)
- [添加有来源的提示词](CONTRIBUTING_PROMPTS.md)
- [提交社区测评](benchmarks/community/README.md)
- [改进 Runner 或录屏流程](CONTRIBUTING.md)
- [报告可以复现的问题](https://github.com/PenStairs/claude-codex-visual-benchmark/issues)

每项修改都会经过配置、提示词契约、超时行为、浏览器运动、录屏质量、自动文档和发布安全检查。

## 社区与项目状态

[![版本](https://img.shields.io/badge/version-0.8.0-7c6cff?style=flat-square)](https://github.com/PenStairs/claude-codex-visual-benchmark/releases/tag/v0.8.0)
[![模型配置](https://img.shields.io/badge/model_profiles-11-38bdf8?style=flat-square)](docs/model-gallery.md)
[![提示词](https://img.shields.io/badge/source_linked_prompts-20-f59e0b?style=flat-square)](docs/prompt-gallery.md)
[![CI](https://img.shields.io/github/actions/workflow/status/PenStairs/claude-codex-visual-benchmark/ci.yml?branch=main&style=flat-square&label=checks)](https://github.com/PenStairs/claude-codex-visual-benchmark/actions)
[![开源协议](https://img.shields.io/badge/license-MIT-e5e7eb?style=flat-square)](LICENSE)

[Discussions](https://github.com/PenStairs/claude-codex-visual-benchmark/discussions) · [Roadmap](ROADMAP.md) · [最新版本](https://github.com/PenStairs/claude-codex-visual-benchmark/releases/latest) · [更新记录](CHANGELOG.md) · [完整文档](docs/README.md)

### Star History

[![Star History Chart](https://api.star-history.com/svg?repos=PenStairs/claude-codex-visual-benchmark&type=Date)](https://www.star-history.com/#PenStairs/claude-codex-visual-benchmark&Date)

## 安全 / 免责声明 / 开源协议

API Key 只能放在环境变量中，并且需要把模型生成的代码视为不可信代码。受限的本地脚手架不是面向恶意代码的强安全沙箱。使用订阅套餐或第三方网关前，请自行核对服务条款。详见 [SECURITY.md](SECURITY.md)。

这是 [PenStairs](https://github.com/PenStairs) 发起的独立社区项目，与 Anthropic、OpenAI、DeepSeek、智谱 AI、Three.js、Twigl 或 X 不存在隶属、赞助或官方背书关系。项目中的产品名称只用于说明兼容性。

代码和本项目原创文档采用 [MIT License](LICENSE)。提示词、外部帖子和来源视频帧可能仍归原作者所有；保留来源不代表重新授权第三方内容。可选背景音乐遵循单独的[许可说明](assets/audio/brainiac-mixkit-license.txt)。

<div align="center">

**选择两个模型，固定一条提示词，让作品自己说话。**

[浏览评测](docs/benchmark-gallery.md) · [运行自己的对比](docs/quick-start.zh-CN.md)

</div>
