# 视觉代码模型对比评测 Skill 使用说明（X 专版）

版本：0.8.0
更新时间：2026-09-03

## 这个 Skill 是做什么的

这个 Skill 会让两个代码或推理模型在相互隔离的本地工作区中，接收完全相同的 Three.js 或 Twigl 提示词，分别生成、验证和录制视觉作品，最后输出一条适合发布到 X 的上下对比视频。

每个模型档案都声明一个 **runner**（执行它的 CLI 代理）：`codex` 走 Codex CLI（ChatGPT 订阅登录，或任何 OpenAI 兼容端点），`claude` 走 Claude Code（Claude 订阅登录，或任何 Anthropic 兼容端点）。同一份 Skill 既可以在 Codex 里调用，也可以在 Claude Code 里调用，区别只在参赛模型各自用哪个 runner。

- 模型 A 在上方，模型 B 在下方。
- 每个模型以 1200×676 原生分辨率录制。
- 最终视频为 1200×1352、30 fps、H.264 MP4。
- 最终视频默认混入固定背景音乐 `Brainiac`，使用低音量、首尾淡入淡出和立体声 AAC；合成后会检查音轨。
- 默认只在本机生成文件，不会自动发布到 X。
- 模型推理可能使用第三方云端服务，但代码生成编排、验证、录屏和视频拼接都在使用者自己的电脑上完成。
- 两个模型用同一个 runner 时，比的是模型本身；用不同 runner 时（`harness.crossRunner = true`），比的是"模型 + 各自的 CLI"，视频文案里要如实说明。
- 作品生成和修复采用固定质量策略：所有 Flash 模型使用最高档 `Max`，其他模型使用 `High`，不会为了赶时间自动降档。
- 生成满 1 小时只提示，不中止；3 小时才强制停止；连续 15 分钟没有 runner 输出才按空闲超时停止。运行中每 60 秒记录一次进度。

## 安装前准备

使用者需要自行安装并配置：

1. Node.js 20.19.0 或更高版本，以及 npm。
2. 至少一个 runner CLI：`codex` 档案需要 Codex CLI 并完成 Codex 登录；`claude` 档案需要 Claude Code 并完成 Claude 登录（`claude auth status` 显示 `loggedIn: true`）。
3. FFmpeg 和 FFprobe，并确保终端能直接运行 `ffmpeg` 和 `ffprobe`。
4. 可访问模型服务和 Twigl 网站的网络环境。
5. 建议使用支持 WebGL 的独立显卡或集成显卡。
6. 背景音乐本地素材：安装后在 Skill 目录运行一次 `npm run fetch:bgm`。

当前版本已在 Windows 11 上完成完整验证。脚本使用 Node.js 和跨平台路径处理，已提供 macOS/Linux 安装命令，但这两个平台尚未完成同等实机验证。

## 安装 Skill

先解压安装包，确保最终目录名为 `visual-code-model-benchmark`。Codex 从 `~/.codex/skills/` 读取，Claude Code 从 `~/.claude/skills/` 读取；两边可以各放一份，也可以只放一份，再用目录链接指到另一边（Windows：`mklink /J "%USERPROFILE%\.claude\skills\visual-code-model-benchmark" "%USERPROFILE%\.codex\skills\visual-code-model-benchmark"`；macOS/Linux：`ln -s ~/.codex/skills/visual-code-model-benchmark ~/.claude/skills/visual-code-model-benchmark`）。`agents/openai.yaml` 只对 Codex 有意义，Claude Code 会忽略它。

### Windows PowerShell

把该目录复制到：

```text
%USERPROFILE%\.codex\skills\visual-code-model-benchmark
```

然后运行：

```powershell
$skillDir = Join-Path $env:USERPROFILE ".codex\skills\visual-code-model-benchmark"
Set-Location -LiteralPath $skillDir
npm install
npx playwright install chromium
npm run fetch:bgm
npm run check
```

