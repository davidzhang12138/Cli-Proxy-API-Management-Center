# OpenAI 兼容 Provider 配额退避上下限 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把上游 CLIProxyAPIPlus 新增的 per-provider `quota-backoff-min` / `quota-backoff-max` 字段接入 Web UI 的 OpenAI 兼容 provider 表单,支持读取(兼容旧 `-seconds` 整型)、编辑、校验、写回。

**Architecture:** 沿现有 `disable-cooling` 字段的链路:数据层(transformers 读取 + providers 序列化写回) → 表单层(BaseProviderForm 初始化/渲染/校验 + useProviderWorkbench 写回) → i18n。仅 `openaiCompatibility` brand 涉及,其它 brand 与可视化配置编辑器不动。

**Tech Stack:** React 19 + TypeScript + Zustand + i18next + SCSS Modules。测试用裸 TypeScript + `node --experimental-strip-types` 运行(项目无 vitest/jest,测试文件用自定义 `assertEqual` 断言,import 带 `.ts` 扩展名)。

**测试运行约定:** 本项目无测试框架,测试文件是可在 Node 直接执行的 `.ts` 脚本。运行命令:
```
node --experimental-strip-types <测试文件路径>
```
退出码 `0` = 通过;非 `0` 并打印 `Error: ...: expected X, got Y` = 失败。TDD 循环:先写测试 → 跑(应失败,通常因为引用了未导出的符号而抛 `ReferenceError`/`TypeError`)→ 实现 → 再跑(应退出码 0)。

**两个 `raw` 的区别(实现者必读):**
- 表单 `resource.raw`:是 `normalizeConfigResponse` 产物里的 `OpenAIProviderConfig` 对象(normalize 后),edit 模式 `buildInitialForm` 从这里读 `cfg.quotaBackoffMin`。所以**旧 `-seconds` 的回退换算必须发生在 `normalizeOpenAIProvider` 内部**——这里 normalize 完,表单才能拿到回退后的值。
- `mergeOpenAIProviderPayload` 的 `raw`:是 `getRawSectionList` 取的**原始 yaml record**(未 normalize),用于保存时保留未知字段。`-seconds` 字段不在 `OPENAI_PROVIDER_FIELDS` 里,会被 `cloneWithoutKnownFields` 原样保留,后端 deprecated 仍认。

---

## File Structure

| 文件 | 责任 | 改动类型 |
|------|------|---------|
| `src/types/provider.ts` | `OpenAIProviderConfig` 接口 | 加 2 字段 |
| `src/services/api/transformers.ts` | 配置读取归一化 + `secondsToDurationString` 工具 | 加工具函数 + 读取逻辑 |
| `src/services/api/providers.ts` | API 序列化 + 字段保留清单 | 加 known fields + 写回 |
| `src/features/providers/types.ts` | `ProviderEntryFormInput` 表单值类型 | 加 2 字段 |
| `src/features/providers/sheets/forms/BaseProviderForm.tsx` | 表单初始化/渲染/校验 | 初始化 + 折叠区 + 校验 |
| `src/features/providers/useProviderWorkbench.ts` | 表单值 → 配置对象 | `buildOpenAIConfig` 写回 |
| `src/i18n/locales/zh-CN.json` | 中文文案 | 加 6 键 |
| `src/i18n/locales/en.json` | 英文文案 | 加 6 键 |
| `src/services/api/transformers.duration.test.ts` | `secondsToDurationString` 单测 | 新建测试 |

---

## Task 1: `secondsToDurationString` 工具函数(TDD)

**Files:**
- Create: `src/services/api/transformers.duration.test.ts`
- Modify: `src/services/api/transformers.ts`(在 `normalizePrefix` 之前,line 88 之前,插入新函数并导出)

- [ ] **Step 1: 写失败测试**

Create `src/services/api/transformers.duration.test.ts`:

