import type { BenchmarkThinkingLevel } from '@/types';

export interface BenchmarkEvaluation {
  score: number;
  note: string;
}

export interface BenchmarkCase {
  id: string;
  category: string;
  label: string;
  prompt: string;
  evaluate: (answer: string) => BenchmarkEvaluation;
}

export const BENCHMARK_SYSTEM_PROMPT =
  '你正在参加模型能力对比。请严格遵守题目要求，只输出题目指定的内容；不要提及 provider，不要调用工具。';

const clampScore = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const extractJsonObject = (answer: string): Record<string, unknown> | null => {
  const normalized = answer
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = normalized.indexOf('{');
  const end = normalized.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(normalized.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const readString = (record: Record<string, unknown>, key: string): string =>
  typeof record[key] === 'string' ? record[key].trim() : '';

const evaluateColorPuzzle = (answer: string): BenchmarkEvaluation => {
  const json = extractJsonObject(answer);
  if (!json) return { score: 0, note: '未返回可解析的 JSON' };
  const expected: Record<string, string> = { 甲: '绿', 乙: '蓝', 丙: '红' };
  const matched = Object.entries(expected).filter(
    ([key, value]) => readString(json, key) === value
  );
  const score = clampScore((matched.length / 3) * 100);
  return {
    score,
    note: score === 100 ? '答案与约束完全一致' : `命中 ${matched.length}/3 个对应关系`,
  };
};

const evaluateAsyncCode = (answer: string): BenchmarkEvaluation => {
  const normalized = answer.toLowerCase();
  const waitsForResults = /await\s+fetchvalue/.test(normalized) || /promise\.all/.test(normalized);
  const aggregatesResults =
    /for\s*(?:await\s+)?\s*(?:\(|const\s|let\s)/.test(normalized) ||
    /\.reduce\s*\(/.test(normalized) ||
    /promise\.all/.test(normalized);
  const returnsAggregate =
    /return\s+total/.test(normalized) || /return\s+(?:await\s+)?promise\.all/.test(normalized);
  const checks = [
    waitsForResults,
    aggregatesResults,
    returnsAggregate,
    !/foreach\s*\(\s*async/.test(normalized),
  ];
  const matched = checks.filter(Boolean).length;
  const score = clampScore((matched / checks.length) * 100);
  return {
    score,
    note:
      score === 100 ? '等待异步结果的实现符合要求' : `命中 ${matched}/${checks.length} 个修复要点`,
  };
};

const evaluateArithmetic = (answer: string): BenchmarkEvaluation => {
  const json = extractJsonObject(answer);
  if (!json) {
    const matched = /736(?:\.0+)?/.test(answer) ? 1 : 0;
    return {
      score: matched ? 50 : 0,
      note: matched ? '数值正确，但没有返回可解析的 JSON' : '未找到正确结果 736',
    };
  }
  const amount = Number(json.amount);
  const formula = readString(json, 'formula');
  const amountCorrect = Number.isFinite(amount) && Math.abs(amount - 736) < 0.001;
  const formulaComplete =
    /800/.test(formula) && /1\.15|15%/.test(formula) && /0\.8|20%/.test(formula);
  const score = clampScore(Number(amountCorrect) * 70 + Number(formulaComplete) * 30);
  return {
    score,
    note:
      score === 100
        ? '计算结果和公式均正确'
        : `结果${amountCorrect ? '' : '不'}正确，公式${formulaComplete ? '' : '不'}完整`,
  };
};

export const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    id: 'constraint-json',
    category: '推理',
    label: '约束推理 · JSON',
    prompt:
      '请解决这个逻辑题。甲、乙、丙各选一个不同颜色：红、蓝、绿。甲不选红；乙不选绿；丙不选蓝；按红<蓝<绿的顺序，乙的颜色排在丙后面；甲和乙颜色不同。只输出最终对应关系 JSON，格式必须是 {"甲":"...","乙":"...","丙":"..."}，不要解释。',
    evaluate: evaluateColorPuzzle,
  },
  {
    id: 'async-code',
    category: '代码',
    label: '异步修复 · 代码',
    prompt:
      '请修复下面的 JavaScript 函数。要求等待每次 fetchValue 的异步结果后再返回总和；只输出修复后的函数代码，不要解释。\n\nfunction sum(values) { let total = 0; values.forEach(async (value) => { total += await fetchValue(value); }); return total; }',
    evaluate: evaluateAsyncCode,
  },
  {
    id: 'arithmetic-json',
    category: '计算',
    label: '多步计算 · JSON',
    prompt:
      '本金是 800，先增长 15%，再减少 20%。请计算最终金额。只输出 JSON，格式必须是 {"amount": number, "formula": string}，amount 必须是数字，不要解释。',
    evaluate: evaluateArithmetic,
  },
];

export const THINKING_LEVELS: Array<{ value: BenchmarkThinkingLevel; label: string }> = [
  { value: 'none', label: 'None · 不启用思考' },
  { value: 'minimal', label: 'Minimal · 最低' },
  { value: 'low', label: 'Low · 低' },
  { value: 'medium', label: 'Medium · 中' },
  { value: 'high', label: 'High · 高' },
  { value: 'xhigh', label: 'XHigh · 极高' },
  { value: 'max', label: 'Max · 最大' },
  { value: 'auto', label: 'Auto · 自动' },
];

export const randomize = <T>(items: T[], random = Math.random): T[] => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
};

export const formatBenchmarkNumber = (value: number, digits = 0): string =>
  new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
