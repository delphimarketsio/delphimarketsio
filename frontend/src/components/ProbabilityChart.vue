<template>
  <div class="w-full h-64 relative bg-white rounded-lg p-2">
    <canvas ref="chartCanvas"></canvas>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import {
  Chart,
  LineController,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  type ChartConfiguration,
} from 'chart.js'

// Register Chart.js components
Chart.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  LineController,
)

interface ProbabilityDataPoint {
  timestamp: string
  yesPercentage: number
  noPercentage: number
}

const props = defineProps<{
  data: ProbabilityDataPoint[]
}>()

const chartCanvas = ref<HTMLCanvasElement>()
let chartInstance: Chart | null = null

const createChart = () => {
  if (!chartCanvas.value) return

  const textColor = '#374151'
  const gridColor = '#e5e7eb'

  const config: ChartConfiguration = {
    type: 'line',
    data: {
      labels: props.data.map((point) => {
        const date = new Date(point.timestamp)
        return date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      }),
      datasets: [
        {
          label: 'Yes',
          data: props.data.map((point) => point.yesPercentage),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          borderWidth: 3,
          fill: false,
          tension: 0.4,
          pointBackgroundColor: '#10b981',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointHoverBorderWidth: 3,
        },
        {
          label: 'No',
          data: props.data.map((point) => point.noPercentage),
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          borderWidth: 3,
          fill: false,
          tension: 0.4,
          pointBackgroundColor: '#ef4444',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointHoverBorderWidth: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index',
      },
      plugins: {
        title: {
          display: false,
        },
        legend: {
          display: true,
          position: 'top',
          labels: {
            usePointStyle: true,
            pointStyle: 'circle',
            color: textColor,
            font: {
              size: 12,
            },
            padding: 20,
          },
        },
        tooltip: {
          backgroundColor: '#ffffff',
          titleColor: textColor,
          bodyColor: textColor,
          borderColor: gridColor,
          borderWidth: 1,
          cornerRadius: 8,
          displayColors: true,
          titleFont: {
            size: 14,
            weight: 'bold',
          },
          bodyFont: {
            size: 13,
          },
          padding: 12,
          boxPadding: 6,
          callbacks: {
            title: (context) => {
              const index = context[0]?.dataIndex
              if (
                typeof index === 'number' &&
                index >= 0 &&
                index < props.data.length &&
                props.data[index]
              ) {
                const date = new Date(props.data[index].timestamp)
                return date.toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              }
              return ''
            },
            label: (context) => {
              return ` ${context.dataset.label}: ${context.parsed.y}%`
            },
            afterLabel: (context) => {
              // Add some context about the trend
              const index = context.dataIndex
              if (index > 0) {
                const current = context.parsed.y
                const previous = context.dataset.data[index - 1] as number
                const change = current - previous
                const trend = change > 0 ? '↗️' : change < 0 ? '↘️' : '➡️'
                const changeText =
                  change !== 0 ? `${change > 0 ? '+' : ''}${change.toFixed(1)}%` : 'No change'
                return `${trend} ${changeText} from previous`
              }
              return ''
            },
          },
        },
      },
      scales: {
        x: {
          display: true,
          title: {
            display: true,
            text: 'Time',
            color: textColor,
            font: {
              size: 12,
              weight: 'bold',
            },
          },
          ticks: {
            color: textColor,
            font: {
              size: 10,
            },
            maxTicksLimit: 6,
          },
          grid: {
            color: gridColor,
            drawOnChartArea: true,
            drawTicks: true,
          },
        },
        y: {
          display: true,
          min: 0,
          max: 100,
          title: {
            display: true,
            text: 'Market Sentiment (%)',
            color: textColor,
            font: {
              size: 12,
              weight: 'bold',
            },
          },
          ticks: {
            color: textColor,
            font: {
              size: 10,
            },
            callback: function (value) {
              return value + '%'
            },
          },
          grid: {
            color: gridColor,
            drawOnChartArea: true,
            drawTicks: true,
          },
        },
      },
      elements: {
        point: {
          hoverBackgroundColor: '#ffffff',
        },
      },
    },
  }

  chartInstance = new Chart(chartCanvas.value, config)
}

const destroyChart = () => {
  if (chartInstance) {
    chartInstance.destroy()
    chartInstance = null
  }
}

// Watch for data changes and recreate chart
watch(
  () => props.data,
  () => {
    destroyChart()
    createChart()
  },
  { deep: true },
)

onMounted(() => {
  createChart()
})

onUnmounted(() => {
  destroyChart()
})
</script>