```ts
import { secondsToDurationString } from './transformers.ts';

const assertEqual = (actual: unknown, expected: unknown, message: string) => {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
};

// 整秒 → 秒段
assertEqual(secondsToDurationString(30), '30s', '30s');

// 整分(秒数 = 60 的倍数)→ 分+秒,秒段保留 0
assertEqual(secondsToDurationString(1800), '30m0s', '1800s -> 30m0s');

// 整时
assertEqual(secondsToDurationString(3600), '1h0m0s', '3600s -> 1h0m0s');

// 时分秒混合
assertEqual(secondsToDurationString(90), '1m30s', '90s -> 1m30s');
assertEqual(secondsToDurationString(5410), '1h30m10s', '5410s -> 1h30m10s');

// 0 / 非正 → 退化处理(返回 '0s')
assertEqual(secondsToDurationString(0), '0s', '0 -> 0s');
assertEqual(secondsToDurationString(-5), '0s', 'negative -> 0s');

console.log('secondsToDurationString: all assertions passed');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --experimental-strip-types src/services/api/transformers.duration.test.ts`
Expected: 失败,报错形如 `SyntaxError: The requested module './transformers.ts' does not provide an export named 'secondsToDurationString'` 或 `ReferenceError`。退出码非 0。

- [ ] **Step 3: 实现 `secondsToDurationString`**

在 `src/services/api/transformers.ts` 的 `normalizePrefix`(line 88)之前插入:

```ts
/**
 * 把整型秒数转成 Go time.Duration.String() 风格的字符串。
 * 1800 -> "30m0s", 90 -> "1m30s", 3600 -> "1h0m0s"。
 * 非正数返回 "0s"。
 */
export const secondsToDurationString = (secs: number): string => {
  if (!Number.isFinite(secs) || secs <= 0) return '0s';
  const totalSeconds = Math.floor(secs);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join('');
};
```

设计说明:`h > 0` 时强制输出 `m` 段(即使 m=0),与 Go `time.Duration.String()` 一致(如 `1h0m0s`);`s` 段始终输出作为兜底,保证至少一段。当 h=0、m=0 时只剩 `${s}s`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --experimental-strip-types src/services/api/transformers.duration.test.ts`
Expected: 打印 `secondsToDurationString: all assertions passed`,退出码 0。

- [ ] **Step 5: 提交**

```bash
git add src/services/api/transformers.duration.test.ts src/services/api/transformers.ts
git commit -m "feat(api): add secondsToDurationString helper for backoff compat"
```

---

## Task 2: 类型定义 — `OpenAIProviderConfig` 加字段

**Files:**
- Modify: `src/types/provider.ts:57-70`(OpenAIProviderConfig 接口)

- [ ] **Step 1: 加字段**

在 `src/types/provider.ts` 的 `OpenAIProviderConfig` 接口里,`disableCooling?: boolean;` 之后、`authIndex?: string;` 之前插入:

```ts
  /** 429 配额退避冷却下限,Go duration 字符串如 "30s"/"5m"/"1h"。yaml: quota-backoff-min */
  quotaBackoffMin?: string;
  /** 429 配额退避冷却上限,Go duration 字符串如 "30m"/"1h"/"2h30m"。yaml: quota-backoff-max */
  quotaBackoffMax?: string;
```

- [ ] **Step 2: type-check 确认无破坏**

Run: `npx tsc --noEmit`
Expected: 退出码 0(无类型错误)。

- [ ] **Step 3: 提交**

```bash
git add src/types/provider.ts
git commit -m "feat(types): add quotaBackoffMin/Max to OpenAIProviderConfig"
```

---

## Task 3: 读取归一化 — `normalizeOpenAIProvider` 读取并兼容旧字段

**Files:**
- Modify: `src/services/api/transformers.ts:237-255`(normalizeOpenAIProvider 的 result 构造段)

- [ ] **Step 1: 加读取逻辑**

定位 `normalizeOpenAIProvider` 里这一段(约 line 245-246):

```ts
  const disableCooling = normalizeBoolean(provider['disable-cooling']);
  if (disableCooling !== undefined) result.disableCooling = disableCooling;
