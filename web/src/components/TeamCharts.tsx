import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ACCENT, ACCENT_2, FONT_MONO, INK_MUTED, PAPER_2, RULE } from "../lib/tokens";

const axisStyle = { fontFamily: FONT_MONO, fontSize: 11, fill: INK_MUTED };

const tooltipStyle = {
  background: PAPER_2,
  border: `1px solid ${RULE}`,
  fontFamily: FONT_MONO,
  fontSize: "0.75rem",
};

export function ScoringChart({
  data,
}: {
  data: { week: number; points: number; avg: number | null }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke={RULE} vertical={false} strokeWidth={0.5} />
        <XAxis dataKey="week" tick={axisStyle} tickLine={false} axisLine={{ stroke: RULE }} />
        <YAxis tick={axisStyle} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={(w) => `Week ${w}`} />
        <Line type="monotone" dataKey="avg" name="league avg" stroke={ACCENT_2} strokeWidth={1.2}
          strokeDasharray="4 3" dot={false} />
        <Line type="monotone" dataKey="points" name="points" stroke={ACCENT} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function BenchChart({ data }: { data: { week: number; cumulative: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke={RULE} vertical={false} strokeWidth={0.5} />
        <XAxis dataKey="week" tick={axisStyle} tickLine={false} axisLine={{ stroke: RULE }} />
        <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={(w) => `Through week ${w}`} />
        <Area type="monotone" dataKey="cumulative" name="points benched" stroke={ACCENT}
          fill={ACCENT} fillOpacity={0.12} strokeWidth={1.6} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CoachChart({ data }: { data: { week: number; rating: number | null }[] }) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
        <CartesianGrid stroke={RULE} vertical={false} strokeWidth={0.5} />
        <XAxis dataKey="week" tick={axisStyle} tickLine={false} axisLine={{ stroke: RULE }} />
        <YAxis
          tick={axisStyle}
          tickLine={false}
          axisLine={false}
          domain={[0.5, 1]}
          tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelFormatter={(w) => `Week ${w}`}
          formatter={(v) => [`${((v as number) * 100).toFixed(1)}%`, "coach rating"]}
        />
        <Line type="monotone" dataKey="rating" stroke={ACCENT_2} strokeWidth={2} dot={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}