### macOS / Linux / Git Bash

把该目录复制到：

```text
~/.codex/skills/visual-code-model-benchmark
```

然后运行：

```bash
cd "${CODEX_HOME:-$HOME/.codex}/skills/visual-code-model-benchmark"
npm install
npx playwright install chromium
npm run fetch:bgm
npm run check
```

看到检查结果中的 `"ok": true`，说明 Skill 的配置、模型档案、提示词和录制动作测试均已通过。

## 配置模型权限

安装包不包含任何 API Key、登录状态或模型额度。每位使用者必须使用自己的账号和密钥。

### GPT-5.6 Sol（runner：codex）

使用当前 Codex 登录状态，不需要把 OpenAI Key 写进 Skill。实际可用性取决于使用者账号是否有该模型权限。ChatGPT 订阅只能在 Codex CLI 里用，不能拿去驱动 `claude` runner。

### Claude Fable 5.1 / Claude Opus 5（runner：claude）

使用当前 Claude Code 登录状态（Claude Pro/Max 订阅），档案 ID 分别是 `claude-fable-5-1` 和 `claude-opus-5`。本评测固定选择 `high`，并通过 Claude Code 的 `--effort high` 控制。Claude 订阅同样只能在 Claude Code 里用。

运行前建议清空或保持中性的 `~/.claude/CLAUDE.md`：这个文件在 Claude Code 的设置体系之外，会被加载进参赛者上下文，`doctor` 会在它非空时给出警告。

### DeepSeek V4 Flash / DeepSeek V4 Pro

PowerShell：

```powershell
$env:DEEPSEEK_API_KEY = "<your-own-key>"
```

macOS / Linux / Git Bash：

```bash
export DEEPSEEK_API_KEY='<your-own-key>'
```

DeepSeek 档案共用这一环境变量。Flash 的模型 ID 是 `deepseek-v4-flash`，固定使用最高档 `max`；Pro 的模型 ID 是 `deepseek-v4-pro`，固定使用 `high`。另有对应的 `-claude` 档案，用同一把 Key 走 DeepSeek 的 Anthropic 兼容端点，在 Claude Code 里运行，并通过 `--effort` 传递相同档位。

### GLM-5.3-Flash / GLM-5.3 Coding Plan

PowerShell：

```powershell
$env:GLM_CODING_PLAN_KEY = "<your-own-key>"
```

macOS / Linux / Git Bash：

```bash
export GLM_CODING_PLAN_KEY='<your-own-key>'
```

GLM 档案共用这一 Coding Plan 环境变量。Flash 的模型 ID 是 `glm-5.3-flash`，固定使用最高档 `max`；旗舰档案 `glm-5.3-coding-plan` 固定使用 `high`。另有对应的 `-claude` 档案，用同一把 Key 走智谱的 Anthropic 兼容端点，在 Claude Code 里运行，并通过 `--effort` 传递相同档位。

### 其他开源模型

凡是提供 Anthropic 兼容端点的模型（Kimi、MiniMax、Qwen、本地网关等）都可以复制 `config/models/deepseek-v4-pro-claude.json`，改好模型 ID、端点和环境变量名即可；凡是提供 OpenAI 兼容端点的模型则复制一个 `codex` 档案。详见 `references/configuration.md` 和 `references/runners.md`。

DeepSeek 和 GLM 的内置档案直接调用各自的官方端点（`codex` 档案走 Responses 端点，`claude` 档案走 Anthropic 兼容端点），不需要 CC Switch。不要把真实密钥写进 `config/`、提示词、日志或聊天消息。

## 最简单的使用方法

在 Codex 中直接发出类似请求：

```text
请使用 $visual-code-model-benchmark，对比 DeepSeek V4 Flash 和 GLM-5.3-Flash。
测试方法选择 Three.js，让我选择提示词。不要发布，先展示完整运行计划。
```