```

在它之后插入:

```ts
  const quotaBackoffMinRaw = provider['quota-backoff-min'];
  if (typeof quotaBackoffMinRaw === 'string' && quotaBackoffMinRaw.trim()) {
    result.quotaBackoffMin = quotaBackoffMinRaw.trim();
  } else {
    const minSeconds = provider['quota-backoff-min-seconds'];
    const minSecNum = typeof minSeconds === 'number' ? minSeconds : Number(minSeconds);
    if (Number.isFinite(minSecNum) && minSecNum > 0) {
      result.quotaBackoffMin = secondsToDurationString(minSecNum);
    }
  }
  const quotaBackoffMaxRaw = provider['quota-backoff-max'];
  if (typeof quotaBackoffMaxRaw === 'string' && quotaBackoffMaxRaw.trim()) {
    result.quotaBackoffMax = quotaBackoffMaxRaw.trim();
  } else {
    const maxSeconds = provider['quota-backoff-max-seconds'];
    const maxSecNum = typeof maxSeconds === 'number' ? maxSeconds : Number(maxSeconds);
    if (Number.isFinite(maxSecNum) && maxSecNum > 0) {
      result.quotaBackoffMax = secondsToDurationString(maxSecNum);
    }
  }
```

逻辑:优先读新字段(字符串);为空时回退读旧 `-seconds`(兼容数字和数字字符串两种写法),换算成 duration 字符串。

- [ ] **Step 2: type-check**

Run: `npx tsc --noEmit`
Expected: 退出码 0。

- [ ] **Step 3: 提交**

```bash
git add src/services/api/transformers.ts
git commit -m "feat(api): read quota-backoff min/max with -seconds fallback"
```

---

## Task 4: 序列化写回 — `OPENAI_PROVIDER_FIELDS` + `serializeOpenAIProvider`

**Files:**
- Modify: `src/services/api/providers.ts:55-66`(OPENAI_PROVIDER_FIELDS)与 `:389-407`(serializeOpenAIProvider)

- [ ] **Step 1: known fields 加两项**

在 `src/services/api/providers.ts` 的 `OPENAI_PROVIDER_FIELDS` 数组里,`'disable-cooling'` 之后追加两行:

```ts
const OPENAI_PROVIDER_FIELDS = [
  'name',
  'priority',
  'disabled',
  'prefix',
  'base-url',
  'api-key-entries',
  'headers',
  'models',
  'test-model',
  'disable-cooling',
  'quota-backoff-min',
  'quota-backoff-max',
] as const;
```

注意:**不**加 `quota-backoff-min-seconds` / `quota-backoff-max-seconds`——让它们走"未知字段保留"路径,后端 deprecated 仍生效,前端不主动改写。

- [ ] **Step 2: serialize 写回**

在 `serializeOpenAIProvider` 里,`if (provider.disableCooling) payload['disable-cooling'] = true;` 这行之后插入:

```ts
  if (provider.quotaBackoffMin?.trim()) payload['quota-backoff-min'] = provider.quotaBackoffMin.trim();
  if (provider.quotaBackoffMax?.trim()) payload['quota-backoff-max'] = provider.quotaBackoffMax.trim();
```

- [ ] **Step 3: type-check**

Run: `npx tsc --noEmit`
Expected: 退出码 0。

- [ ] **Step 4: 提交**

```bash
git add src/services/api/providers.ts
git commit -m "feat(api): persist quota-backoff min/max in openai compat payload"
```

---

## Task 5: 表单值类型 — `ProviderEntryFormInput` 加字段

**Files:**
- Modify: `src/features/providers/types.ts:105-130`(ProviderEntryFormInput 接口)

- [ ] **Step 1: 加字段**

在 `src/features/providers/types.ts` 的 `ProviderEntryFormInput` 接口里,`disableCooling?: boolean;` 之后插入:

```ts
  /** OpenAI 兼容 provider 的 429 配额退避下限(duration 字符串) */
  quotaBackoffMin?: string;
  /** OpenAI 兼容 provider 的 429 配额退避上限(duration 字符串) */
  quotaBackoffMax?: string;
