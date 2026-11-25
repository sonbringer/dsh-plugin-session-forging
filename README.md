<p align="center">
  <a href="https://github.com/sonbringer"><img src="https://github.com/user-attachments/assets/7d0aca88-fd9d-4250-b118-1565560450a5" width="120" height="120" alt="会话锻造图标"></a>
</p>

<h1 align="center">Session Forging</h1>

<p align="center">创造和管理自己的上下文哲学体系，给 DSH 会话选择专精的设计图纸。</p>

<p align="center">
  <a href="https://github.com/sonbringer/dsh-plugin-session-forging/releases/latest"><img src="https://img.shields.io/github/v/release/sonbringer/dsh-plugin-session-forging?label=release" alt="最新发行版本"></a>
</p>

<p align="center"><a href="#安装">安装</a> · <a href="doc/handbook.md">操作手册</a> · <a href="doc/use-cases/">全部用例</a></p>

## 火种与火种源

灵感源于《变形金刚》系列作品中，火种源创造机械生命体，火种承载记忆和生命力的设定。权威组织们都在发布自己的会话理论，原生 DSH 提供的四种预设就是基于某种哲学体系下的4种不同用途的 agent。我想创造一个帮助用户便携管理多个体系的插件。

**火种**是会话模板，包含具体的角色指令、初始记忆、工具、Skills 和用量上限。**火种源**是多个火种的集合。比如，一个维护旧接口的团队可以共用「兼容性优先」火种源，设计会话记下保留旧行为的理由，测试会话带着旧客户端的验收用例开始工作。

我们关心上下文怎样组织。Liu 等人的多文档问答实验发现，仅仅移动包含答案的文档，模型的准确率就会变化。编码工具也给出了不同做法。Codex 分层读取项目指令，Gemini CLI 支持组合上下文文件，Claude Code 可以为子代理分别配置指令与工具。[研究论文](https://aclanthology.org/2024.tacl-1.9/) · [Codex](https://developers.openai.com/codex/guides/agents-md/) · [Gemini CLI](https://geminicli.com/docs/cli/gemini-md/) · [Claude Code](https://code.claude.com/docs/en/sub-agents)

## 我用 DSH 自己建几个模式，不就够了吗？

如果你只想复用一套 Persona、工具和 Skills，DSH 的自定义模式就够了。[DSH 模式说明](https://cdn.jsdelivr.net/npm/@deepseek-ai/dsh-client-ui-agent-preset@0.2.2-rc.5/README.zh.md)

在此之上，锻造台支持比原生 preset 更开放的作用域。

| 玩法 | preset | 锻造台 |
|---|---|---|
| 让会话记住自己的约定 | 同一模式复用一套角色指令 | 每个会话配独立 `soul.md`。编辑后，下次模型请求会读到新版并记录所用版本。 |
| 共享项目档案 | 用文件工具读写工作区 | **议事厅**附权限管理的会话共享档案记忆，按各自的写作偏好记录决定，面板保存时检查编辑冲突。 |
| 给其他会话派工 | 原生 Team 在同一棵子代理树内派工 | **召集令**领袖有权点名、分组或广播，逐人查看投递状态。跨区派工和恢复归档成员需授权。 |
| 从旧回复分支 | 原生分支继承截至该轮的历史 | **锻造分支**带走当时实际使用的 soul 和分支点的模型选择，之后父子会话各自编辑档案。 |
| 成组分享模板 | 在配置文件中声明模式 | **火种源**可将设计、研发、审查等火种整组预览、导入导出或另存。新会话固定所选版本，可单独填写使命。 |
| 复用常用配置 | 新会话从「模式」菜单选择 preset | **量产**火种有独立菜单，选好即可在原生输入框开聊。也可将已有会话的 soul、模型等另存为火种，新会话的历史和用量从零开始。 |
| 控制用量与时限 | 沿用宿主的单次输出上限 | **Energon** 可限制会话的累计 Token、估算费用及单轮步数或时长。到达截止时间会取消当前轮。 |

目前我正在开发更多功能。《变形金刚 2》中，威震天用另一名霸天虎的零件修复了身体。类似地，一个新会话能否从设计会话取一段接口约定、从测试会话取一段失败响应，带着两段原文和出处接手问题？这是后续想探索的方向。目前长任务仍可用压缩（compact）和交接（handoff）延续工作。[长任务 Agent 实践](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents)

## 安装

0.3.0 是首个公开的先行原型机，已在 DSH `0.2.2-rc.5` 验收。使用桌面版时，退出 DSH，在终端运行以下命令，完成后重开 App。

```sh
curl -fL 'https://github.com/sonbringer/dsh-plugin-session-forging/releases/latest/download/dsh-session-forging.tgz' -o dsh-session-forging.tgz
dsh plugin --profile desktop add --ignore-scripts ./dsh-session-forging.tgz
```

固定链接跟随 GitHub Latest，各版本附有 SHA-256 校验和。[发行记录](https://github.com/sonbringer/dsh-plugin-session-forging/releases)

想体验多人协作，可以让卡芙卡写剧本，再召集刃、银狼和流萤各演一幕。[星核猎手的剧本](doc/use-cases/星核猎手的剧本.md)

## 我是谁

三年 Agent 开发，JS 小白。锻造台是我练手的 DSH 插件，也是一份求职展示作品。我想亲手走一遍从发现需求、设计产品、做出原型，到验收并从反馈里找到下一个需求的过程。

## 贡献

欢迎带着具体的场景提建议。已经写好代码的朋友可以提 PR，也欢迎直接 fork，改成适合自己的版本。[功能建议](https://github.com/sonbringer/dsh-plugin-session-forging/tree/main/doc/prds)

## 许可与来源

项目采用 MIT 许可。内置火种源改编自 Awesome Copilot 和 Agency Agents，各自 JSON 的 `provenance` 保留了上游版本、适配说明和完整许可。[项目许可](LICENSE) · [Awesome Copilot](sources/awesome-copilot.json) · [Agency Agents](sources/agency-agents.json)
