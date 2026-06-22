/**
 * 把整型秒数转成 Go time.Duration.String() 风格的字符串。
 * 1800 -> "30m0s", 90 -> "1m30s", 3600 -> "1h0m0s"。
 * 非正数返回 "0s"。纯工具函数,无项目内依赖,便于裸 Node 测试。
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