在 Claude Code 中：

```text
/visual-code-model-benchmark 对比 Claude Fable 5.1 和 GPT-5.6 Sol，方法选 Twigl，让我选提示词。不要发布，先展示完整运行计划。
```

Claude Fable 5.1（`claude` runner）对 GPT-5.6 Sol（`codex` runner）是跨 runner 对比，`describe` 会返回 `harness.crossRunner: true`，Agent 会在确认前提醒你这是"模型 + 各自 CLI"的对比。

Agent 会依次完成：

1. 让你选择模型 A 和模型 B。
2. 让你选择 Three.js 或 Twigl。
3. 列出该方法下可用的提示词和轮次。
4. 展示模型、推理档位、提示词原文、录制设置和确认令牌。
5. 在付费模型调用前等待一次明确确认。
6. 正式运行前用 `Low` 做少量 token 的可用性预检；作品生成和修复使用档案固定的质量级别（Flash 为 `Max`，其他为 `High`）。
7. 分别生成、验证和录制两个模型的结果，运行期间每 60 秒显示进度。
8. 输出一条上下排列的 X 专版 MP4。
9. 对每个模型明确输出两项指标：`完整完成任务时间` 和 `牌价估算费用`。

不要在确认前随意更换模型、提示词、推理档位或是否发布；任何变化都会使确认令牌失效，需要重新确认。

## 命令行检查与高级用法

以下命令都应在 Skill 目录中运行。

查看模型：

```bash
npm run benchmark -- list-models
```

查看提示词：

```bash
npm run benchmark -- list-prompts --method threejs
npm run benchmark -- list-prompts --method twigl
```

检查两个模型的运行条件：

```bash
npm run benchmark -- doctor --models deepseek-v4-flash,glm-5.3-flash
```

这条命令默认只做静态和本地检查，不调用模型。如需额外验证 Claude 模型权限（会产生少量 token 消耗），明确使用：

```bash
npm run benchmark -- doctor --models claude-fable-5-1 --probe-models
```

查看完整执行计划：

```bash
npm run benchmark -- describe --model-a deepseek-v4-flash --model-b glm-5.3-flash --method threejs --prompt military-armory-v1
```

`describe` 会返回 `confirmationToken`。确认内容无误后，把该值原样传给正式运行命令：

```bash
npm run benchmark -- run --model-a deepseek-v4-flash --model-b glm-5.3-flash --method threejs --prompt military-armory-v1 --confirmed-plan <confirmationToken>
```

如果只有一侧因为登录、版本、额度、网络、空闲或硬超时等基础设施原因失败，而另一侧已经完成全部提示词轮次，不必重跑成功一侧。先查看恢复计划并重新确认：

```bash
npm run benchmark -- describe-retry --run <原运行ID或绝对路径> --side b
npm run benchmark -- retry-participant --run <原运行ID或绝对路径> --side b --confirmed-plan <新的confirmationToken>
```

失败侧会从干净脚手架重新开始，并收到原运行逐字节一致的提示词；成功侧只复用允许修改的作品文件和原始执行指标。新报告会标记为 `recovered-single-participant`。Skill 不会自动发起任何付费重试。

如果模型代码已经生成，只是录屏或视频策略发生问题，可以在不重新调用模型的情况下重录：

```bash
npm run rerecord -- "<absolute-run-directory>"
```

## 输出在哪里

每次运行会在 Skill 目录下创建：

```text
runs/<run-id>/
```

主要文件包括：

- `comparison.mp4`：正常完整运行生成的 X 专版视频。
- `comparison-x.mp4`：使用重录命令生成、并保留旧成片时使用的文件名。
- `run-report.json`：运行和验证结果。
- `model-a/logs/progress.jsonl`、`model-b/logs/progress.jsonl`：每 60 秒一次的运行进度与超时事件。
- 两个模型各自的代码工作区与录制证据。

