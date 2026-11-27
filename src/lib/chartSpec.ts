/** What the chart renderer accepts. Used to draw charts, and to tell the model when one it wrote would come out empty. */
export const CHART_TYPES = ['bar', 'line', 'area', 'pie', 'scatter', 'bubble']

export const isPointChart = (type: unknown) => type === 'scatter' || type === 'bubble'

const isNumber = (v: unknown) => v !== null && v !== '' && Number.isFinite(Number(v))

/** The series to draw: the ones named, or every other column when none are. */
export function chartSeries(spec: any): { key: string; label?: string }[] {
  if (Array.isArray(spec.series) && spec.series.length) return spec.series
  const x = spec.xKey ?? 'name'
  return Object.keys(spec.data?.[0] ?? {}).filter((k) => k !== x && isNumber(spec.data[0][k])).map((key) => ({ key }))
}

/** Why a chart cannot be drawn, or null when it can. */
export function chartProblem(spec: any): string | null {
  const type = spec?.type ?? 'bar'
  if (!CHART_TYPES.includes(type)) return `"${type}" charts are not supported. Use one of: ${CHART_TYPES.join(', ')}.`
  const data = spec.data
  if (!Array.isArray(data) || !data.length) return 'It has no data.'
  const has = (k: unknown) => typeof k === 'string' && data.some((d: any) => isNumber(d?.[k]))
  if (isPointChart(type)) {
    const x = spec.xKey ?? 'x', y = spec.yKey ?? chartSeries(spec)[0]?.key
    if (!has(x)) return `No row has a number for the x value "${x}".`
    return has(y) ? null : `No row has a number for the y value "${y ?? 'yKey'}".`
  }
  const series = chartSeries(spec)
  return series.some((s) => has(s.key)) ? null : `No row has a number for ${series.map((s) => `"${s.key}"`).join(', ') || 'any series'}.`
}
