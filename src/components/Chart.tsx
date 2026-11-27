import { useMemo } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

const PALETTE = ['#10a37f', '#6366f1', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#ef4444', '#84cc16']

export function ChartView({ content }: { content: string }) {
  const spec = useMemo(() => { try { return { s: JSON.parse(content.replace(/^```json\s*|```$/g, '')) } } catch (e: any) { return { err: String(e.message) } } }, [content])
  if ('err' in spec) return <p className="p-6 text-sm text-danger">Invalid chart spec: {spec.err}</p>
  const { type = 'bar', data = [], xKey = 'name', series = [], title } = spec.s
  const ser: { key: string; label?: string }[] = series.length ? series : Object.keys(data[0] ?? {}).filter((k) => k !== xKey).map((key) => ({ key }))
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
          {type === 'pie' ? (
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