```

- [ ] **Step 2: type-check**

Run: `npx tsc --noEmit`
Expected: 退出码 0。

- [ ] **Step 3: 提交**

```bash
git add src/features/providers/types.ts
git commit -m "feat(providers): add quotaBackoff fields to ProviderEntryFormInput"
```

---

## Task 6: 表单初始化与写回 — `buildInitialForm` + `buildOpenAIConfig`

**Files:**
- Modify: `src/features/providers/sheets/forms/BaseProviderForm.tsx:64-135`(buildInitialForm)
- Modify: `src/features/providers/useProviderWorkbench.ts:140-181`(buildOpenAIConfig)

- [ ] **Step 1: create 模式初始化**

在 `src/features/providers/sheets/forms/BaseProviderForm.tsx` 的 `buildInitialForm` 函数,create 分支(约 line 70-96,`return { ... disabled: false, disableCooling: false,` 这段)里,`disableCooling: false,` 之后插入:

```ts
      quotaBackoffMin: '',
      quotaBackoffMax: '',
```

- [ ] **Step 2: edit 模式初始化(openaiCompatibility 分支)**

在同函数的 `if (brand === 'openaiCompatibility')` 分支(约 line 100-134),`disableCooling: cfg.disableCooling === true,` 之后插入:

```ts
      quotaBackoffMin: cfg.quotaBackoffMin ?? '',
      quotaBackoffMax: cfg.quotaBackoffMax ?? '',
```

`cfg` 是 `OpenAIProviderConfig`,transformer 已把旧 `-seconds` 换算成 `quotaBackoffMin/Max`,这里直接取。

- [ ] **Step 3: `buildOpenAIConfig` 写回**

在 `src/features/providers/useProviderWorkbench.ts` 的 `buildOpenAIConfig` 函数返回对象里(约 line 168-180),`disableCooling: input.disableCooling === true,` 之后插入:

```ts
    quotaBackoffMin: input.quotaBackoffMin?.trim() || undefined,
    quotaBackoffMax: input.quotaBackoffMax?.trim() || undefined,
```

- [ ] **Step 4: type-check**

Run: `npx tsc --noEmit`
Expected: 退出码 0。

- [ ] **Step 5: 提交**

```bash
git add src/features/providers/sheets/forms/BaseProviderForm.tsx src/features/providers/useProviderWorkbench.ts
git commit -m "feat(providers): init and persist quotaBackoff in provider form"
```

---

## Task 7: i18n 文案

**Files:**
- Modify: `src/i18n/locales/zh-CN.json`(`providersPage.form` 段,约 line 2230 附近)
- Modify: `src/i18n/locales/en.json`(同段)

- [ ] **Step 1: 中文文案**

在 `src/i18n/locales/zh-CN.json` 的 `providersPage.form` 对象里,`"disableCoolingHint": "仅对当前凭据或提供商禁用失败后的冷却窗口",` 之后插入:

```json
      "quotaBackoffSection": "配额退避",
      "quotaBackoffMin": "配额退避下限",
      "quotaBackoffMinHint": "429 配额冷却下限,支持 30s / 5m / 1h / 2h30m",
      "quotaBackoffMax": "配额退避上限",
      "quotaBackoffMaxHint": "429 配额冷却上限,支持 30m / 1h / 2h30m",
```

在同文件 `providersPage.form.validation` 对象里(`"baseUrlRequired": "服务地址必填"` 之后)插入:

```json
        "invalidDuration": "时长格式无效,请使用 30s / 5m / 1h 这样的格式"
```

注意保持正确的逗号与缩进(嵌套层级:`providersPage.form.validation`,比 form 字段多一层缩进)。

- [ ] **Step 2: 英文文案**

在 `src/i18n/locales/en.json` 的 `providersPage.form` 对象里,`"disableCoolingHint": "Disable failure cooldown windows only for this credential or provider",` 之后插入:

```json
      "quotaBackoffSection": "Quota backoff",
      "quotaBackoffMin": "Quota backoff min",
      "quotaBackoffMinHint": "Min 429 quota cooldown, e.g. 30s / 5m / 1h / 2h30m",
      "quotaBackoffMax": "Quota backoff max",
      "quotaBackoffMaxHint": "Max 429 quota cooldown, e.g. 30m / 1h / 2h30m",
```

在同文件 `providersPage.form.validation` 对象里(`"baseUrlRequired": "Base URL is required"` 之后)插入:

```json
        "invalidDuration": "Invalid duration format, use 30s / 5m / 1h"
```

- [ ] **Step 3: 校验 JSON 合法性**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/zh-CN.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/locales/en.json','utf8')); console.log('json ok')"`
Expected: 打印 `json ok`,退出码 0。

- [ ] **Step 4: 提交**

```bash
git add src/i18n/locales/zh-CN.json src/i18n/locales/en.json
git commit -m "feat(i18n): add quota backoff labels and validation message"
```

---

## Task 8: 表单渲染 — 「配额退避」折叠区

**Files:**
- Modify: `src/features/providers/sheets/forms/BaseProviderForm.tsx`(在 `supportsDisableCooling` 块之后,line 727 附近插入渲染;在 `supportsDisableCooling` 变量声明附近加 `supportsQuotaBackoff`)

- [ ] **Step 1: 加特性开关与计数**

在 `src/features/providers/sheets/forms/BaseProviderForm.tsx` 约line 447-452(`const supportsDisableCooling = ...` 与 `const supportsOpenAIModelOptions = brand === 'openaiCompatibility';` 附近),`supportsOpenAIModelOptions` 那行之后插入:

```ts
  const supportsQuotaBackoff = brand === 'openaiCompatibility';
  const quotaBackoffCount = [form.quotaBackoffMin, form.quotaBackoffMax].filter(
    (v) => v && v.trim()
  ).length;
```

- [ ] **Step 2: 渲染折叠区**

在基础区 `supportsDisableCooling` 的 `<label>...</label>` 块结束之后(约 line 727,即 `) : null}` 之后、`</div>` 闭合基础区 section 之前)插入:

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
                <small className={styles.labelHint}>
                  {t('providersPage.form.quotaBackoffMinHint')}
                </small>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`${fid}-qbackoffMax`}>
                  {t('providersPage.form.quotaBackoffMax')}
                </label>
                <input
                  id={`${fid}-qbackoffMax`}
                  className={styles.input}
                  value={form.quotaBackoffMax ?? ''}
                  placeholder="30m / 1h / 2h30m"
                  onChange={(e) => updateField('quotaBackoffMax', e.target.value)}
                  disabled={mutating}
                />
                <small className={styles.labelHint}>
                  {t('providersPage.form.quotaBackoffMaxHint')}
                </small>
              </div>
            </div>
          </Collapsible>
        ) : null}
