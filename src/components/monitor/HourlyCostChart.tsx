import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chart } from 'react-chartjs-2';
import type { UsageData } from '@/pages/MonitorPage';
import { calculateCost, formatUsd, loadModelPrices } from '@/utils/usage';
import { formatLocalHourKey, getHourlyRangeBounds } from '@/utils/monitor';
import styles from '@/pages/MonitorPage.module.scss';

interface HourlyCostChartProps {
  data: UsageData | null;
  loading: boolean;
  isDark: boolean;
}

type HourRange = 6 | 12 | 24;
type ViewMode = 'model' | 'cost' | 'token';

const MODEL_COLORS = [
  'rgba(59, 130, 246, 0.7)',
  'rgba(34, 197, 94, 0.7)',
  'rgba(249, 115, 22, 0.7)',
  'rgba(139, 92, 246, 0.7)',
  'rgba(236, 72, 153, 0.7)',
  'rgba(6, 182, 212, 0.7)',
];

export function HourlyCostChart({ data, loading, isDark }: HourlyCostChartProps) {
  const { t } = useTranslation();
  const [hourRange, setHourRange] = useState<HourRange>(12);
  const [viewMode, setViewMode] = useState<ViewMode>('model');
  const modelPrices = useMemo(() => loadModelPrices(), []);
  const hasModelPrices = Object.keys(modelPrices).length > 0;

  const hourlyData = useMemo(() => {
    const empty = {
      hours: [] as string[],
      cost: {
        costs: [] as number[],
        requestCounts: [] as number[],
        totalCost: 0,
      },
      token: {
        totalTokens: [] as number[],
        inputTokens: [] as number[],
        outputTokens: [] as number[],
        cachedTokens: [] as number[],
      },
      model: {
        models: [] as string[],
        modelData: {} as Record<string, number[]>,
        successRates: [] as number[],
      },
    };

    if (!data?.apis) return empty;

    const { start: cutoffTime, end: currentHour, bucketCount } = getHourlyRangeBounds(hourRange);
    const allHours: string[] = [];
    for (let i = 0; i < bucketCount; i++) {
      const hourTime = new Date(cutoffTime.getTime() + i * 60 * 60 * 1000);
      allHours.push(formatLocalHourKey(hourTime));
    }

    const costStats: Record<string, { cost: number; requests: number }> = {};
    const tokenStats: Record<string, { total: number; input: number; output: number; cached: number }> = {};
    const modelStats: Record<string, Record<string, { success: number; failed: number }>> = {};

    allHours.forEach((hour) => {
      costStats[hour] = { cost: 0, requests: 0 };
      tokenStats[hour] = { total: 0, input: 0, output: 0, cached: 0 };
      modelStats[hour] = {};
    });

    Object.values(data.apis).forEach((apiData) => {
      Object.entries(apiData.models).forEach(([modelName, modelData]) => {
        modelData.details.forEach((detail) => {
          const timestamp = new Date(detail.timestamp);
          timestamp.setMinutes(0, 0, 0);
          if (timestamp < cutoffTime || timestamp > currentHour) return;

          const hourKey = formatLocalHourKey(timestamp);

          if (!modelStats[hourKey][modelName]) {
            modelStats[hourKey][modelName] = { success: 0, failed: 0 };
          }
          if (detail.failed) {
            modelStats[hourKey][modelName].failed += 1;
          } else {
            modelStats[hourKey][modelName].success += 1;
            tokenStats[hourKey].total += detail.tokens.total_tokens || 0;
            tokenStats[hourKey].input += detail.tokens.input_tokens || 0;
            tokenStats[hourKey].output += detail.tokens.output_tokens || 0;
            tokenStats[hourKey].cached += detail.tokens.cached_tokens || detail.tokens.cache_tokens || 0;

            if (hasModelPrices) {
              costStats[hourKey].cost += calculateCost(
                {
                  ...detail,
                  auth_index: Number(detail.auth_index) || 0,
                  __modelName: modelName,
                },
                modelPrices
              );
            }
          }
          costStats[hourKey].requests += 1;
        });
      });
    });

    const hours = allHours.sort();

    const modelTotals: Record<string, number> = {};
    hours.forEach((hour) => {
      Object.entries(modelStats[hour]).forEach(([modelName, stats]) => {
        modelTotals[modelName] = (modelTotals[modelName] || 0) + stats.success + stats.failed;
      });
    });

    const topModels = Object.entries(modelTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name]) => name);

    const successRates = hours.map((hour) => {
      let totalSuccess = 0;
      let totalRequests = 0;
      Object.values(modelStats[hour]).forEach((stats) => {
        totalSuccess += stats.success;
        totalRequests += stats.success + stats.failed;
      });
      return totalRequests > 0 ? (totalSuccess / totalRequests) * 100 : 0;
    });

    return {
      hours,
      cost: {
        costs: hours.map((hour) => costStats[hour].cost),
        requestCounts: hours.map((hour) => costStats[hour].requests),
        totalCost: hours.reduce((sum, hour) => sum + costStats[hour].cost, 0),
      },
      token: {
        totalTokens: hours.map((hour) => tokenStats[hour].total / 1000),
        inputTokens: hours.map((hour) => tokenStats[hour].input / 1000),
        outputTokens: hours.map((hour) => tokenStats[hour].output / 1000),
        cachedTokens: hours.map((hour) => tokenStats[hour].cached / 1000),
      },
      model: {
        models: topModels,
        modelData: Object.fromEntries(
          topModels.map((modelName) => [
            modelName,
            hours.map((hour) => {
              const stats = modelStats[hour][modelName];
              return stats ? stats.success + stats.failed : 0;
            }),
          ])
        ),
        successRates,
      },
    };
  }, [data, hasModelPrices, hourRange, modelPrices]);

  const hourRangeLabel = useMemo(() => {
    if (hourRange === 6) return t('monitor.hourly.last_6h');
    if (hourRange === 12) return t('monitor.hourly.last_12h');
    return t('monitor.hourly.last_24h');
  }, [hourRange, t]);

  const labels = useMemo(
    () => hourlyData.hours.map((hour) => `${Number(hour.slice(11, 13))}:00`),
    [hourlyData.hours]
  );

  const chartData = useMemo(() => {
    if (viewMode === 'cost') {
      return {
        labels,
        datasets: [
          {
            type: 'line' as const,
            label: t('usage_stats.total_cost'),
            data: hourlyData.cost.costs,
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.2)',
            borderWidth: 2.5,
            tension: 0.35,
            fill: true,
            yAxisID: 'y',
            pointRadius: 3,
            pointHoverRadius: 4,
            pointBackgroundColor: '#f59e0b',
          },
          {
            type: 'bar' as const,
            label: t('monitor.requests'),
            data: hourlyData.cost.requestCounts,
            backgroundColor: 'rgba(59, 130, 246, 0.22)',
            borderColor: 'rgba(59, 130, 246, 0.35)',
            borderWidth: 1,
            borderRadius: 4,
            yAxisID: 'y1',
          },
        ],
      };
    }

    if (viewMode === 'token') {
      return {
        labels,
        datasets: [
          {
            type: 'line' as const,
            label: t('monitor.hourly_token.input'),
            data: hourlyData.token.inputTokens,
            borderColor: '#22c55e',
            backgroundColor: '#22c55e',
            borderWidth: 2,
            tension: 0.4,
            yAxisID: 'y',
            pointRadius: 3,
            pointBackgroundColor: '#22c55e',
          },
          {
            type: 'line' as const,
            label: t('monitor.hourly_token.output'),
            data: hourlyData.token.outputTokens,
            borderColor: '#f97316',
            backgroundColor: '#f97316',
            borderWidth: 2,
            tension: 0.4,
            yAxisID: 'y',
            pointRadius: 3,
            pointBackgroundColor: '#f97316',
          },
          {
            type: 'bar' as const,
            label: t('monitor.hourly_token.cached'),
            data: hourlyData.token.cachedTokens,
            backgroundColor: 'rgba(14, 165, 233, 0.5)',
            borderColor: 'rgba(14, 165, 233, 0.6)',
            borderWidth: 1,
            borderRadius: 4,
            yAxisID: 'y',
          },
          {
            type: 'bar' as const,
            label: t('monitor.hourly_token.total'),
            data: hourlyData.token.totalTokens,
            backgroundColor: 'rgba(59, 130, 246, 0.35)',
            borderColor: 'rgba(59, 130, 246, 0.45)',
            borderWidth: 1,
            borderRadius: 4,
            yAxisID: 'y',
          },
        ],
      };
    }

    return {
      labels,
      datasets: [
        {
          type: 'line' as const,
          label: t('monitor.hourly.success_rate'),
          data: hourlyData.model.successRates,
          borderColor: '#4ef0c3',
          backgroundColor: '#4ef0c3',
          borderWidth: 2.5,
          tension: 0.4,
          yAxisID: 'y1',
          pointRadius: 3,
          pointBackgroundColor: '#4ef0c3',
          pointBorderColor: '#4ef0c3',
        },
        ...hourlyData.model.models.map((modelName, index) => ({
          type: 'bar' as const,
          label: modelName,
          data: hourlyData.model.modelData[modelName],
          backgroundColor: MODEL_COLORS[index % MODEL_COLORS.length],
          borderColor: MODEL_COLORS[index % MODEL_COLORS.length],
          borderWidth: 1,
          borderRadius: 4,
          stack: 'models',
          yAxisID: 'y',
        })),
      ],
    };
  }, [hourlyData, labels, t, viewMode]);

  const chartOptions = useMemo(() => {
    const common = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index' as const,
        intersect: false,
      },
      plugins: {
        legend: {
          display: true,
          position: 'bottom' as const,
          labels: {
            color: isDark ? '#9ca3af' : '#6b7280',
            usePointStyle: true,
            padding: 10,
            boxWidth: 8,
            font: {
              size: 11,
            },
            generateLabels: (chart: any) =>
              chart.data.datasets
                .map((dataset: any, i: number) => {
                  const isLine = dataset.type === 'line';
                  if (!isLine && Array.isArray(dataset.data) && dataset.data.every((value: number) => value === 0)) {
                    return null;
                  }
                  return {
                    text: dataset.label,
                    fillStyle: dataset.backgroundColor,
                    strokeStyle: dataset.borderColor,
                    lineWidth: 0,
                    hidden: !chart.isDatasetVisible(i),
                    datasetIndex: i,
                    pointStyle: isLine ? 'circle' : 'rect',
                  };
                })
                .filter(Boolean),
          },
        },
        tooltip: {
          backgroundColor: isDark ? '#374151' : '#ffffff',
          titleColor: isDark ? '#f3f4f6' : '#111827',
          bodyColor: isDark ? '#d1d5db' : '#4b5563',
          borderColor: isDark ? '#4b5563' : '#e5e7eb',
          borderWidth: 1,
          padding: 12,
        },
      },
      scales: {
        x: {
          stacked: viewMode === 'model',
          grid: {
            color: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
          },
          ticks: {
            color: isDark ? '#9ca3af' : '#6b7280',
            font: {
              size: 11,
            },
          },
        },
      },
    };

    if (viewMode === 'cost') {
      return {
        ...common,
        plugins: {
          ...common.plugins,
          tooltip: {
            ...common.plugins.tooltip,
            callbacks: {
              label: (context: any) => {
                if (context.dataset.yAxisID === 'y') {
                  return `${context.dataset.label}: ${formatUsd(Number(context.raw) || 0)}`;
                }
                return `${context.dataset.label}: ${(Number(context.raw) || 0).toLocaleString()}`;
              },
            },
          },
        },
        scales: {
          ...common.scales,
          y: {
            position: 'left' as const,
            grid: {
              color: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
            },
            ticks: {
              color: isDark ? '#9ca3af' : '#6b7280',
              font: { size: 11 },
              callback: (value: string | number) => formatUsd(Number(value)),
            },
            title: {
              display: true,
              text: t('usage_stats.cost_axis_label'),
              color: isDark ? '#9ca3af' : '#6b7280',
              font: { size: 11 },
            },
          },
          y1: {
            position: 'right' as const,
            grid: { drawOnChartArea: false },
            ticks: {
              color: isDark ? '#9ca3af' : '#6b7280',
              font: { size: 11 },
            },
            title: {
              display: true,
              text: t('monitor.requests'),
              color: isDark ? '#9ca3af' : '#6b7280',
              font: { size: 11 },
            },
          },
        },
      };
    }

    if (viewMode === 'token') {
      return {
        ...common,
        plugins: {
          ...common.plugins,
          tooltip: {
            ...common.plugins.tooltip,
            callbacks: {
              label: (context: any) => {
                const label = context.dataset.label || '';
                return `${label}: ${(Number(context.raw) || 0).toFixed(1)}K`;
              },
            },
          },
        },
        scales: {
          ...common.scales,
          y: {
            position: 'left' as const,
            grid: {
              color: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
            },
            ticks: {
              color: isDark ? '#9ca3af' : '#6b7280',
              font: { size: 11 },
              callback: (value: string | number) => `${value}K`,
            },
            title: {
              display: true,
              text: 'Tokens (K)',
              color: isDark ? '#9ca3af' : '#6b7280',
              font: { size: 11 },
            },
          },
        },
      };
    }

    return {
      ...common,
      plugins: {
        ...common.plugins,
        tooltip: {
          ...common.plugins.tooltip,
          filter: (tooltipItem: any) => tooltipItem.raw !== 0,
          callbacks: {
            label: (context: any) => {
              if (context.dataset.yAxisID === 'y1') {
                return `${context.dataset.label}: ${(Number(context.raw) || 0).toFixed(1)}%`;
              }
              return `${context.dataset.label}: ${(Number(context.raw) || 0).toLocaleString()}`;
            },
          },
        },
      },
      scales: {
        ...common.scales,
        y: {
          stacked: true,
          position: 'left' as const,
          grid: {
            color: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
          },
          ticks: {
            color: isDark ? '#9ca3af' : '#6b7280',
            font: { size: 11 },
          },
          title: {
            display: true,
            text: t('monitor.hourly.requests'),
            color: isDark ? '#9ca3af' : '#6b7280',
            font: { size: 11 },
          },
        },
        y1: {
          position: 'right' as const,
          min: 0,
          max: 100,
          grid: { drawOnChartArea: false },
          ticks: {
            color: isDark ? '#9ca3af' : '#6b7280',
            font: { size: 11 },
            callback: (value: string | number) => `${value}%`,
          },
          title: {
            display: true,
            text: t('monitor.hourly.success_rate'),
            color: isDark ? '#9ca3af' : '#6b7280',
            font: { size: 11 },
          },
        },
      },
    };
  }, [isDark, t, viewMode]);

  const title =
    viewMode === 'cost'
      ? t('monitor.hourly_cost.title')
      : viewMode === 'model'
        ? t('monitor.hourly_model.title')
        : t('monitor.hourly_token.title');

  const badge =
    viewMode === 'cost'
      ? '$/h'
      : viewMode === 'model'
        ? 'req/h'
        : 'tok/h';

  const subtitle = useMemo(() => {
    if (viewMode === 'cost' && hasModelPrices && hourlyData.cost.totalCost > 0) {
      return `${hourRangeLabel} · ${formatUsd(hourlyData.cost.totalCost)}`;
    }
    return hourRangeLabel;
  }, [hasModelPrices, hourlyData.cost.totalCost, hourRangeLabel, viewMode]);

  const isEmpty =
    hourlyData.hours.length === 0 ||
    (viewMode === 'cost'
      ? hourlyData.cost.costs.every((cost) => cost <= 0)
      : viewMode === 'token'
        ? hourlyData.token.totalTokens.every((tokens) => tokens <= 0)
        : hourlyData.model.models.length === 0);

  const emptyMessage =
    viewMode === 'cost' && !hasModelPrices
      ? t('usage_stats.cost_need_price')
      : t('monitor.no_data');

  return (
    <div className={`${styles.chartCard} ${styles.chartCardCompact}`}>
      <div className={styles.chartHeader}>
        <div className={styles.chartHeaderMain}>
          <div className={styles.chartTitleRow}>
            <h3 className={styles.chartTitle}>{title}</h3>
            <span className={styles.chartBadge}>{badge}</span>
          </div>
          <p className={styles.chartSubtitle}>{subtitle}</p>
        </div>
        <div className={styles.chartControlStack}>
          <div className={styles.chartControls}>
            <button
              className={`${styles.chartControlBtn} ${viewMode === 'model' ? styles.active : ''}`}
              onClick={() => setViewMode('model')}
            >
              {t('monitor.hourly.mode_model')}
            </button>
            <button
              className={`${styles.chartControlBtn} ${viewMode === 'token' ? styles.active : ''}`}
              onClick={() => setViewMode('token')}
            >
              {t('monitor.hourly.mode_token')}
            </button>
            <button
              className={`${styles.chartControlBtn} ${viewMode === 'cost' ? styles.active : ''}`}
              onClick={() => setViewMode('cost')}
            >
              {t('monitor.hourly.mode_cost')}
            </button>
          </div>
          <div className={styles.chartControls}>
            <button
              className={`${styles.chartControlBtn} ${hourRange === 6 ? styles.active : ''}`}
              onClick={() => setHourRange(6)}
            >
              {t('monitor.hourly.last_6h')}
            </button>
            <button
              className={`${styles.chartControlBtn} ${hourRange === 12 ? styles.active : ''}`}
              onClick={() => setHourRange(12)}
            >
              {t('monitor.hourly.last_12h')}
            </button>
            <button
              className={`${styles.chartControlBtn} ${hourRange === 24 ? styles.active : ''}`}
              onClick={() => setHourRange(24)}
            >
              {t('monitor.hourly.last_24h')}
            </button>
          </div>
        </div>
      </div>

      <div className={`${styles.chartContent} ${styles.chartContentCompact}`}>
        {loading ? (
          <div className={styles.chartEmpty}>{t('common.loading')}</div>
        ) : viewMode === 'cost' && !hasModelPrices ? (
          <div className={styles.chartEmpty}>{emptyMessage}</div>
        ) : isEmpty ? (
          <div className={styles.chartEmpty}>{t('monitor.no_data')}</div>
        ) : (
          <Chart type="bar" data={chartData} options={chartOptions} />
        )}
      </div>
    </div>
  );
}
