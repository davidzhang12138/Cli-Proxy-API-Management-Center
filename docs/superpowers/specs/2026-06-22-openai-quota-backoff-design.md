# OpenAI 兼容 Provider 接入配额退避上下限配置

## 概述

上游 CLIProxyAPIPlus 为 `OpenAICompatibility` 结构新增了两个可选的 per-provider 字段，用于覆盖默认的 429 配额退避冷却上下限：

- `quota-backoff-min`：下限，Go duration 字符串（`"10s"` / `"5m"` / `"1h"` / `"2h30m"`）
- `quota-backoff-max`：上限，Go duration 字符串

另有两个 **deprecated** 的整型字段 `quota-backoff-min-seconds` / `quota-backoff-max-seconds`，后端为兼容保留，新字段优先。

本设计把这两个字段接入 Web UI 的 provider 表单（Sheet），沿现有 `disable-cooling` 的链路。**仅 `openaiCompatibility` brand** 涉及，gemini / codex / claude / vertex 不受影响。可视化配置编辑器（`VisualConfigEditor`）只处理顶层全局字段，本次不动。

## 设计决策（已与用户确认）

1. **字段兼容**：只接新字段 `quota-backoff-min/max`；读取时若新字段为空，回退读旧 `-seconds` 整型并换算成 Go duration 规范字符串回显（如 `1800` → `"30m0s"`）。写入时只写新 duration 字符串，不写旧字段。
2. **UI 位置**：在基础区 `disable-cooling` 之后新建「配额退避」折叠区，默认收起。min/max 用 `.fieldRow` 两列并排。折叠区标签带"已填字段数"计数 hint（0 或 2）。
3. **输入校验**：非空时做轻量格式校验，不合法则阻止提交并显示错误。

## 数据层改动

### `src/types/provider.ts`

`OpenAIProviderConfig` 增加两个可选字段：

```ts
quotaBackoffMin?: string;   // yaml: quota-backoff-min
quotaBackoffMax?: string;   // yaml: quota-backoff-max
```

### `src/services/api/transformers.ts`

新增工具函数 `secondsToDurationString(secs: number): string`，把整型秒数转成 Go duration 规范字符串：

- `30` → `"30s"`
- `1800` → `"30m0s"`
- `3600` → `"1h0m0s"`
- `90` → `"1m30s"`

实现思路：拆成 `h / m / s` 三段，跳过为 0 的前导段（但保证至少有一段，`0` → `"0s"`），非零段拼接单位。与 Go `time.Duration.String()` 输出一致。

`normalizeOpenAIProvider` 读取逻辑：

```ts
const quotaBackoffMinRaw = provider['quota-backoff-min'];
const quotaBackoffMinSeconds = provider['quota-backoff-min-seconds'];
let quotaBackoffMin: string | undefined;
if (typeof quotaBackoffMinRaw === 'string' && quotaBackoffMinRaw.trim()) {
  quotaBackoffMin = quotaBackoffMinRaw.trim();
} else if (typeof quotaBackoffMinSeconds === 'number' && Number.isFinite(quotaBackoffMinSeconds) && quotaBackoffMinSeconds > 0) {
  quotaBackoffMin = secondsToDurationString(quotaBackoffMinSeconds);
}
if (quotaBackoffMin) result.quotaBackoffMin = quotaBackoffMin;
// quotaBackoffMax 同理
```

字符串形式的 `-seconds`（如配置里写成 `"1800"`）也兼容：用 `Number(...)` 归一化后判断。

### `src/services/api/providers.ts`

- `OPENAI_PROVIDER_FIELDS` 追加 `'quota-backoff-min'`、`'quota-backoff-max'`。这样 `mergeKnownFields` 会把这两个 yaml key 纳入已知字段管理（payload 有值则覆盖，无值则保留 raw 里的原值）。deprecated 的 `-seconds` 字段**不**加入 known fields，走"未知字段保留"路径，原样透传，不做改动。
- `serializeOpenAIProvider` 写回：

```ts
if (provider.quotaBackoffMin?.trim()) payload['quota-backoff-min'] = provider.quotaBackoffMin.trim();
if (provider.quotaBackoffMax?.trim()) payload['quota-backoff-max'] = provider.quotaBackoffMax.trim();
```

空值不写 key（让 merge 逻辑保留 raw 原值或删除——见下"边界行为"）。

### 边界行为：清空字段

当用户把原本有值的字段清空并保存时，`serializeOpenAIProvider` 不产出该 key，`mergeKnownFields` 的行为是：`cloneWithoutKnownFields` 会先把 raw 里该 known field 删掉，再用 payload 覆盖（payload 里没有该 key 则不写回）。结论：**清空会从配置里删除该 key**，符合预期。

## 表单层改动

### `src/features/providers/types.ts`

`ProviderEntryFormInput` 增加两个可选字段：

```ts
quotaBackoffMin?: string;
quotaBackoffMax?: string;
```

### `src/features/providers/sheets/forms/BaseProviderForm.tsx`

**`buildInitialForm`**：
- create 模式：`quotaBackoffMin: ''`、`quotaBackoffMax: ''`
- edit 模式（openaiCompatibility 分支）：`quotaBackoffMin: cfg.quotaBackoffMin ?? ''`、`quotaBackoffMax: cfg.quotaBackoffMax ?? ''`（transformer 已处理旧字段回退，这里直接取）

**特性开关**：新增局部变量（不入 descriptors，与 `supportsOpenAIModelOptions` 一致）：

```ts
const supportsQuotaBackoff = brand === 'openaiCompatibility';
```

**计数 hint**：

