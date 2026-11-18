# session-forging

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的会话配置 Persona、soul、模型与能力。

已提供火种源校验、登记和固定版本存储。会话创建与界面尚未接入。

```js
import { readFile } from 'node:fs/promises';
import { previewSource, SourceRegistry } from '@zhengrenwritecode/dsh-session-forging/sources';

const sources = new SourceRegistry('/absolute/path/to/forging/sources');
const text = await readFile('source.json', 'utf8');
const preview = previewSource(text); // 校验并预览，不写盘
const reference = await sources.register(text, preview.revision); // 用户确认后登记
const source = await sources.get(reference);
const exported = await sources.export(reference);
const registered = await sources.list();
```

格式见 [JSON Schema](schemas/source.schema.json)。上限 256 KiB、50 枚火种，空 soul 合法。重复 ID 不覆盖；读取必须携带 SHA-256 版本，内容损坏会报错。工具、模型和额度在此仅保存配置。

`SourceError.code` 区分校验失败、重复 ID、版本变化和存储损坏。`SOURCE_WRITE_UNCERTAIN` 表示文件已发布但持久化未确认，应重新读取核对，不要直接重试覆盖。

运行测试：`npm ci && npm test`。

[MIT](LICENSE) · 校验依赖：[Ajv](https://github.com/ajv-validator/ajv)（MIT）