```

确认 `Collapsible` 已在文件顶部 import(line 13 已有 `import { Collapsible } from '@/components/ui/Collapsible';`),无需新增 import。`styles.fieldRow` / `styles.field` / `styles.label` / `styles.input` / `styles.labelHint` 均为现有 SCSS 类。

- [ ] **Step 3: type-check + lint**

Run: `npx tsc --noEmit && npx eslint src/features/providers/sheets/forms/BaseProviderForm.tsx --report-unused-disable-directives`
Expected: 退出码 0,无 lint 报错。

- [ ] **Step 4: 提交**

```bash
git add src/features/providers/sheets/forms/BaseProviderForm.tsx
git commit -m "feat(providers): render quota backoff collapsible in openai compat form"
```

---

## Task 9: 表单校验 — duration 格式

**Files:**
- Modify: `src/features/providers/sheets/forms/BaseProviderForm.tsx:403-414`(validate 函数)

- [ ] **Step 1: 在 validate 末尾加校验**

在 `src/features/providers/sheets/forms/BaseProviderForm.tsx` 的 `validate` 函数,`return null;` 之前插入:

```ts
  if (brand === 'openaiCompatibility') {
    const DURATION_RE = /^(\d+(\.\d+)?(ns|us|µs|ms|s|m|h))+$/;
    const NUM_RE = /^\d+(\.\d+)?$/;
    const isDurationLike = (v: string) => DURATION_RE.test(v) || NUM_RE.test(v);
    const min = form.quotaBackoffMin?.trim() ?? '';
    const max = form.quotaBackoffMax?.trim() ?? '';
    if (min && !isDurationLike(min)) {
      return t('providersPage.form.validation.invalidDuration');
    }
    if (max && !isDurationLike(max)) {
      return t('providersPage.form.validation.invalidDuration');
    }
  }