最终 MP4 会带 `Brainiac` 背景音乐。原始 MP3 只保存在当前电脑的 `assets/audio/` 中，不要放进对外分发的 Skill 压缩包；接收者应自行运行 `npm run fetch:bgm`，从 Mixkit 获取本地副本。

对外分享时只发送最终 MP4。`runs/` 中可能含生成代码、日志和本地运行证据，不要把整个目录继续打包给别人。

## 两个固定输出指标

每个模型在 `run-report.json` 的 `participants[].metrics` 下固定提供下面两项。即使无法计算，也保留字段并写清原因。

### 1. 完整完成任务时间

字段：`completeTaskTime`

```text
完整完成任务时间
= 所有创作轮耗时之和
+ 所有修复轮耗时之和
```

其中：

- `durationMs` / `durationSeconds`：完整完成任务时间。
- `creativeRoundsDurationMs`：所有创作轮合计。
- `repairRoundsDurationMs`：所有修复轮合计；没有修复时为 0。

这个时间包含模型所在 CLI 的启动、推理、工具调用和写文件，排除预检、依赖安装、代码验证、录屏、视频拼接和发布。顶层 `timing.elapsedMs` 是整条评测流水线耗时，不要和这个指标混用。

### 2. 牌价估算费用

字段：`listPriceEstimatedCost`

它使用创作轮和修复轮中 runner 实际返回的 Token 数，乘以 `config/pricing.json` 里带官方来源和查价日期的公开 API 牌价。固定采用 `lowest-published-rate` 口径：同一种 Token 存在多档牌价时，取较低的一档。普通输入、缓存输入、缓存写入和输出仍按各自的实际 Token 数分别计算，不能把普通输入错误地套成更便宜的缓存输入；推理 Token 已包含在输出 Token 中，不重复收费。

- `status: "estimated"`：牌价和 Token 数据都完整，`amount` 与 `currency` 是估算结果。
- `status: "unavailable"`：Token 不完整、价格已过复核日期或没有覆盖当前时间的牌价；`reason` 会说明原因，不猜数字。
- `actualCharge: false`：固定为 false，明确它不是实际账单。

具体口径：

- DeepSeek 有峰时和离峰价时，固定取更低的离峰价，不看实际运行时刻。
- GLM-5.3-Flash 有促销价和标准价时，在牌价配置的有效复核期内取更低的促销价；促销截止后先返回 `unavailable`，更新官方牌价后再恢复计算，不继续使用过期价格。
- GPT 标准与 Fast 模式并存时取更低的标准价；长上下文存在加价时也按更低的基础价估算。
- Claude 缓存写入有 5 分钟和 1 小时两档时取更低的 5 分钟价格。Claude Code 自带的估算只保留在 `runnerReportedEstimate` 供参考，不覆盖本评测的最低牌价结果。

这个费用只用于同口径对比，不代表信用卡、订阅套餐或 Coding Plan 实际扣了多少钱。它不包含预检、套餐月费分摊、折扣、赠送额度、税费、账单调整，以及 Token 事件没有报告的额外付费工具。兼容旧版的 `metrics.cost` 与 `listPriceEstimatedCost` 内容相同。

失败报告会区分认证失败、客户端版本不支持、模型权限、额度耗尽、临时网络错误、空闲超时、生成硬超时、另一侧失败后被终止，以及验证/录屏/发布故障。它们统一保留为“基础设施失败、结论不成立”，不会误写成模型能力失败。

## 运行测试

只检查 Skill 配置：

```bash
npm run check
```

测试 Three.js 录制链路：

```bash
npm run smoke -- --method threejs
```

测试 Twigl 录制链路：

```bash
npm run smoke -- --method twigl
```

烟测不会调用正式评测模型，但 Twigl 烟测需要访问 `https://twigl.app/`。

## 常见问题

### 找不到 `codex`、`claude`、`ffmpeg` 或 `ffprobe`

