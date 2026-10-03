# dsh-router-neohorse

一个 DSH 插件：对没有明确档位指令的消息，自动选择思考档（low / high / max）。

判定交给**基元律动（TokenRhythm）的 `NeoHorse-Jev-4B` 决策模型**——通过其 System One 兼容接口
（`https://tokenrhythm.studio/v1/systemone`）按需调用，配合会话内的检测自动升降档。

> 本仓库改编自 [HapyRain/dsh-router-laya](https://github.com/HapyRain/dsh-router-laya)（Apache-2.0）：
> 判定端改为基元律动 NeoHorse-Jev-4B 的远程 System One 调用，其余路由逻辑保持不变。

## 它做什么

- **省钱**：简单消息走 `low`，不为简单问题支付高推理成本
- **快**：低档首字响应更快；判定是一次轻量调用
- **难事不掉链子**：任务复杂、或你在重试时自动升档，`max` 兜底
- **判断一次**：每轮只对第一条任务消息判定一次档位，同轮内的多步模型调用共用该档位
- **失败安全**：判定服务不可达、凭据缺失或超时 → 落 `low`，会话不断

档位由两个 choice 问题一次问出：

- `tier`（low / high / max）：本任务需要多少思考
- `reason`（content / intent_force / intent_inherit / intent_exclude / escalate_regenerate）：为什么是这个档位

模型指令内嵌产品策略：显式档位指令优先、任务文本与上一轮相同（重试）升档、用户排除项封顶，
否则按内容难度判定。

## 安装

通过 DSH 的 GitHub 安装入口直接安装（无需 Python、无需下载权重、无需本地服务）：

```text
https://github.com/himetuki/dsh-router-NeoHorse-Jev-4B
```

在 DSH Desktop：**侧边栏「插件」→「添加插件」** → 粘贴仓库地址 → **「安装」** → **「立即启用」**
（若提示下次启动加载，重启 DSH Desktop）。

## 配置

插件行的配置（默认值已写在 `cordis.patch.yml`）：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `auto` | `true` | 开启自动档位路由（`false` 时需手动） |
| `baseUrl` | `https://tokenrhythm.studio/v1/systemone` | 基元律动 System One 兼容地址 |
| `model` | `NeoHorse-Jev-4B` | 判定模型 ID |
| `credentialRef` | `JEV_API_KEY` | DSH 凭据引用，API Key 通过该引用解析 |
| `timeoutMs` | `30000` | 每次判定超时 |

API Key **不要写进仓库或源码**：在 DSH 的凭据界面按 `credentialRef` 保存，插件运行时通过
`ctx.credentials` 按引用解析（它从不读取 Key 本身）。没有 Key 或 Key 为空时，判定失败并安全落 `low`。

运行时可在输入栏的档位芯片上切换 **Auto / 手动**，无需重启。

## 它怎么决定档位

每轮流程（与 v2 产品路径一致）：

1. 捕获本轮第一条任务消息（`agent/inbox/claimed`）。
2. 在 `agent/request` 上带会话上下文（`prev_tier` / `prev_task` / `session_id`）调用 NeoHorse-Jev-4B，
   一次得到 `tier` 与 `reason`。
3. 按档位表把请求路由到对应的主模型路线：`low` → deepseek-flash low；`high` → deepseek-flash high；
   `max` → deepseek-flash max；判定失败 → `low`（`fallback`）。档位表可通过 `tiers` 配置重映射。
4. 轮次结束后记录档位，作为下一轮的 `prev_tier` / `prev_task`（重试检测用）。

档位芯片（输入栏右侧）实时显示当前档位、切换 Auto/手动，并列出最近判断的档位、原因与任务片段。

## 隐私与安全

- 发给判定服务的只有：任务文本（截断到 4000 字符）、上一轮档位与任务文本、会话 id。
- 判定结果只用于选择主模型的档位；插件不改写任何模型请求体之外的参数，不增删工具，不改权限或沙箱。
- API Key 经 DSH 凭据服务按引用解析，插件与仓库都不接触明文 Key。

## 与上游 `dsh-router-laya` 的关系

两者是同一个插件的两个版本，**同一 profile 只能安装其中一个**：

- 本版包名与行 id 已改为 `dsh-router-neohorse` / `router-neohorse`，与上游不撞名；
- 切换来源前先移除另一个插件。

## License

Apache-2.0。改编自 [HapyRain/dsh-router-laya](https://github.com/HapyRain/dsh-router-laya)
（Apache-2.0）；致谢见 [NOTICE](./NOTICE)。