```

说明:非空才校验;允许 Go duration 串(如 `30s`/`5m`/`1h`/`2h30m`)与纯数字(当秒数,后端 `parseDurationString` 兼容)。不合法返回单条 error,复用顶部 `.errorBox` 显示,与 `nameRequired` 等同通道。

- [ ] **Step 2: type-check + lint**

Run: `npx tsc --noEmit && npx eslint src/features/providers/sheets/forms/BaseProviderForm.tsx`
Expected: 退出码 0。

- [ ] **Step 3: 提交**

```bash
git add src/features/providers/sheets/forms/BaseProviderForm.tsx
git commit -m "feat(providers): validate quota backoff duration format on submit"
```

---

## Task 10: 全量验证 + 收尾

**Files:** 无新改动,仅运行验证。

- [ ] **Step 1: 全量 type-check**

Run: `npx tsc --noEmit`
Expected: 退出码 0。

- [ ] **Step 2: 全量 lint**

Run: `npx eslint . --ext ts,tsx --report-unused-disable-directives`
Expected: 退出码 0(或仅与本次改动无关的既有告警;若有本次引入的报错必须修)。

- [ ] **Step 3: 跑全部新增/相关测试**

Run: `node --experimental-strip-types src/services/api/transformers.duration.test.ts`
Expected: 打印 `secondsToDurationString: all assertions passed`,退出码 0。

- [ ] **Step 4: 构建产物确认**

Run: `npm run build`
Expected: `tsc` 与 `vite build` 均成功,退出码 0,产出 `dist/index.html`。

- [ ] **Step 5: 手动验证清单(需连接后端,若环境不具备则标注跳过)**

1. 编辑一个 openai 兼容 provider,展开「配额退避」折叠区,填 `30s` / `30m`,保存。重新打开该 provider,确认两个字段回显为 `30s` / `30m`。
2. 填非法值 `abc`,点保存,确认顶部出现时长格式错误且未提交。
3. 两个字段都留空保存,确认后端配置 yaml 里不出现 `quota-backoff-min/max`(若原本有则被清除)。
4. 旧字段兼容:在后端配置里把某 provider 改成 `quota-backoff-min-seconds: 1800`,前端打开编辑该 provider,确认下限回显为 `30m0s`;保存后确认 yaml 新增 `quota-backoff-min: "30m0s"`,旧 `quota-backoff-min-seconds` 仍保留(后端 deprecated 仍认)。

- [ ] **Step 6: 最终提交(若有手动验证修复)**

若手动验证发现需修复,修复后提交;否则无额外提交。所有改动已在 Task 1-9 分步提交。

---

## Self-Review

**1. Spec coverage:**
- 数据层 `provider.ts` 加字段 → Task 2 ✓
- `transformers.ts` 读取 + `secondsToDurationString` + 旧字段回退 → Task 1 + Task 3 ✓
- `providers.ts` `OPENAI_PROVIDER_FIELDS` + `serializeOpenAIProvider` → Task 4 ✓
- 表单层 `types.ts` 加字段 → Task 5 ✓
- `BaseProviderForm.tsx` 初始化 + 渲染折叠区 + 校验 → Task 6 + Task 8 + Task 9 ✓
- `useProviderWorkbench.ts` 写回 → Task 6 ✓
- i18n → Task 7 ✓
- 验证(type-check/lint/build/手动)→ Task 10 ✓

**2. Placeholder scan:** 无 TBD/TODO;每个 code step 都给了完整代码;运行命令给了具体路径与期望输出。

**3. Type consistency:** `quotaBackoffMin` / `quotaBackoffMax` 命名在所有任务中一致;`secondsToDurationString` 签名一致;`OPENAI_PROVIDER_FIELDS` 数组顺序明确;`ProviderEntryFormInput` 字段名与 `buildInitialForm` / `buildOpenAIConfig` 引用一致。