对应程序尚未安装，或者没有加入系统 `PATH`。修复后关闭并重新打开终端。`doctor` 只检查所选档案实际需要的 runner CLI；`self-test` 允许缺少其中一个 runner，但至少要有一个。

### `doctor` 报 `claude-login` 未登录

在终端运行 `claude auth login`（或直接运行一次 `claude`）用订阅账号登录，然后重跑 `doctor`。

### Playwright 提示找不到 Chromium

在 Skill 目录运行：

```bash
npx playwright install chromium
```

### `doctor` 报模型认证失败

确认使用的是自己的有效权限，并且环境变量是在启动 Codex 或 Claude Code 的同一环境中设置。不要把 Key 写入模型 JSON。

### Twigl 验证失败

先确认浏览器能访问 `https://twigl.app/`。网站不可用、编辑器结构变化或网络请求失败属于基础设施问题，不应算作模型失败。

### 视频仍然卡顿

先关闭占用 GPU 的游戏、直播、视频编辑器和其他浏览器标签页，再运行烟测。Skill 会让两个模型串行录制，避免它们同时争抢 GPU 和编码资源。

0.6.6 起，指针运动按真实经过时间推进；浏览器来不及处理时会跳过已经过期的中间采样点，不再把积压事件拖到录制窗口之外。录制会检查交互超时、页面平均 FPS、p95 帧时间和最大卡帧间隔。

0.6.7 起，普通临界越界只写入 `cadenceWarnings`，例如 p95 从 50 ms 浮动到 50.1 ms，不会因此反复重录。只有达到“严重卡顿”边界（平均低于 18 FPS、p95 高于 100 ms、单次卡帧高于 500 ms，或 12 秒交互超出 1.5 秒）才会释放当前浏览器和编码器后自动重录。最多自动重试 2 次，也就是总共最多录制 3 次；这只重跑本地录屏，不会再次调用或计费模型。每次失败证据写入 `recording-*.mkv.attempt-N.json`，最终成功的元数据会记录尝试次数。

0.8.0 起，Three.js 任意一侧三次实时录制仍严重卡顿时，不再直接终止：双方一起改用相同的逐帧确定性录制。它仍以原生 1200×676 渲染，固定 30 FPS、12 秒、共 360 帧；每次只在页面完成当前帧以后截图，因此机器渲染慢只会让录制耗时变长，不会让最终视频丢帧。这个过程不改模型代码、不降低清晰度、不做 AI 插帧，也不会重新调用或计费模型。报告会同时保留真实运行的 FPS / p95 / 最大卡帧证据，并把最终视频标为 `captureMode: deterministic-frame`，不能把它解读成作品在本机真实达到了 30 FPS。Twigl 仍在三次严重卡顿后停止，因为远程编辑器无法安全接管动画时钟。

FFmpeg 补帧或 AI 插帧不能修复真实 WebGL 卡顿，而且会制造模型没有实际渲染过的中间画面，所以仍然不使用。逐帧模式记录的是模型代码真正渲染完成的每一帧，区别在于用离线墙钟时间换取固定的视频时间轴。

## 修改模型或提示词

模型、提示词、录制策略和扩展格式见 `references/configuration.md`。新增提示词时，必须让两个模型收到完全相同的轮次、字节内容和顺序；修改已有提示词后应递增其 manifest 版本。

## 分发边界

- 可以把这个清洁安装包发给同事或其他 Codex / Claude Code 用户。
- 不要附带自己的 API Key、Codex 或 Claude 登录状态、Cookie、`runs/` 或 `node_modules/`。
- 不要附带 `assets/audio/brainiac-mixkit.mp3` 原始音乐；接收者运行 `npm run fetch:bgm` 获取自己的本地副本。
- 模型订阅、API 额度和服务条款由每位使用者自行负责。
- 如需公开发布或商用分发，请由发布者补充适合自己的许可证和支持范围说明。
