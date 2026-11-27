import { useMemo } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ZAxis, LabelList, Scatter, ScatterChart } from 'recharts'
import { chartProblem, chartSeries, isPointChart } from '../lib/chartSpec'

const PALETTE = ['#10a37f', '#6366f1', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#ef4444', '#84cc16']

const short = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const num = (v: unknown) => (typeof v === 'number' ? v.toLocaleString() : String(v ?? ''))

/** Scatter and bubble charts: both axes are numbers, and a bubble's area shows a third one. */
function pointChart(spec: any, tick: object, tip: { contentStyle: object }) {
  const { data, xKey = 'x', sizeKey, labelKey, groupKey } = spec
  const ser = chartSeries(spec)
  const yKey: string = spec.yKey ?? ser[0]?.key
  const name = (k: string) => String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
  const groups: { label: string; rows: any[] }[] = groupKey
    ? [...new Set<string>(data.map((d: any) => String(d[groupKey])))].map((g) => ({ label: g, rows: data.filter((d: any) => String(d[groupKey]) === g) }))
    : [{ label: spec.series?.[0]?.label ?? name(yKey), rows: data }]
  return (
    <ScatterChart margin={{ top: 24, right: 28, bottom: 22, left: 8 }}>
      <CartesianGrid strokeDasharray="3 6" stroke="var(--line)" />
      <XAxis type="number" dataKey={xKey} name={name(xKey)} domain={['auto', 'auto']} tick={tick} tickLine={false} axisLine={false} tickFormatter={(v) => short.format(v)} label={{ value: name(xKey), position: 'insideBottom', offset: -14, ...tick }} />
      <YAxis type="number" dataKey={yKey} name={name(yKey)} domain={['auto', 'auto']} tick={tick} tickLine={false} axisLine={false} width={52} tickFormatter={(v) => short.format(v)} label={{ value: name(yKey), angle: -90, position: 'insideLeft', ...tick }} />
      {sizeKey && <ZAxis type="number" dataKey={sizeKey} name={name(sizeKey)} range={[80, 2400]} />}
      <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
        const d: any = active ? payload?.[0]?.payload : null
        if (!d) return null
        return (
          <div style={{ ...tip.contentStyle, padding: '8px 12px' }}>
            {labelKey && <div className="font-medium">{String(d[labelKey])}</div>}
            {[xKey, yKey, sizeKey].filter(Boolean).map((k) => <div key={k} className="text-muted">{name(k)}: <span className="text-fg">{num(d[k])}</span></div>)}
          </div>
        )
      }} />
      {groups.length > 1 && <Legend verticalAlign="top" wrapperStyle={{ fontSize: 12 }} />}
      {groups.map((g, i) => (
        <Scatter key={g.label} name={g.label} data={g.rows} fill={PALETTE[i % 8]} fillOpacity={0.65} stroke={PALETTE[i % 8]}>
          {labelKey && data.length <= 15 && <LabelList dataKey={labelKey} position="top" style={{ fill: 'var(--muted)', fontSize: 11 }} />}
        </Scatter>
      ))}
    </ScatterChart>
  )
}

export function ChartView({ content }: { content: string }) {
  const spec = useMemo(() => { try { return { s: JSON.parse(content.replace(/^```json\s*|```$/g, '')) } } catch (e: any) { return { err: String(e.message) } } }, [content])
  if ('err' in spec) return <p className="p-6 text-sm text-danger">Invalid chart spec: {spec.err}</p>
  const problem = chartProblem(spec.s)
  if (problem) return <p className="p-6 text-sm text-danger">Can't draw this chart. {problem}</p>
  const { type = 'bar', data, xKey = 'name', title } = spec.s
  const ser = chartSeries(spec.s)
  const tick = { fill: 'var(--muted)', fontSize: 12 }
  const tip = { contentStyle: { background: 'var(--glass-strong)', backdropFilter: 'blur(16px)', border: '1px solid var(--line)', borderRadius: 14, fontSize: 13 }, cursor: { fill: 'var(--accent-soft)' } }
  const axes = (<>
    <CartesianGrid strokeDasharray="3 6" stroke="var(--line)" vertical={false} />
    <XAxis dataKey={xKey} tick={tick} tickLine={false} axisLine={false} />
    <YAxis tick={tick} tickLine={false} axisLine={false} width={44} />
    <Tooltip {...tip} />
    {ser.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
  </>)
  return (
    <div className="flex h-full flex-col p-5">
      {title && <h3 className="mb-3 text-sm font-medium">{title}</h3>}
      <div className="min-h-[320px] flex-1">
        <ResponsiveContainer width="100%" height="100%">
          {isPointChart(type) ? (
            pointChart(spec.s, tick, tip)
          ) : type === 'pie' ? (
            <PieChart>
              <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Pie data={data} dataKey={ser[0]?.key} nameKey={xKey} innerRadius="55%" outerRadius="82%" paddingAngle={3} cornerRadius={6} stroke="none">
                {data.map((_: unknown, i: number) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
              </Pie>
            </PieChart>
          ) : type === 'line' ? (
            <LineChart data={data}>{axes}{ser.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label ?? s.key} stroke={PALETTE[i % 8]} strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />)}</LineChart>
          ) : type === 'area' ? (
            <AreaChart data={data}>
              <defs>{ser.map((s, i) => <linearGradient key={s.key} id={`g${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={PALETTE[i % 8]} stopOpacity={0.4} /><stop offset="100%" stopColor={PALETTE[i % 8]} stopOpacity={0} /></linearGradient>)}</defs>
              {axes}{ser.map((s, i) => <Area key={s.key} type="monotone" dataKey={s.key} name={s.label ?? s.key} stroke={PALETTE[i % 8]} strokeWidth={2.5} fill={`url(#g${i})`} />)}
            </AreaChart>
          ) : (
            <BarChart data={data}>{axes}{ser.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label ?? s.key} fill={PALETTE[i % 8]} radius={[8, 8, 0, 0]} />)}</BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}
