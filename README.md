# session-forging

**你应该能自由选择和创造自己的上下文哲学，决定每个会话从诞生起该知道什么、能做什么，以及怎样和其他会话一起工作。**

怎样组织上下文，会影响模型能用上哪些信息。Liu 等人在长上下文多文档问答实验中发现，在同一组文档里移动含有答案的那一篇，受测模型的答题表现就会变化。把它放在中间时，准确率往往低于放在开头或结尾时。[Liu 等，*Lost in the Middle*，TACL 2024](https://aclanthology.org/2024.tacl-1.9/)

几家编码工具都允许开发者组织上下文，具体做法各有侧重。OpenAI Codex 从仓库根目录到工作目录逐层读取 `AGENTS.md`，让子目录拥有更具体的约定。Google Gemini CLI 允许在 `GEMINI.md` 中引用其他文件，并查看合并后的指令。Anthropic Claude Code 则允许把一项任务交给拥有独立上下文、指令和工具权限的子代理。[Codex 项目指令](https://developers.openai.com/codex/guides/agents-md/) · [Gemini CLI 上下文文件](https://geminicli.com/docs/cli/gemini-md/) · [Claude Code 子代理](https://code.claude.com/docs/en/sub-agents)

DeepSeek Harness（DSH）提供 standard、PTC、minimal、cordis 四种内置模式，也允许你声明自定义模式。模式决定 Agent 加载哪组插件、指令和工具。[DSH 模式说明（rc.5）](https://cdn.jsdelivr.net/npm/@deepseek-ai/dsh-client-ui-agent-preset@0.2.2-rc.5/README.zh.md)

session-forging 借用《变形金刚》中火种源赋予机械生命的意象。每枚**火种**（Spark）是一份会话配置模板，一组体现同一种开发哲学的火种构成一个**火种源**（AllSpark）。你可以直接选用已有的火种源，也可以创建自己的。比如，维护旧接口的团队可以建一个「兼容性优先」火种源，让设计火种记录兼容性取舍，让审查火种拿旧客户端核对改动。两枚火种各有指令和工具，整组可以导出、分享或另存为自己的版本。

## 我用 DSH 自己建几个模式，不就够了吗？

如果只想复用一套 Persona、工具和 Skills，建原生模式就够了。火种源的价值在于能按团队的工作方法组织会话。锻造插件还负责三件发生在会话运行期间的事。

| 你想完成的事 | 在 DSH 中自定义原生模式 | 锻造插件额外做什么 |
|---|---|---|
| 让这次审查记住自己的约定 | 在模式中声明 Persona 和上下文插件，供选择该模式的会话复用。 | 每个锻造会话有独立的 `soul.md`。插件从会话主循环的模型请求中记录实际使用的档案版本。从旧回复分支时，子会话拿到当时的档案和模型，父子随后可以各自修改。[档案版本记录](src/context.js) · [分支实现](src/forks.js) |
| 让下一个会话读到项目决定 | 会话可以用文件工具读写仓库。团队自行约定决策存在哪里、何时翻阅。 | **议事厅**给同一工作区的会话一个共享文档目录。启用写作指引后，各会话按自己的偏好记录设计取舍、决议或交接事项。面板保存前核对文件版本，提示并发编辑冲突。[议事厅实现](src/council.js) |
| 把一次需求变更送到负责的人手里 | DSH 的 Team 和子代理工具支持成员联络、任务分派与共享任务板。 | 领袖用**召集令**点名、分组或广播给锻造成员。宿主按工作区授权、会话 ID 和当前归档状态核验每个接收者。运行中的成员接收即时指引，空闲成员接收后续消息，每个成员都有投递记录。[DSH Team](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/team/agent-team/README.zh.md) · [召集与投递](src/rally.js) |

一份交接文档（handoff）能告诉后来者，上一次改造为什么保留了旧接口。我们的目标是再往前走一步，像火种源塑造一个变形金刚那样，让接手的会话在诞生时就带着这条约定、验证它的工具和自己要承担的职责。今后接入更多能力时，哪些能力该随会话一起诞生，仍由你选择。

## 使用

从 GitHub 版本附件取得锻造台的 `.tgz`，或在源码目录运行 `npm ci && npm pack` 生成安装包。用 DSH 原生 CLI 安装到目标 profile。下面以桌面版的 0.2.0 为例，先退出 App，在安装包所在目录运行命令，然后重开 DSH。

```sh
dsh plugin --profile desktop add --ignore-scripts ./zhengrenwritecode-dsh-session-forging-0.2.0.tgz
```

由 DSH 插件管理器加载包内 `cordis.patch.yml`。本轮验收使用 DSH `0.2.2-rc.5`。要体验召集令和议事厅，可以使用[星核猎手的剧本](doc/use-cases/星核猎手的剧本.md)。

- 在原生工作区的「…」菜单选「在此工作区锻造会话…」，或从左侧「锻造台」选择已有工作区。工作区由 DSH 创建。
- 编辑火种后，点「进入对话」把配置带到目标工作区的原生新会话输入框。发送第一条消息才会保存锻造会话，之后可以从侧栏重新打开。只打字未发送就切走或刷新，会丢弃这次临时调整。也可以在锻造台填写首条消息，点「发送并创建会话」直接开始。会话名称选填，留空交给 DSH 按首条消息命名。首条消息只属于本次会话，另存火种、复制整个火种源、从已开始的会话另存火种均只保存配置。本轮编辑在切换火种时保留。点击「另存为新火种」会在同一来源中新增模板。「另存为新火种源…」保存整套修改，命名后可选「保存副本」或「保存并锻造」。只保存副本时无需选择工作区。
- 经常使用的火种可以在锻造台点「加入量产」。在目标工作区打开空白新会话，点输入框上方右侧的「火种」，选中模板后继续在同一个 DSH 输入框工作。已经输入的文字和已添加的附件可以直接发送，未发送时可在同一菜单取消锻造。领袖模板可选填会话名字和使命，留空也可使用。快捷菜单同时列出来源，方便辨认同名火种。
- 选火种时，已有且可用的模型配置会自动带到输入框右下角。模型和等级均留空、提供方或模型已移除、指定等级不受支持时，保留当前选择。只指定推理等级时，沿用当前模型。首轮和后续轮都尊重你在 DSH 菜单里的手动修改。DSH rc.5 会尝试把通过原生菜单服务应用的选择记为以后新会话的默认值。火种本身只有显式保存时才会更新。
- 编辑自己的模板后点「编辑并保存火种」，可以更新配置和名称。后续量产使用最新保存的版本。点「移出量产」会保留模板，点「删除火种」会将其从来源和快捷菜单移除。一个火种源至少保留一个火种。
- 在已运行会话的「锻造」标签里点「从当前会话另存火种…」，选择目标来源并命名。副本保存当前磁盘里的 soul、已选模型和推理强度，以及这次锻造固定的 Persona、工具、Skills、领袖资格、议事厅设置和能量策略。再次创建时使用新的对话历史、用量计数和会话使命。另存后可在锻造台选择是否加入量产。
- 「火种源」：导入 JSON → 校验 → 只读预览 → 确认登记；导出保留完整配置和许可。
- 开始对话后，在原生会话标签栏选择「锻造」。锻造会话展示议事厅、召集令及记录、用量和创建时的 Persona 与 soul。普通会话提供「在此工作区锻造新会话」，点击后打开锻造台并选中所属工作区，提交时才创建新会话。
- 助手回复操作栏中的火苗按钮「锻造分支」按该轮结束时的配置创建分支。缺少持久消息 ID 的已结束轮次在轮末提供入口。

「原生示例（不可编辑）」固定在火种源列表末尾，展示当前 DSH 的 standard、PTC、minimal、cordis 四种模式。可以查看、原样锻造或另存整个火种源，调整配置时编辑自己的副本。其他内置来源包括 [Awesome Copilot](sources/awesome-copilot.json) 和 [Agency Agents](sources/agency-agents.json)。模型、推理强度、工具与 Skills 均从宿主读取；工具选择仍受原生权限约束。

## 会话与分支

每个锻造会话固定来源版本、Persona、原生声明、工具清单与 schema、Skill 正文和本地资源校验。工具实现由 DSH 提供。来源更新后，旧会话仍引用创建时的版本。资源缺失或发生变化时，插件会报告错误。

从 dev.11 起，插件在自己的 Cordis 作用域内装配每个会话的固定 Preset，挂载后即撤销临时定义。DSH 的全局模式列表始终由宿主管理。dev.9 和 dev.10 的锻造会话沿用原 ID，升级重启后按原始绑定恢复。停用插件后，DSH 会拒绝按缺失的专属配置启动锻造会话。

DSH rc.5 的原生 `/` Skill 候选可能还会列出宿主级 Skills。模型可调用的 Skill 工具和实际正文仍取自该火种固定的能力。从 dev.12 起，新锻造的会话在模式按钮显示「火种 · 火种名称」。升级前已发言的会话沿用 DSH 锁定的模式标识。原生工作区「＋」继续创建普通会话。

数据位于当前 DSH Home 的 `session-forging/`，可用插件配置 `directory` 指定绝对路径。面板给出该 Session 的 `soul.md` 路径：直接修改文档，下次请求生效。soul 按原文装入必需 runtime context，不展开变量，与其他记忆插件共存；创建原文和过去请求版本不变。Persona 的 `{{provider}}`、`{{model}}` 随原生模型选择解析。

锻造分支继承固定 Persona、能力、锚点模型及最近一次请求使用的 soul，父子文档独立；不继承领袖身份、议事厅偏好、插件能量策略或用量。Goal 与历史按原生规则处理。没有 soul 准入记录的锚点不能分支。

rc.5 在原生分支入口查不到锻造会话的私有 Preset，会在创建子会话前拒绝请求。锻造会话使用「锻造分支」，普通会话使用 DSH 的原生分支。会话命令为 `/forging-fork <eventSeq>`，终端可连接已加载插件的 DSH Web Host：

```sh
# DSH_FORGING_TOKEN 填写该 Host 的原生 Web 启动令牌
session-forging fork --url http://127.0.0.1:PORT --session SESSION_ID --at EVENT_SEQ --request-id REQUEST_ID
```

正常停用会停止并归档受管会话，重新启用只恢复插件造成的归档。异常退出可能跳过回调；用户主动取消归档后，DSH 仍允许重新配置空白会话。stock CLI 缺少 Preset 服务时不能直接恢复这些会话。

## 议事厅与召集令

这两个名字也借了《变形金刚》的意象。想象赛博坦撤离前的一幕。侦察兵在议事厅的星图上划掉一座断桥，注上「重载车队从东门绕行」。下一班守卫看得出为什么改道，已经出发的车队却等不到换班。领袖发出召集令，让他们在下一个路口转向。在工作区里，议事厅为后来接手的会话留下决定和依据，召集令把计划的变化及时送给同组成员。

**名字跟着会话，使命随会话诞生。** 就像为一名变形金刚选择火种，你可以先想清楚它为何而生，再赋予合适的能力。例如，可以给「接口守门员」配一枚审查火种，把使命写成「守住旧客户端的兼容性」，让它从第一轮就知道该守住什么。建议给需要点名协作的会话起一个好辨认的 DSH 名字。使命可以留空，日后点名让它「审核这份 PRD」也只给它增加本次任务。

启用议事厅的会话共享项目目录 `.session-forging/council/`。文档类型是写作偏好，面板保存前会检查外部修改。关闭后，插件省去会话内的议事厅入口和模型指引，并拒绝该会话通过插件列目录、读写或删除文档。通用文件工具和 shell 的访问范围由 DSH 决定；用户自己提及的内容和过去的对话也能让模型知道议事厅。

打开「锻造 → 召集令」可查看所在工作区已开始的锻造成员，名字和归档状态随 DSH 更新。已归档成员单列。给领袖开通跨区协作时，在「跨工作区授权」中勾选目标工作区，再把「召集范围」切到已授权工作区。授权限当前领袖和它所在的工作区，可随时撤回。

在领袖会话中展开「已归档」，每位成员旁边有两个操作。「恢复会话」让它重新参加协作。「从锻造台永久移除」由用户核对名称和短 ID 后确认。确认后，该成员会从所有召集令名单中消失，随后按旧 ID 点名或恢复也会被拒绝。若它曾是领袖，它的召集权限也随之结束。DSH 保留原会话、归档状态、历史和 soul。以后在 DSH 手动取消归档，该成员仍然退出召集体系。历史投递记录可继续查阅。

领袖通过三个工具派工。系统提示给出入口，`forging_members` 返回操作说明和成员 ID。完整 Persona 会通过必需的 runtime context 收到入口。

| 工具 | 用法 |
|---|---|
| `forging_members` | 默认查看本工作区。传入 `scope: "authorized"` 扩展到已授权工作区。返回原生名称、稳定 ID、使命、状态和名册版本。 |
| `forging_rally` | 用 `targets` 指定一人或多人。省略时发送给同范围内其他未归档成员，也可用 `exclude` 排除已分配的成员。按组下达不同任务时，保留查询得到的 ID，每组单发一条指令。 |
| `forging_revive` | 用户授权后，用 `targetId` 恢复点名的归档会话，保留历史、工作区和 soul。恢复后再发任务。 |

例如，领袖写好 PRD 后可先点名三人接手研发，按授权恢复其中已归档的一人，再把剩余成员分成审查组和测试组。跨工作区派工时可直接在消息中附上必要的 PRD 正文。领袖也可从面板执行上述操作，或用 `/forging-rally <消息>` 在本工作区广播。

发送和恢复各自使用稳定的 `requestId`。未加载的接收者恢复后接收消息，正在执行的接收者收到 steer，空闲接收者收到 followup。已接收表示输入已送达。每个接收者都有投递状态，结果不确定的投递不会自动重发。

## 我们想尝试的上下文拼接

我们还在寻找锻造台能提供的下一项硬价值。《变形金刚2》里，霸天虎潜到海底，拆下同伴的零件，修复了威震天的机体。锻造新会话时，能不能也从几个旧会话中各取一段原文，拼出眼前任务最需要的上下文？

长任务里常见的两种做法是压缩（compact）和交接（handoff）。前者把较早的对话压成摘要，给当前会话腾出空间。后者给接手者留下进度、决定和下一步。两者可以配合使用。[Anthropic 的长任务 Agent 实践](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents)

我们想试试**直接拼接上下文**。以修复兼容性问题为例，设想你能从设计会话选出维护者定下的接口约定，再从测试会话选出旧客户端失败时的请求和响应。锻造时把两段原文连同出处交给新会话，它就能对照约定和实际响应开始排查。我们想验证，和只读交接摘要相比，拿到原文的会话能否少一次追问，或者少跑一次已经做过的测试。

## Energon

省略可选限制或填 `null` 表示本插件不额外设限／继承宿主；计数预留默认为 `0`。整数最大为 `Number.MAX_SAFE_INTEGER`，具体范围见 [Schema](schemas/source.schema.json)。

| 参数 | 范围与作用 | 执行方式 |
|---|---|---|
| `maxTokens` | 正整数；单次输出上限，实际含义服从模型适配器 | 原生调用参数 |
| `tokenLimit` | 非负整数；`0` 禁止新调用 | 持久用量，下次调用前检查 |
| `costLimit`、`costCurrency`、`pricing` | 非负额度、三位币种、按 provider/model 提供每百万 Token 的四类单价 | 用量计价，下次调用前检查 |
| `deadlineAt` | 正整数 Unix 毫秒时间戳，最大 `8640000000000000` | 到时取消当前 Turn，阻止后续调用 |
| `maxTurnDurationMs` | 正整数；每个原生 Turn 的耗时 | 原生取消 |
| `wrapUpLeadTimeMs` | 非负整数；有 Turn 时限时必须小于时限 | 截止前发送收尾 steer |
| `steps.maxStepsPerTurn` | 正整数；原生外层 Agent step 数 | 每步告知余量，耗尽拒绝下一步 |
| `steps.wrapUpSteps` | 非负整数；包含在总步数内 | 提前提示收尾 |
| `steps.finalReplySteps` | 非负整数；不大于收尾预留 | 提示最终答复，拒绝继续执行工具 |
| `web.searchMaxQueries`、`searchMaxResults`、`searchSummaryMaxChars` | 正整数；单次工具调用的查询数、结果数、摘要字符数 | 原生 Web 工具配置 |
| `web.searchTimeoutMs`、`fetchTimeoutMs` | 正整数；单次工具超时 | 原生工具取消 |

`0 ≤ finalReplySteps ≤ wrapUpSteps ≤ maxStepsPerTurn`；不限总步数时预留均为 `0`。同一 Turn 的 steer 不重置计数。Step 不是模型内部推理深度，PTC 内的一批调用也不等于多次外层 Step。提前通知提供收尾机会，不能保证模型会遵从或完成；时间截止仍可中止在途调用。

只有 Step 和收尾提醒注入提示；输出上限、Web 参数及额度不靠 Prompt 执行。累计用量计入插件启用计量后的本 Session 主循环调用，不回填旧版历史、不汇总子 Agent 或标题／压缩调用。提供方用量缺失、计量中断或费用单价缺失时，有对应额度的会话拒绝继续调用。单次在途请求可能超出余额；这里的费用是显式单价估算，不是账单。

## Host API

```js
import { previewSource } from '@zhengrenwritecode/dsh-session-forging/sources';

const forging = ctx.sessionForging;
const preview = previewSource(jsonText);
const source = await forging.sourceImport(jsonText, preview.revision);
const created = await forging.create({ requestId, workspaceId, source, sparkId });
// 可选 spark 为本次完整编辑；重试保留同一 requestId 与全部输入。
await forging.restore(created.sessionId);
```

前端通过原生 Gateway 调用，不另开服务。`catalog(workspaceId)` 读取实际配置；`sourcePreview`／`sourceImport`／`sourceExport` 管理来源；`collaboration(sessionId)`、`councilDocument(input)`、`rally(input, signal?)` 共用 Host 校验。

`fork({ requestId, sessionId, atSeq }, signal?)` 创建锻造分支；`context.at(sessionId, eventSeq)` 读取锚点的 soul 准入版本。相同请求幂等，不同输入复用 ID 报错。错误包含 `code`；`*_WRITE_UNCERTAIN` 需重新读取核对。多 Host 共写同一插件目录不在支持范围。

运行 `npm ci --ignore-scripts` 和 `npm test` 可执行产品单测。开发者首次克隆后可用 `git config --local core.hooksPath .githooks` 启用推送前检查。提交产品源码、测试和使用文档时，Git 文件清单与安装包清单分别受检。本机 profile、会话、密钥、验收产物及个人 skill 留在仓库外。GitHub Actions 对 push 和 PR 复查提交历史、单测和实际打包内容。


## 我是谁

一个 agent 从业三年的小萌新，对 js 语言不太熟悉，有任何建议欢迎在 doc/prds 留言~

目标是做一个优雅的插件。

目前的进度是0.2.



## 许可与来源

本项目 [MIT](LICENSE)。[Awesome Copilot](https://github.com/github/awesome-copilot) 和 [Agency Agents](https://github.com/msitarzewski/agency-agents) 的版本、适配说明及完整 MIT 声明保留在各自 JSON 的 `provenance` 中。

使用 [DSH](https://github.com/deepseek-ai/deepseek-harness) 的 Preset、Persona、Tools、Skills、Web、SessionController、WorkspaceRegistry、SystemPrompt、Gateway、Commands 与 Client Slots。校验依赖 [Ajv](https://github.com/ajv-validator/ajv)；声明解析、RPC 与界面复用宿主的 Cordis Include、[js-yaml](https://github.com/nodeca/js-yaml)、[Zod](https://github.com/colinhacks/zod)、[React](https://github.com/facebook/react)（均为 MIT）。[Mnemon](https://github.com/omdsh-dev/dsh-mnemon) 一类记忆插件和 [dsh-context](https://github.com/bowenliang123/dsh-context) 是可选的共存／观测对象，不是运行依赖；联合安装测试中，forged 会话的上下文包含 soul 和 Mnemon 记忆。
