# 会话锻造操作手册

从锻造一个会话开始，再按需要保存模板、派工或调整用量。[返回项目首页](../README.md) · [安装说明](../README.md#安装)

| 你想做什么 | 从这里开始 |
|---|---|
| 第一次使用锻造台 | [创建第一个锻造会话](#创建第一个锻造会话) |
| 下次从新会话页直接选火种 | [保存模板与量产](#保存模板与量产) |
| 分享或导入整组火种 | [管理火种源](#管理火种源) |
| 修改记忆，或从旧回复分支 | [会话与分支](#会话与分支) |
| 共享项目文档，让领袖派工 | [议事厅与召集令](#议事厅与召集令) |
| 设置用量上限，或调用插件接口 | [Energon 用量设置](#energon-用量设置) · [Host API](#host-api) |
| 照着一段提示词演练多人协作 | [星核猎手的剧本](use-cases/星核猎手的剧本.md) · [全部用例](use-cases/) |
| 了解火种和齿轮的命名，以及会话怎样行动 | [火种、齿轮与会话](spark-and-cog.md) |

## 创建第一个锻造会话

1. 在 DSH 选择一个已有工作区，点工作区的「… → 在此工作区锻造会话…」。也可以从左侧「锻造台」进入后选择工作区。需要新工作区时，在 DSH 侧栏创建。
2. 选择火种源和其中一枚火种，查看角色指令（Persona）、初始记忆（soul）和工具。按这次任务临时调整配置。会话名称与使命选填，名称留空时由 DSH 根据首条消息命名。
3. 点「进入对话」，在 DSH 原生输入框发送第一条消息。此时新会话才会保存到侧栏。发送前切走或刷新，这次临时调整会丢弃。也可以直接在锻造台填写首条消息，点「发送并创建会话」。
4. 进入会话的「锻造」标签，核对创建时的 Persona 和 soul，查看用量及已启用的协作功能。普通会话的同一标签提供「在此工作区锻造新会话」入口。

选火种时，先看输入框右下角的**模型和推理等级**。火种指定的配置可用时会自动选中。火种未指定、模型或提供方已移除、推理等级不受支持时，保留 DSH 当前选择。只指定等级时沿用当前模型。发送前或后续轮次都可以手动修改。DSH rc.5 可能将选择记作新会话的默认值，火种本身只在显式保存时更新。

## 保存模板与量产

在锻造台切换火种会保留本轮编辑。「刷新」重新读取工作区、火种源与插件版本，也会保留本地输入。同一枚火种在另一窗口被修改时，可以另存本地副本，或读取新版。「返回会话」回到 DSH 主视图。

| 你想保留什么 | 操作 |
|---|---|
| 当前来源中的模板修改 | 「编辑并保存火种」更新配置和名称，后续量产使用新版本。 |
| 另一种角色或工具组合 | 「另存为新火种」在当前来源增加一枚模板。 |
| 整组修改过的火种 | 「另存为新火种源…」并命名。选「保存副本」可继续编辑，无需选择工作区。选「保存并锻造」则用副本创建会话。 |
| 已运行会话当前的配置 | 在「锻造」标签点「从当前会话另存火种…」，选目标来源并命名。副本记录当前磁盘上的 soul、模型与推理等级，以及锻造时固定的 Persona、工具、Skills、领袖资格、议事厅和能量策略。再次锻造时使用新的对话历史、用量计数和使命。 |

**首条消息只属于当前会话。** 上述保存操作都只保存配置。

想反复使用一枚火种，在锻造台点「加入量产」。下次在目标工作区点「新会话」，从输入框上方的「火种」菜单选它，直接发送文字和附件。菜单会显示来源以区分同名模板。首条消息发出前可以在同一菜单取消锻造。

「移出量产」会保留模板。「删除火种」会同时从来源和快捷菜单中移除该模板。每个火种源至少保留一枚火种。

## 管理火种源

在「火种源」页导入 JSON，先校验并预览，再确认登记。导出保留整组配置和许可。内置的「原生示例（不可编辑）」始终排在最后，展示当前 DSH 的 standard、PTC、minimal、cordis 四种模式。可查看、原样锻造，或另存整个来源后编辑副本。

其他内置来源有 Awesome Copilot 和 Agency Agents。模型、推理等级、工具和 Skills 从宿主读取，工具选择仍受原生权限约束。[Awesome Copilot 火种源](../sources/awesome-copilot.json) · [Agency Agents 火种源](../sources/agency-agents.json)

## 会话与分支

助手回复操作栏里的火苗按钮「锻造分支」从该轮结束的位置创建子会话。对于缺少持久消息 ID 的已结束轮次，入口位于轮末。

每个锻造会话固定来源版本、Persona、原生声明、工具清单与 schema、Skill 正文和本地资源校验。工具实现由 DSH 提供。来源更新后，旧会话仍引用创建时的版本。资源缺失或发生变化时，插件会报告错误。

从 dev.11 起，插件在自己的 Cordis 作用域内装配每个会话的固定 Preset，挂载后即撤销临时定义。DSH 的全局模式列表始终由宿主管理。dev.9 和 dev.10 的锻造会话沿用原 ID，升级重启后按原始绑定恢复。停用插件后，DSH 会拒绝按缺失的专属配置启动锻造会话。

DSH rc.5 的原生 `/` Skill 候选可能还会列出宿主级 Skills。模型可调用的 Skill 工具和实际正文仍取自该火种固定的能力。从 dev.12 起，新锻造的会话在模式按钮显示「火种 · 火种名称」。升级前已发言的会话沿用 DSH 锁定的模式标识。原生工作区「＋」继续创建普通会话。

数据位于当前 DSH Home 的 `session-forging/`，可用插件配置 `directory` 指定绝对路径。面板给出该 Session 的 `soul.md` 路径：直接修改文档，下次请求生效。soul 按原文装入必需 runtime context，不展开变量，与其他记忆插件共存。创建原文和过去请求版本不变。Persona 的 `{{provider}}`、`{{model}}` 随原生模型选择解析。

锻造分支继承固定 Persona、能力、锚点模型及最近一次请求使用的 soul，父子文档独立。不继承领袖身份、议事厅偏好、插件能量策略或用量。Goal 与历史按原生规则处理。没有 soul 准入记录的锚点不能分支。

rc.5 在原生分支入口查不到锻造会话的私有 Preset，会在创建子会话前拒绝请求。锻造会话使用「锻造分支」，普通会话使用 DSH 的原生分支。会话命令为 `/forging-fork <eventSeq>`，也可以用终端连接已加载插件的 DSH Web Host。

```sh
# DSH_FORGING_TOKEN 填写该 Host 的原生 Web 启动令牌
session-forging fork --url http://127.0.0.1:PORT --session SESSION_ID --at EVENT_SEQ --request-id REQUEST_ID
```

正常停用会停止并归档受管会话，重新启用只恢复插件造成的归档。异常退出可能跳过回调。用户主动取消归档后，DSH 仍允许重新配置空白会话。stock CLI 缺少 Preset 服务时不能直接恢复这些会话。

## 议事厅与召集令

这两个名字也借了《变形金刚》的意象。想象赛博坦撤离前的一幕。侦察兵在议事厅的星图上划掉一座断桥，注上「重载车队从东门绕行」。下一班守卫看得出为什么改道，已经出发的车队却等不到换班。领袖发出召集令，让他们在下一个路口转向。在工作区里，议事厅为后来接手的会话留下决定和依据，召集令把计划的变化及时送给同组成员。

**名字跟着会话，使命随会话诞生。** 就像为一名变形金刚选择火种，你可以先想清楚它为何而生，再赋予合适的能力。例如，可以给「接口守门员」配一枚审查火种，把使命写成「守住旧客户端的兼容性」，让它从第一轮就知道该守住什么。建议给需要点名协作的会话起一个好辨认的 DSH 名字。使命可以留空，日后点名让它「审核这份 PRD」也只给它增加本次任务。

### 共享文档

启用议事厅的会话共享项目目录 `.session-forging/council/`。文档类型是写作偏好，面板保存前会检查外部修改。关闭后，插件省去会话内的议事厅入口和模型指引，并拒绝该会话通过插件列目录、读写或删除文档。通用文件工具和 shell 的访问范围由 DSH 决定。用户自己提及的内容和过去的对话也能让模型知道议事厅。

### 召集、归档与恢复

打开「锻造 → 召集令」可查看所在工作区已开始的锻造成员，名字和归档状态随 DSH 更新。已归档成员单列。给领袖开通跨区协作时，在「跨工作区授权」中勾选目标工作区，再把「召集范围」切到已授权工作区。授权限当前领袖和它所在的工作区，可随时撤回。

在领袖会话中展开「已归档」，每位成员旁边有两个操作。「恢复会话」让它重新参加协作。「从锻造台永久移除」由用户核对名称和短 ID 后确认。确认后，该成员会从所有召集令名单中消失，随后按旧 ID 点名或恢复也会被拒绝。若它曾是领袖，它的召集权限也随之结束。DSH 保留原会话、归档状态、历史和 soul。以后在 DSH 手动取消归档，该成员仍然退出召集体系。历史投递记录可继续查阅。

领袖通过三个工具派工。系统提示给出入口，`forging_members` 返回操作说明和成员 ID。完整 Persona 会通过必需的 runtime context 收到入口。

| 工具 | 用法 |
|---|---|
| `forging_members` | 默认查看本工作区。传入 `scope: "authorized"` 扩展到已授权工作区。返回原生名称、稳定 ID、使命、状态和名册版本。 |
| `forging_rally` | 用 `targets` 指定一人或多人。省略时发送给同范围内其他未归档成员，也可用 `exclude` 排除已分配的成员。按组下达不同任务时，保留查询得到的 ID，每组单发一条指令。 |
| `forging_revive` | 用户授权领袖恢复某位归档成员后，用 `targetId` 点名恢复。成员保留历史、工作区和 soul。恢复后重新查询名册，再派工。 |

例如，领袖写好 PRD 后可先点名三人接手研发，按授权恢复其中已归档的一人，再把剩余成员分成审查组和测试组。跨工作区派工时可直接在消息中附上必要的 PRD 正文。领袖也可从面板执行上述操作，或用 `/forging-rally <消息>` 在本工作区广播。

发送和恢复各自使用稳定的 `requestId`。未加载的接收者恢复后接收消息，正在执行的接收者收到 steer，空闲接收者收到 followup。已接收表示输入已送达。每个接收者都有投递状态，结果不确定的投递不会自动重发。

## Energon 用量设置

省略可选限制或填 `null` 表示本插件不额外设限／继承宿主。计数预留默认为 `0`。整数最大为 `Number.MAX_SAFE_INTEGER`，具体范围见 [Schema](../schemas/source.schema.json)。

| 参数 | 范围与作用 | 执行方式 |
|---|---|---|
| `maxTokens` | 正整数。单次输出上限，实际含义服从模型适配器 | 原生调用参数 |
| `tokenLimit` | 非负整数。`0` 禁止新调用 | 持久用量，下次调用前检查 |
| `costLimit`、`costCurrency`、`pricing` | 非负额度、三位币种、按 provider/model 提供每百万 Token 的四类单价 | 用量计价，下次调用前检查 |
| `deadlineAt` | 正整数 Unix 毫秒时间戳，最大 `8640000000000000` | 到时取消当前 Turn，阻止后续调用 |
| `maxTurnDurationMs` | 正整数。每个原生 Turn 的耗时 | 原生取消 |
| `wrapUpLeadTimeMs` | 非负整数。有 Turn 时限时必须小于时限 | 截止前发送收尾 steer |
| `steps.maxStepsPerTurn` | 正整数。原生外层 Agent step 数 | 每步告知余量，耗尽拒绝下一步 |
| `steps.wrapUpSteps` | 非负整数。包含在总步数内 | 提前提示收尾 |
| `steps.finalReplySteps` | 非负整数。不大于收尾预留 | 提示最终答复，拒绝继续执行工具 |
| `web.searchMaxQueries`、`searchMaxResults`、`searchSummaryMaxChars` | 正整数。单次工具调用的查询数、结果数、摘要字符数 | 原生 Web 工具配置 |
| `web.searchTimeoutMs`、`fetchTimeoutMs` | 正整数。单次工具超时 | 原生工具取消 |

`0 ≤ finalReplySteps ≤ wrapUpSteps ≤ maxStepsPerTurn`。不限总步数时预留均为 `0`。同一 Turn 的 steer 不重置计数。Step 不是模型内部推理深度，PTC 内的一批调用也不等于多次外层 Step。提前通知提供收尾机会，不能保证模型会遵从或完成。时间截止仍可中止在途调用。

只有 Step 和收尾提醒注入提示。输出上限、Web 参数及额度不靠 Prompt 执行。累计用量计入插件启用计量后的本 Session 主循环调用，不回填旧版历史、不汇总子 Agent 或标题／压缩调用。提供方用量缺失、计量中断或费用单价缺失时，有对应额度的会话拒绝继续调用。单次在途请求可能超出余额。这里的费用是显式单价估算，不是账单。

## Host API

```js
import { previewSource } from '@zhengrenwritecode/dsh-session-forging/sources';

const forging = ctx.sessionForging;
const preview = previewSource(jsonText);
const source = await forging.sourceImport(jsonText, preview.revision);
const created = await forging.create({ requestId, workspaceId, source, sparkId });
// 可选 spark 为本次完整编辑。重试保留同一 requestId 与全部输入。
await forging.restore(created.sessionId);
```

前端通过原生 Gateway 调用，不另开服务。`catalog(workspaceId)` 读取实际配置。`sourcePreview`／`sourceImport`／`sourceExport` 管理来源。`collaboration(sessionId)`、`councilDocument(input)`、`rally(input, signal?)` 共用 Host 校验。

`fork({ requestId, sessionId, atSeq }, signal?)` 创建锻造分支。`context.at(sessionId, eventSeq)` 读取锚点的 soul 准入版本。相同请求幂等，不同输入复用 ID 报错。错误包含 `code`。`*_WRITE_UNCERTAIN` 需重新读取核对。多 Host 共写同一插件目录不在支持范围。

运行 `npm ci --ignore-scripts` 和 `npm test` 可执行产品单测。开发者首次克隆后可用 `git config --local core.hooksPath .githooks` 启用推送前检查。提交产品源码、测试和使用文档时，Git 文件清单与安装包清单分别受检。本机 profile、会话、密钥、验收产物及个人 skill 留在仓库外。GitHub Actions 对 push 和 PR 复查提交历史、单测和实际打包内容。

### 依赖与共存

使用 [DSH](https://github.com/deepseek-ai/deepseek-harness) 的 Preset、Persona、Tools、Skills、Web、SessionController、WorkspaceRegistry、SystemPrompt、Gateway、Commands 与 Client Slots。校验依赖 [Ajv](https://github.com/ajv-validator/ajv)。声明解析、RPC 与界面复用宿主的 Cordis Include、[js-yaml](https://github.com/nodeca/js-yaml)、[Zod](https://github.com/colinhacks/zod)、[React](https://github.com/facebook/react)（均为 MIT）。[Mnemon](https://github.com/omdsh-dev/dsh-mnemon) 一类记忆插件和 [dsh-context](https://github.com/bowenliang123/dsh-context) 是可选的共存／观测对象，不是运行依赖。联合安装测试中，forged 会话的上下文包含 soul 和 Mnemon 记忆。
