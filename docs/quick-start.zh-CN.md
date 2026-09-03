# 中文快速开始

## 1. 安装依赖

需要 Node.js 20.19+、FFmpeg/FFprobe、Codex CLI 或 Claude Code，以及 Playwright Chromium。

```bash
npm install
npx playwright install chromium
npm run fetch:bgm
```

音乐文件单独下载，是因为它使用自己的 Mixkit 许可，不属于仓库 MIT 协议；文件哈希固定在 `config/policy.json`。

## 2. 准备鉴权

OpenAI/Anthropic 原生模型使用各自 CLI 的登录状态。第三方模型只从环境变量读 Key，仓库不会自动读取 `.env`。

PowerShell：

```powershell
$env:DEEPSEEK_API_KEY = "只在当前终端使用的Key"
$env:GLM_CODING_PLAN_KEY = "只在当前终端使用的Key"
```

macOS、Linux 或 Git Bash：

```bash
export DEEPSEEK_API_KEY='只在当前终端使用的Key'
export GLM_CODING_PLAN_KEY='只在当前终端使用的Key'
```

只设置本次实际使用的凭据。

## 3. 先检查，不要直接花额度

```bash
npm run benchmark -- list-models
npm run benchmark -- list-prompts --method threejs
npm run benchmark -- doctor --models gpt-5.6-sol,claude-fable-5-1
```

只有准备发起真实最小请求时才加 `--probe-models`；真实探测可能消耗额度。

## 4. 查看计划并确认

```bash
npm run benchmark -- describe --model-a gpt-5.6-sol --model-b claude-fable-5-1 --method threejs --prompt military-armory-v1
```

逐项核对模型、Runner、是否跨 Runner、推理强度、全部提示词轮次、发布状态和风险提示。命令会返回根据完整计划计算的 `confirmationToken`；任何配置或提示词字节改变后都必须重新确认。

## 5. 正式运行

```bash
npm run benchmark -- run --model-a gpt-5.6-sol --model-b claude-fable-5-1 --method threejs --prompt military-armory-v1 --confirmed-plan <sha256>
```

两边并行生成，全部创作轮次结束后再验证和录屏。若一边属于基础设施失败，可在重新生成并确认恢复计划后只重跑失败侧，不自动重复扣费。

## 6. 查看结果

`runs/<run-id>/` 中会有最终 MP4、`run-spec.json`、`run-report.json`、两边工作区、日志和录屏中间文件。`runs/` 永远不进入 Git。发布前只选最终 MP4，不要把源码、日志、提示词或凭据一起上传。

## 双轮 Twigl 示例

```bash
npm run benchmark -- describe --model-a gpt-5.6-sol --model-b claude-fable-5-1 --method twigl --prompt drowned-city-v1
```

第一轮生成淹没在风暴海洋中的新哥特城市；第二轮在两边各自原会话中发送原文 `Make it better`。
