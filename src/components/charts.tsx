"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

const COLORS = ["#3b6bea", "#ef6a73", "#f2b84b", "#f28b31", "#68769a", "#5bb58b", "#a9a0a9", "#9b7fd4"];

function euroFmt(v: number) {
  return v.toLocaleString("pt-PT", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " €";
}

export function MonthBarChart({
  data,
  onClickMonth,
}: {
  data: { label: string; month: string; total: number }[];
  onClickMonth?: (month: string) => void;
}) {
  return (
    <ResponsiveContainer width="100%" height={235}>
      <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#71809a" }} axisLine={false} tickLine={false} />
        <YAxis hide />
        <Tooltip
          formatter={(v) => euroFmt(Number(v))}
          labelFormatter={(l) => `${l} 2026`}
          contentStyle={{ borderRadius: 10, border: "1px solid #e5eaf2", fontSize: 12 }}
        />
        <Bar
          dataKey="total"
          radius={[6, 6, 0, 0]}
          fill="#3b6bea"
          cursor="pointer"
          onClick={(d) => onClickMonth?.((d as unknown as { month: string }).month)}
          maxBarSize={38}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CategoryDonutChart({
  data,
}: {
  data: { name: string; value: number }[];
}) {
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="flex items-center gap-5 min-h-[235px]">
      <ResponsiveContainer width={200} height={200}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={90}
            dataKey="value"
            paddingAngle={1}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      <div className="flex flex-1 flex-col gap-2">
        <div className="mb-1 text-center text-[18px] font-[800]">{euroFmt(total)}</div>
        {data.map((d, i) => (
          <div key={d.name} className="grid grid-cols-[9px_1fr_auto] items-center gap-2 text-[11px]">
            <span className="h-[9px] w-[9px] rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="truncate">{d.name}</span>
            <span className="whitespace-nowrap font-[750]">{euroFmt(d.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BreakfastBars({
  data,
}: {
  data: { name: string; value: number }[];
}) {
  const max = Math.max(...data.map(d => d.value), 1);

  return (
    <div className="flex flex-col gap-2">
      {data.map(d => (
        <div key={d.name} className="grid grid-cols-[125px_1fr_auto] items-center gap-2 text-[11px]">
          <span className="truncate font-[620]">{d.name}</span>
          <div className="h-[8px] overflow-hidden rounded-full bg-[#edf1f7]">
            <div className="h-full rounded-full bg-[#5e83f4]" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
          <strong className="whitespace-nowrap text-[10px]">{euroFmt(d.value)}</strong>
        </div>
      ))}
    </div>
  );
}