```ts
const quotaBackoffCount = [form.quotaBackoffMin, form.quotaBackoffMax]
  .filter((v) => v && v.trim()).length;
```

**渲染**：在基础区 `supportsDisableCooling` 块之后插入：

```tsx
{supportsQuotaBackoff ? (
  <Collapsible
    label={t('providersPage.form.quotaBackoffSection')}
    hint={String(quotaBackoffCount)}
    defaultOpen={false}
  >
    <div className={styles.fieldRow}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${fid}-qbackoffMin`}>
          {t('providersPage.form.quotaBackoffMin')}
        </label>
        <input
          id={`${fid}-qbackoffMin`}
          className={styles.input}
          value={form.quotaBackoffMin ?? ''}
          placeholder="30s / 5m / 1h"
          onChange={(e) => updateField('quotaBackoffMin', e.target.value)}
          disabled={mutating}
        />
        <small className={styles.labelHint}>{t('providersPage.form.quotaBackoffMinHint')}</small>
      </div>
      <div className={styles.field}>
        {/* quotaBackoffMax 同理, placeholder="30m / 1h / 2h30m" */}
      </div>
    </div>
  </Collapsible>
) : null}
```

**校验**：复用现有单 error 机制（`validate()` 返回 `string | null`，顶部 `.errorBox` 显示）。在 `validate()` 末尾增加：

```ts
const DURATION_RE = /^(\d+(\.\d+)?(ns|us|µs|ms|s|m|h))+$/;
const NUM_RE = /^\d+(\.\d+)?$/;
const isDurationLike = (v: string) => DURATION_RE.test(v) || NUM_RE.test(v);
if (supportsQuotaBackoff) {
  const min = form.quotaBackoffMin?.trim() ?? '';
  const max = form.quotaBackoffMax?.trim() ?? '';
  if (min && !isDurationLike(min)) return t('providersPage.form.validation.invalidDuration');
  if (max && !isDurationLike(max)) return t('providersPage.form.validation.invalidDuration');
}
```

不合法时阻止提交（与 `nameRequired` 等同一通道）。纯数字（如 `"1800"`）允许通过——后端 `parseDurationString` 会把它当秒数处理，与旧行为兼容。

### `src/features/providers/useProviderWorkbench.ts`

`buildOpenAIConfig` 写回：

```ts
return {
  ...(existing ?? {}),
  ...
  quotaBackoffMin: input.quotaBackoffMin?.trim() || undefined,
  quotaBackoffMax: input.quotaBackoffMax?.trim() || undefined,
};
```

## i18n

`src/i18n/locales/zh-CN.json` 与 `en.json` 的 `providersPage.form` 下增加：

**zh-CN**:
```json
"quotaBackoffSection": "配额退避",
"quotaBackoffMin": "配额退避下限",
"quotaBackoffMinHint": "429 配额冷却下限,支持 30s / 5m / 1h / 2h30m",
"quotaBackoffMax": "配额退避上限",
"quotaBackoffMaxHint": "429 配额冷却上限,支持 30m / 1h / 2h30m",
```

`providersPage.form.validation` 下增加：
```json
"invalidDuration": "时长格式无效,请使用 30s / 5m / 1h 这样的格式"
```

**en**:
```json
"quotaBackoffSection": "Quota backoff",
"quotaBackoffMin": "Quota backoff min",
"quotaBackoffMinHint": "Min 429 quota cooldown, e.g. 30s / 5m / 1h / 2h30m",
"quotaBackoffMax": "Quota backoff max",
"quotaBackoffMaxHint": "Max 429 quota cooldown, e.g. 30m / 1h / 2h30m",
"invalidDuration": "Invalid duration format, use 30s / 5m / 1h"
```

## 受影响文件清单

| 文件 | 改动 |
|------|------|
| `src/types/provider.ts` | `OpenAIProviderConfig` 加 2 字段 |
| `src/services/api/transformers.ts` | `secondsToDurationString` + 读取兼容 |
| `src/services/api/providers.ts` | `OPENAI_PROVIDER_FIELDS` + `serializeOpenAIProvider` |
| `src/features/providers/types.ts` | `ProviderEntryFormInput` 加 2 字段 |
| `src/features/providers/sheets/forms/BaseProviderForm.tsx` | 初始化 + 渲染折叠区 + 校验 |
| `src/features/providers/useProviderWorkbench.ts` | `buildOpenAIConfig` 写回 |
| `src/i18n/locales/zh-CN.json` | 新 i18n 键 |
| `src/i18n/locales/en.json` | 新 i18n 键 |

## 验证

- `bun run type-check` 通过
- `bun run lint` 通过
- 手动验证：
  1. 编辑一个 openai 兼容 provider，展开「配额退避」，填 `30s` / `30m`，保存，重新打开确认回显一致。
  2. 填非法值 `abc`，提交被阻止，顶部显示时长格式错误。
  3. 两个字段都留空，保存后确认 yaml 里不出现这两个 key（且原本有值的会被清除）。
  4. 旧配置兼容：后端配置里写 `quota-backoff-min-seconds: 1800`，前端打开编辑能看到下限回显为 `30m0s`；保存后 yaml 里新字段 `quota-backoff-min: "30m0s"` 写入，旧 `-seconds` 字段保留不动（后端 deprecated 仍认）。

## 不在范围内

- 不改可视化配置编辑器（`VisualConfigEditor` / `useVisualConfig` / `configSearchIndex`）——它不处理 per-provider 字段。
- 不为 gemini / codex / claude / vertex 加这两个字段——后端这些结构里没有。
- 不删除 deprecated 的 `-seconds` 字段——后端仍兼容，前端透传不动。
