# 添加你自己的模型

只要受支持的 Runner 能执行，就可以拿来对比。模型配置只是 `config/models/` 下的一份本地 JSON，里面只写环境变量名，不写 Key 本身。

## 选择 Runner

- 原生 Codex 登录或官方声明兼容 OpenAI Responses 的端点，使用 `runner: "codex"`。
- 原生 Claude Code 登录或官方声明兼容 Anthropic 的端点，使用 `runner: "claude"`。

同一个模型若同时支持两种端点，可以建两份 Profile；Claude Code 版本建议使用 `-claude` 后缀。跨 Runner 对比是允许的，但结论必须写成“模型 + Agent 装置”的差异，不能只归因于底层模型。

## 复制模板

```powershell
Copy-Item "examples/custom-models/openai-responses-compatible.json" "config/models/my-model.json"
```

修改 ID、显示名、Runner 实际模型 ID、官方端点、环境变量名、测评方法和推理档位。示例里的 `example.invalid` 只是占位符，不能直接运行。

## 验证

```bash
npm run generate:docs
npm run benchmark -- list-models
npm run benchmark -- doctor --models my-model
```

确认愿意消耗一次最小调用后再加 `--probe-models`。重点验证供应商是否真的接受并执行这个推理档位，而不只是界面上能显示 `high` 或 `max`。
