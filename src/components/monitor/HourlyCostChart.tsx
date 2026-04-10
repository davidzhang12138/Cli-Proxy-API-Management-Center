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

export function HourlyCostChart({ data, loading, isDark }: HourlyCostChartProps) {
  const { t } = useTranslation();
  const [hourRange, setHourRange] = useState<HourRange>(12);
  const modelPrices = useMemo(() => loadModelPrices(), []);
  const hasModelPrices = Object.keys(modelPrices).length > 0;

  const hourlyData = useMemo(() => {
    if (!data?.apis || !hasModelPrices) {
      return { hours: [], costs: [], requestCounts: [], totalCost: 0 };
    }

    const { start: cutoffTime, end: currentHour, bucketCount } = getHourlyRangeBounds(hourRange);
    const allHours: string[] = [];

    for (let i = 0; i < bucketCount; i++) {
      const hourTime = new Date(cutoffTime.getTime() + i * 60 * 60 * 1000);
      allHours.push(formatLocalHourKey(hourTime));
    }

    const hourlyStats: Record<string, { cost: number; requests: number }> = {};
    allHours.forEach((hour) => {
      hourlyStats[hour] = { cost: 0, requests: 0 };
    });

    Object.values(data.apis).forEach((apiData) => {
      Object.entries(apiData.models).forEach(([modelName, modelData]) => {
        modelData.details.forEach((detail) => {
          if (detail.failed) return;

          const timestamp = new Date(detail.timestamp);
          timestamp.setMinutes(0, 0, 0);
          if (timestamp < cutoffTime || timestamp > currentHour) return;

          const hourKey = formatLocalHourKey(timestamp);
          hourlyStats[hourKey].requests += 1;
          hourlyStats[hourKey].cost += calculateCost(
            {
              ...detail,
              auth_index: Number(detail.auth_index) || 0,
              __modelName: modelName,
            },
            modelPrices
          );
        });
      });
    });

    const hours = allHours.sort();
    const costs = hours.map((hour) => hourlyStats[hour]?.cost || 0);
    const requestCounts = hours.map((hour) => hourlyStats[hour]?.requests || 0);

    return {
      hours,
      costs,
      requestCounts,
      totalCost: costs.reduce((sum, value) => sum + value, 0),
    };
  }, [data, hasModelPrices, hourRange, modelPrices]);

  const hourRangeLabel = useMemo(() => {
    if (hourRange === 6) return t('monitor.hourly.last_6h');
    if (hourRange === 12) return t('monitor.hourly.last_12h');
    return t('monitor.hourly.last_24h');
  }, [hourRange, t]);

  const chartData = useMemo(() => {
    const labels = hourlyData.hours.map((hour) => `${Number(hour.slice(11, 13))}:00`);

    return {
      labels,
      datasets: [
        {
          type: 'line' as const,
          label: t('usage_stats.total_cost'),
          data: hourlyData.costs,
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
          data: hourlyData.requestCounts,
          backgroundColor: 'rgba(59, 130, 246, 0.22)',
          borderColor: 'rgba(59, 130, 246, 0.35)',
          borderWidth: 1,
          borderRadius: 4,
          yAxisID: 'y1',
        },
      ],
    };
  }, [hourlyData, t]);

  const chartOptions = useMemo(() => ({
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
            chart.data.datasets.map((dataset: any, i: number) => ({
              text: dataset.label,
              fillStyle: dataset.backgroundColor,
              strokeStyle: dataset.borderColor,
              lineWidth: 0,
              hidden: !chart.isDatasetVisible(i),
              datasetIndex: i,
              pointStyle: dataset.type === 'line' ? 'circle' : 'rect',
            })),
        },
      },
      tooltip: {
        backgroundColor: isDark ? '#374151' : '#ffffff',
        titleColor: isDark ? '#f3f4f6' : '#111827',
        bodyColor: isDark ? '#d1d5db' : '#4b5563',
        borderColor: isDark ? '#4b5563' : '#e5e7eb',
        borderWidth: 1,
        padding: 12,
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
      x: {
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
      y: {
        position: 'left' as const,
        grid: {
          color: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
        },
        ticks: {
          color: isDark ? '#9ca3af' : '#6b7280',
          font: {
            size: 11,
          },
          callback: (value: string | number) => formatUsd(Number(value)),
        },
        title: {
          display: true,
          text: t('usage_stats.cost_axis_label'),
          color: isDark ? '#9ca3af' : '#6b7280',
          font: {
            size: 11,
          },
        },
      },
      y1: {
        position: 'right' as const,
        grid: {
          drawOnChartArea: false,
        },
        ticks: {
          color: isDark ? '#9ca3af' : '#6b7280',
          font: {
            size: 11,
          },
        },
        title: {
          display: true,
          text: t('monitor.hourly.requests'),
          color: isDark ? '#9ca3af' : '#6b7280',
          font: {
            size: 11,
          },
        },
      },
    },
  }), [isDark, t]);

  return (
    <div className={`${styles.chartCard} ${styles.chartCardCompact}`}>
      <div className={styles.chartHeader}>
        <div className={styles.chartHeaderMain}>
          <div className={styles.chartTitleRow}>
            <h3 className={styles.chartTitle}>{t('monitor.hourly_cost.title')}</h3>
            <span className={styles.chartBadge}>$/h</span>
          </div>
          <p className={styles.chartSubtitle}>
            {hourRangeLabel}
            {hasModelPrices && hourlyData.totalCost > 0 ? ` · ${formatUsd(hourlyData.totalCost)}` : ''}
          </p>
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

      <div className={`${styles.chartContent} ${styles.chartContentCompact}`}>
        {loading ? (
          <div className={styles.chartEmpty}>{t('common.loading')}</div>
        ) : !hasModelPrices ? (
          <div className={styles.chartEmpty}>{t('usage_stats.cost_need_price')}</div>
        ) : hourlyData.hours.length === 0 || hourlyData.costs.every((cost) => cost <= 0) ? (
          <div className={styles.chartEmpty}>{t('usage_stats.cost_no_data')}</div>
        ) : (
          <Chart type="line" data={chartData} options={chartOptions} />
        )}
      </div>
    </div>
  );
}
