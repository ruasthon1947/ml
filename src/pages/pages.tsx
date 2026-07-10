import React, { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import {
  CaseRecord,
  FirRecord,
  caseRoute,
  countWhere,
  csvEscape,
  findCase,
  optionList,
  searchText,
  splitNames,
  toFirRecord,
  useFirRecords,
} from "../lib/cases";

type FIR = {
  id: string;
  fir: string;
  category: string;
  station: string;
  io: string;
  status: string;
  gravity: string;
  date: string;
  complainant: string;
  accused: string;
  phone: string;
  vehicle: string;
  section: string;
};

export const FIR_RECORDS: FIR[] = [
  {
    id: "CR-041/2026",
    fir: "104430041202600041",
    category: "Cyber Crime",
    station: "Whitefield PS",
    io: "S. Parvathi",
    status: "Under Investigation",
    gravity: "Heinous",
    date: "2026-07-08",
    complainant: "Ananya Rao",
    accused: "Unknown",
    phone: "9876543210",
    vehicle: "—",
    section: "BNS 318(4)",
  },
  {
    id: "CR-038/2026",
    fir: "104430006202600038",
    category: "Theft",
    station: "Indiranagar PS",
    io: "R. Krishnamurthy",
    status: "Charge-Sheeted",
    gravity: "Non-Heinous",
    date: "2026-07-07",
    complainant: "Ravi Kumar",
    accused: "Manoj K",
    phone: "9845011223",
    vehicle: "KA-03-MN-4421",
    section: "BNS 303",
  },
  {
    id: "CR-032/2026",
    fir: "104430041202600032",
    category: "Offences Against Body",
    station: "MG Road PS",
    io: "K. Srinivas",
    status: "Under Investigation",
    gravity: "Heinous",
    date: "2026-07-05",
    complainant: "Nisha S",
    accused: "Arun P",
    phone: "9900123456",
    vehicle: "—",
    section: "BNS 109",
  },
  {
    id: "CR-027/2026",
    fir: "104430011202600027",
    category: "Motor Vehicle Accident",
    station: "Yelahanka PS",
    io: "Rekha M",
    status: "Registered",
    gravity: "Non-Heinous",
    date: "2026-07-03",
    complainant: "Deepak H",
    accused: "Driver unknown",
    phone: "9988776655",
    vehicle: "KA-50-AB-9090",
    section: "BNS 281",
  },
  {
    id: "CR-019/2026",
    fir: "104430020202600019",
    category: "Narcotics",
    station: "Cubbon Park PS",
    io: "Anand Rao",
    status: "Undetected",
    gravity: "Heinous",
    date: "2026-06-29",
    complainant: "State",
    accused: "Unknown",
    phone: "—",
    vehicle: "—",
    section: "NDPS 20(b)",
  },
  {
    id: "CR-014/2026",
    fir: "104430006202600014",
    category: "Theft",
    station: "Indiranagar PS",
    io: "S. Parvathi",
    status: "Closed",
    gravity: "Non-Heinous",
    date: "2026-06-25",
    complainant: "Meera N",
    accused: "Vijay R",
    phone: "9880010101",
    vehicle: "KA-01-HH-1222",
    section: "BNS 303",
  },
];

const useT = () => useLanguage().tr;

const Card: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = "" }) => (
  <div
    className={`bg-shell border border-line rounded-xl ${className}`}
  >
    {children}
  </div>
);

const textValue = (value: unknown) => String(value || "").trim();

const uniqueText = (values: string[], fallback = "-") => {
  const unique = Array.from(new Set(values.map(textValue).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
  return unique.length ? unique.join(", ") : fallback;
};

const countByValue = (
  records: FirRecord[],
  field: keyof CaseRecord,
  split = false
) => {
  const counts = new Map<string, number>();
  records.forEach((record) => {
    const values = split ? splitNames(record.raw[field]) : [textValue(record.raw[field])];
    values.filter(Boolean).forEach((value) => {
      counts.set(value, (counts.get(value) || 0) + 1);
    });
  });
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};

const groupByKey = (
  records: FirRecord[],
  keyFn: (record: FirRecord) => string
) => {
  const groups = new Map<string, FirRecord[]>();
  records.forEach((record) => {
    const key = textValue(keyFn(record));
    if (!key) return;
    groups.set(key, [...(groups.get(key) || []), record]);
  });
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
};

const ReferenceHeader: React.FC<{
  title: string;
  description: string;
  loading: boolean;
  error: string;
  count: number;
}> = ({ title, description, loading, error, count }) => (
  <div>
    <h1 className="text-xl font-semibold">{title}</h1>
    <p className="text-sm text-muted mt-1">{description}</p>
    <div className="mt-3 flex flex-wrap gap-2 text-xs">
      <span className="rounded-full border border-line bg-shell px-3 py-1 text-muted">
        Source: local_db/Consolidated_Cases
      </span>
      <span className="rounded-full border border-line bg-shell px-3 py-1 text-muted">
        {loading ? "Loading..." : `${count.toLocaleString("en-IN")} records loaded`}
      </span>
      {error && (
        <span className="rounded-full border border-rose/30 bg-rose/10 px-3 py-1 text-rose">
          {error}
        </span>
      )}
    </div>
  </div>
);

const ReferenceStat: React.FC<{
  label: string;
  value: number | string;
  helper?: string;
}> = ({ label, value, helper }) => (
  <Card className="p-4">
    <div className="text-xs text-muted">{label}</div>
    <div className="mt-2 text-2xl font-semibold">{value}</div>
    {helper && <div className="text-[11px] text-muted mt-1">{helper}</div>}
  </Card>
);

const ReferenceTable: React.FC<{
  columns: string[];
  rows: Array<Array<React.ReactNode>>;
  emptyText?: string;
}> = ({ columns, rows, emptyText = "No reference data found." }) => (
  <Card className="overflow-hidden">
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[10px] uppercase text-muted">
            {columns.map((column) => (
              <th key={column} className="px-4 py-3 font-semibold">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-line last:border-0">
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`} className="px-4 py-3 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-muted">
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </Card>
);

const ReferenceListCard: React.FC<{
  title: string;
  values: Array<{ name: string; count: number }>;
}> = ({ title, values }) => (
  <Card className="p-4">
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-xs text-muted">{values.length} values</div>
    </div>
    <div className="mt-4 max-h-72 overflow-auto space-y-2 pr-1">
      {values.map((item) => (
        <div
          key={item.name}
          className="flex items-start justify-between gap-4 rounded-lg border border-line bg-panel/40 px-3 py-2"
        >
          <span className="text-sm">{item.name}</span>
          <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
            {item.count}
          </span>
        </div>
      ))}
      {values.length === 0 && <div className="text-sm text-muted">No values found.</div>}
    </div>
  </Card>
);

/* =========================================================
   CHART TOOLTIP
   Works in light and dark mode
========================================================= */

const ChartTooltip = ({
  active,
  payload,
  label,
}: any) => {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  return (
    <div className="bg-shell border border-line rounded-xl px-4 py-3 shadow-xl text-white">
      {label !== undefined && label !== null && (
        <div className="text-sm font-semibold text-white mb-2">
          {label}
        </div>
      )}

      <div className="space-y-1.5">
        {payload.map((item: any, index: number) => (
          <div
            key={`${item.dataKey || item.name}-${index}`}
            className="flex items-center justify-between gap-6 text-sm"
          >
            <span className="text-muted capitalize">
              {item.name || item.dataKey}
            </span>

            <span className="font-semibold text-white num">
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

/* =========================================================
   DASHBOARD
========================================================= */

export const Dashboard: React.FC = () => {
  const t = useT();
  const nav = useNavigate();
  const { user } = useAuth();
  const { records, loading, error } = useFirRecords();
  const totalCases = records.length;
  const underInvestigation = countWhere(records, (r) => r.status === "Under Investigation");
  const chargeSheetsDue = countWhere(
    records,
    (r) => (r.raw.ChargesheetStatus || "Pending") !== "Filed" && r.status !== "Disposed by Court",
  );
  const highGravity = countWhere(records, (r) => r.gravity === "Heinous");
  const closedStatuses = ["Charge Sheeted", "Disposed by Court", "Closed - False Case"];
  const employeeTail = user?.employeeId?.split("-").pop() || "";
  const assignedRecords = records.filter(
    (r) =>
      (employeeTail && r.raw.EmployeeID === employeeTail) ||
      (user?.name && r.io === user.name),
  );
  const myActiveCases = assignedRecords.filter((r) => r.status === "Under Investigation").length;
  const disposedCases = countWhere(records, (r) => closedStatuses.includes(r.status));
  const disposalRate = totalCases ? Math.round((disposedCases / totalCases) * 1000) / 10 : 0;
  const avgInvestigationDays = (() => {
    const durations = records
      .map((record) => {
        const start = new Date(record.date);
        const end = new Date(record.raw.LatestChargesheetDate || new Date().toISOString().slice(0, 10));
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
        return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
      })
      .filter((value): value is number => value !== null);
    if (!durations.length) return 0;
    return Math.round((durations.reduce((sum, value) => sum + value, 0) / durations.length) * 10) / 10;
  })();

  const metrics = [
    [
      t("Total FIRs", "ಒಟ್ಟು ಎಫ್‌ಐಆರ್‌ಗಳು"),
      loading ? "..." : totalCases.toLocaleString("en-IN"),
      String(totalCases),
      t("vs yesterday", "ನಿನ್ನೆಗಿಂತ"),
      "",
    ],
    [
      t("Under Investigation", "ತನಿಖೆಯಲ್ಲಿರುವ ಪ್ರಕರಣಗಳು"),
      loading ? "..." : underInvestigation.toLocaleString("en-IN"),
      String(underInvestigation),
      t("updated today", "ಇಂದು ನವೀಕರಿಸಲಾಗಿದೆ"),
      "status=Under Investigation",
    ],
    [
      t("Charge sheets due", "ಚಾರ್ಜ್‌ಶೀಟ್ ಬಾಕಿ"),
      loading ? "..." : chargeSheetsDue.toLocaleString("en-IN"),
      String(chargeSheetsDue),
      t("days ahead", "ಮುಂದಿನ ದಿನಗಳು"),
      "",
    ],
    [
      t("High gravity", "ಗಂಭೀರ ಪ್ರಕರಣಗಳು"),
      loading ? "..." : highGravity.toLocaleString("en-IN"),
      String(highGravity),
      t("new this week", "ಈ ವಾರ ಹೊಸದು"),
      "gravity=Heinous",
    ],
  ];

  const activity = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() - (6 - index));
        const iso = date.toISOString().slice(0, 10);
        const dayRecords = records.filter((record) => record.date === iso);
        return {
          day: date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
          fir: dayRecords.length,
          solved: dayRecords.filter((record) => closedStatuses.includes(record.status)).length,
        };
      }),
    [records],
  );

  const attention = [
    [
      "CR-041/2026",
      t(
        "Investigation update overdue",
        "ತನಿಖಾ ನವೀಕರಣ ಬಾಕಿ"
      ),
      t("3 days overdue", "3 ದಿನ ಬಾಕಿ"),
    ],
    [
      "CR-032/2026",
      t(
        "Supervisor review requested",
        "ಮೇಲ್ವಿಚಾರಕರ ಪರಿಶೀಲನೆ ಅಗತ್ಯ"
      ),
      t("Priority", "ಆದ್ಯತೆ"),
    ],
    [
      "CR-027/2026",
      t(
        "Charge sheet deadline",
        "ಚಾರ್ಜ್‌ಶೀಟ್ ಗಡುವು"
      ),
      t("Due in 2 days", "2 ದಿನಗಳಲ್ಲಿ ಗಡುವು"),
    ],
  ];
  const liveAttention = records
    .filter((record) => record.status === "Under Investigation" || record.gravity === "Heinous")
    .slice(0, 3)
    .map((record) => [
      caseRoute(record.raw),
      record.label,
      record.status || record.gravity || record.category,
    ]);
  const attentionRows = liveAttention.length ? liveAttention : attention;
  const metricFooters = [
    "loaded from Consolidated_Cases",
    "currently under investigation",
    "without filed chargesheet",
    "marked heinous",
  ];
  const dashboardSubtitles = [
    `${assignedRecords.length} assigned to current login`,
    `${disposedCases} disposed / charge-sheeted`,
    "days from registration to latest case state",
  ];

  return (
    <div className="p-5 md:p-6 space-y-5 max-w-[1500px] mx-auto w-full">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {metrics.map((m, i) => (
          <button
            key={String(m[0])}
            onClick={() =>
              nav(`/fir${m[4] ? `?${m[4]}` : ""}`)
            }
            className="group text-left bg-shell border border-line rounded-xl p-4 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-soft transition"
          >
            <div className="flex justify-between items-start">
              <div className="text-[11px] text-muted uppercase tracking-wide">
                {m[0]}
              </div>

              <div className="h-8 w-8 rounded-lg bg-brand/10 text-brand grid place-items-center text-xs font-bold">
                {i + 1}
              </div>
            </div>

            <div className="text-3xl font-semibold mt-3 num">
              {m[1]}
            </div>

            <div className="text-[11px] text-muted mt-1">
              {metricFooters[i]}
            </div>
          </button>
        ))}
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,.75fr)] gap-4">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">
                {t(
                  "FIR activity",
                  "ಎಫ್‌ಐಆರ್ ಚಟುವಟಿಕೆ"
                )}
              </div>

              <div className="text-xs text-muted mt-1">
                {t(
                  "Registered vs solved · last 7 days",
                  "ನೋಂದಾಯಿತ ಮತ್ತು ಪರಿಹರಿಸಿದ · ಕಳೆದ 7 ದಿನಗಳು"
                )}
              </div>
            </div>

            <div className="flex gap-4 text-[11px] text-muted">
              <span>
                ● {t("Registered", "ನೋಂದಾಯಿತ")}
              </span>

              <span>
                ◌ {t("Solved", "ಪರಿಹರಿಸಲಾಗಿದೆ")}
              </span>
            </div>
          </div>

          <div className="h-[310px] mt-5">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={activity}>
                <CartesianGrid strokeDasharray="3 3" />

                <XAxis
                  dataKey="day"
                  fontSize={11}
                />

                <YAxis fontSize={11} />

                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--shell)",
                    border: "1px solid var(--line)",
                    borderRadius: "10px",
                    color: "var(--text)",
                  }}
                  labelStyle={{
                    color: "var(--text)",
                  }}
                  itemStyle={{
                    color: "var(--text)",
                  }}
                />

                <Line
                  type="monotone"
                  dataKey="fir"
                  stroke="currentColor"
                  strokeWidth={3}
                  dot={{
                    r: 4,
                    fill: "currentColor",
                  }}
                />

                <Line
                  type="monotone"
                  dataKey="solved"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeDasharray="6 5"
                  dot={{
                    r: 3,
                    fill: "currentColor",
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <div>
            <div className="font-semibold">
              {t(
                "Needs attention",
                "ಗಮನ ಅಗತ್ಯ"
              )}
            </div>

            <div className="text-xs text-muted mt-1">
              {t(
                "Cases requiring officer action",
                "ಅಧಿಕಾರಿಯ ಕ್ರಮ ಅಗತ್ಯವಿರುವ ಪ್ರಕರಣಗಳು"
              )}
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {attentionRows.map((x) => (
              <button
                key={x[0]}
                onClick={() => nav(`/fir/${x[0]}`)}
                className="w-full text-left border border-line rounded-lg p-3 hover:border-brand/40 hover:bg-panel transition"
              >
                <div className="flex justify-between gap-3">
                  <div>
                    <div className="text-xs text-brand font-semibold">
                      {x[0]}
                    </div>

                    <div className="text-sm font-medium mt-1">
                      {x[1]}
                    </div>
                  </div>

                  <span className="text-[10px] text-brand">
                    {x[2]}
                  </span>
                </div>
              </button>
            ))}
          </div>

          <button
            onClick={() => nav("/fir")}
            className="w-full mt-3 h-9 rounded-lg border border-line text-xs font-semibold hover:border-brand/40 transition"
          >
            {t(
              "View all cases",
              "ಎಲ್ಲ ಪ್ರಕರಣಗಳನ್ನು ನೋಡಿ"
            )}{" "}
            →
          </button>
        </Card>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        {[
          [
            t(
              "My active cases",
              "ನನ್ನ ಸಕ್ರಿಯ ಪ್ರಕರಣಗಳು"
            ),
            loading ? "..." : String(myActiveCases),
            t(
              "4 need an update today",
              "4 ಪ್ರಕರಣಗಳಿಗೆ ಇಂದು ನವೀಕರಣ ಅಗತ್ಯ"
            ),
          ],
          [
            t(
              "City disposal rate",
              "ನಗರ ವಿಲೇವಾರಿ ದರ"
            ),
            loading ? "..." : `${disposalRate}%`,
            t(
              "Up 3.1% this month",
              "ಈ ತಿಂಗಳು 3.1% ಹೆಚ್ಚಳ"
            ),
          ],
          [
            t(
              "Average investigation",
              "ಸರಾಸರಿ ತನಿಖೆ"
            ),
            loading ? "..." : String(avgInvestigationDays),
            t(
              "days · target below 21",
              "ದಿನಗಳು · ಗುರಿ 21 ಕ್ಕಿಂತ ಕಡಿಮೆ"
            ),
          ],
        ].map((x, index) => (
          <Card
            key={String(x[0])}
            className="p-4"
          >
            <div className="text-xs text-muted">
              {x[0]}
            </div>

            <div className="text-2xl font-semibold mt-2">
              {x[1]}
            </div>

            <div className="text-[11px] text-muted mt-1">
              {dashboardSubtitles[index] ?? x[2]}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};

/* =========================================================
   FIR LIST
========================================================= */

export const FIRList: React.FC = () => {
  const t = useT();
  const nav = useNavigate();
  const { records, loading, error } = useFirRecords();

  return (
    <div className="p-5">
      <Card className="p-5">
        <div className="flex justify-between">
          <div>
            <h1 className="text-lg font-semibold">
              {t(
                "FIR Records",
                "ಎಫ್‌ಐಆರ್ ದಾಖಲೆಗಳು"
              )}
            </h1>

            <p className="text-sm text-muted mt-1">
              {t(
                "Open a case to view the complete file and timeline.",
                "ಸಂಪೂರ್ಣ ಪ್ರಕರಣ ಮತ್ತು ಕಾಲರೇಖೆ ನೋಡಲು ಪ್ರಕರಣ ತೆರೆಯಿರಿ."
              )}
            </p>
          </div>

          <button
            onClick={() => nav("/fir/new")}
            className="bg-brand rounded-lg px-4 h-9 text-sm"
          >
            +{" "}
            {t(
              "Register FIR",
              "ಎಫ್‌ಐಆರ್ ನೋಂದಣಿ"
            )}
          </button>
        </div>

        <div className="overflow-x-auto mt-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[10px] uppercase text-muted">
                <th className="py-3">
                  {t("Case", "ಪ್ರಕರಣ")}
                </th>

                <th>
                  {t("Category", "ವರ್ಗ")}
                </th>

                <th>
                  {t("Station", "ಠಾಣೆ")}
                </th>

                <th>IO</th>

                <th>
                  {t("Registered", "ನೋಂದಣಿ")}
                </th>

                <th>
                  {t("Status", "ಸ್ಥಿತಿ")}
                </th>

                <th />
              </tr>
            </thead>

            <tbody>
              {records.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => nav(`/fir/${caseRoute(r.raw)}`)}
                  className="border-b border-line hover:bg-panel cursor-pointer"
                >
                  <td className="py-3">
                    <div className="font-semibold text-brand">
                      {r.label}
                    </div>

                    <div className="text-[10px] text-muted num">
                      {r.fir}
                    </div>
                  </td>

                  <td>{r.category}</td>
                  <td>{r.station}</td>
                  <td>{r.io}</td>
                  <td>{r.date}</td>

                  <td>
                    <span className="text-xs border border-line rounded-full px-2 py-1">
                      {r.status}
                    </span>
                  </td>

                  <td className="text-brand">
                    {t("Open", "ತೆರೆಯಿರಿ")} ›
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

/* =========================================================
   FIR DETAIL
========================================================= */

export const FIRDetail: React.FC = () => {
  const t = useT();
  const { id } = useParams();
  const nav = useNavigate();
  const { cases, loading, error } = useFirRecords();

  const matchedCase = findCase(cases, id) || cases[0];
  const r = matchedCase ? toFirRecord(matchedCase) : undefined;

  if (loading) {
    return <div className="p-5 text-sm text-muted">Loading case from local_db...</div>;
  }

  if (error) {
    return <div className="p-5 text-sm text-rose">{error}</div>;
  }

  if (!r) {
    return <div className="p-5 text-sm text-muted">Case not found in Consolidated_Cases.csv.</div>;
  }

  const timeline = [
    [
      t(
        "FIR Registered",
        "ಎಫ್‌ಐಆರ್ ನೋಂದಾಯಿಸಲಾಗಿದೆ"
      ),
      "08 Jul 2026 · 09:12",
      t(
        "Registered by Officer 10427",
        "ಅಧಿಕಾರಿ 10427ರಿಂದ ನೋಂದಣಿ"
      ),
    ],
    [
      t(
        "IO Assigned",
        "ತನಿಖಾಧಿಕಾರಿ ನಿಯೋಜನೆ"
      ),
      "08 Jul 2026 · 09:30",
      r.io,
    ],
    [
      t(
        "Statement Added",
        "ಹೇಳಿಕೆ ಸೇರಿಸಲಾಗಿದೆ"
      ),
      "08 Jul 2026 · 11:45",
      t(
        "Complainant statement recorded",
        "ದೂರುದಾರರ ಹೇಳಿಕೆ ದಾಖಲಿಸಲಾಗಿದೆ"
      ),
    ],
    [
      t(
        "Evidence Uploaded",
        "ಸಾಕ್ಷ್ಯ ಅಪ್‌ಲೋಡ್"
      ),
      "08 Jul 2026 · 14:20",
      t(
        "2 digital evidence files",
        "2 ಡಿಜಿಟಲ್ ಸಾಕ್ಷ್ಯ ಕಡತಗಳು"
      ),
    ],
    [
      t(
        "Investigation Note",
        "ತನಿಖಾ ಟಿಪ್ಪಣಿ"
      ),
      "09 Jul 2026 · 10:05",
      t(
        "Preliminary review completed",
        "ಪ್ರಾಥಮಿಕ ಪರಿಶೀಲನೆ ಪೂರ್ಣ"
      ),
    ],
  ];

  return (
    <div className="p-5 space-y-4">
      <div>
        <div className="text-xs text-brand">
          {r.label}
        </div>

        <h1 className="text-xl font-semibold mt-1">
          {r.category}
        </h1>

        <p className="text-sm text-muted">
          {r.station} · {r.status}
        </p>
      </div>

      <button
        onClick={() => nav(`/fir/${caseRoute(r.raw)}/edit`)}
        className="h-9 px-3 rounded-lg bg-brand text-white text-xs font-semibold"
      >
        Edit
      </button>

      <div className="grid xl:grid-cols-[1fr_420px] gap-4">
        <Card className="p-5">
          <div className="font-semibold">
            {t(
              "Case summary",
              "ಪ್ರಕರಣ ಸಾರಾಂಶ"
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
            {[
              [
                t(
                  "FIR number",
                  "ಎಫ್‌ಐಆರ್ ಸಂಖ್ಯೆ"
                ),
                r.fir,
              ],
              [
                t(
                  "Investigating officer",
                  "ತನಿಖಾಧಿಕಾರಿ"
                ),
                r.io,
              ],
              [
                t(
                  "Complainant",
                  "ದೂರುದಾರ"
                ),
                r.complainant,
              ],
              [
                t("Accused", "ಆರೋಪಿ"),
                r.accused,
              ],
              [
                t("Section", "ಸೆಕ್ಷನ್"),
                r.section,
              ],
              [
                t("Gravity", "ಗಂಭೀರತೆ"),
                r.gravity,
              ],
            ].map((x) => (
              <div key={x[0]}>
                <div className="text-[11px] text-muted uppercase">
                  {x[0]}
                </div>

                <div className="mt-1">
                  {x[1]}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="font-semibold">
            {t(
              "Case timeline",
              "ಪ್ರಕರಣ ಕಾಲರೇಖೆ"
            )}
          </div>

          <div className="mt-5">
            {timeline.map((x, i) => (
              <div
                className="relative pl-7 pb-5"
                key={x[0]}
              >
                <span className="absolute left-0 top-1 h-3 w-3 rounded-full bg-brand border-2 border-shell" />

                {i < timeline.length - 1 && (
                  <span className="absolute left-[5px] top-4 bottom-0 w-px bg-line" />
                )}

                <div className="text-sm font-medium">
                  {x[0]}
                </div>

                <div className="text-[11px] text-muted mt-1">
                  {x[1]}
                </div>

                <div className="text-xs text-muted mt-1">
                  {x[2]}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};

/* =========================================================
   ADVANCED SEARCH
========================================================= */

export const AdvancedSearch: React.FC = () => {
  const t = useT();

  const [q, setQ] = useState("");
  const [station, setStation] = useState("");
  const [status, setStatus] = useState("");

  const [saved, setSaved] = useState<string[]>(() =>
    JSON.parse(
      localStorage.getItem("kpfir.savedSearches") ||
        "[]"
    )
  );

  const [recent, setRecent] = useState<string[]>(() =>
    JSON.parse(
      localStorage.getItem("kpfir.recentSearches") ||
        "[]"
    )
  );

  const nav = useNavigate();
  const { records, options, loading, error } = useFirRecords();

  const results = useMemo(
    () =>
      records.filter((r) => {
        const hay = searchText(r);

        return (
          (!q ||
            hay.includes(q.toLowerCase())) &&
          (!station || r.station === station) &&
          (!status || r.status === status)
        );
      }),
    [q, records, station, status]
  );

  const run = () => {
    if (!q) return;

    const n = [
      q,
      ...recent.filter((x) => x !== q),
    ].slice(0, 5);

    setRecent(n);

    localStorage.setItem(
      "kpfir.recentSearches",
      JSON.stringify(n)
    );
  };

  const save = () => {
    const name =
      q || `${station} ${status}`.trim();

    if (!name) return;

    const n = [
      name,
      ...saved.filter((x) => x !== name),
    ].slice(0, 6);

    setSaved(n);

    localStorage.setItem(
      "kpfir.savedSearches",
      JSON.stringify(n)
    );
  };

  return (
    <div className="p-5 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">
          {t(
            "Advanced Search",
            "ಸುಧಾರಿತ ಹುಡುಕಾಟ"
          )}
        </h1>

        <p className="text-sm text-muted mt-1">
          {t(
            "Search across FIR number, names, phone, vehicle, section, station and IO.",
            "ಎಫ್‌ಐಆರ್ ಸಂಖ್ಯೆ, ಹೆಸರು, ಫೋನ್, ವಾಹನ, ಸೆಕ್ಷನ್, ಠಾಣೆ ಮತ್ತು ತನಿಖಾಧಿಕಾರಿ ಮೂಲಕ ಹುಡುಕಿ."
          )}
        </p>
      </div>

      <Card className="p-4">
        <div className="grid lg:grid-cols-[1fr_220px_220px_auto] gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && run()
            }
            placeholder={t(
              "Crime no, name, phone, vehicle, section...",
              "ಪ್ರಕರಣ ಸಂಖ್ಯೆ, ಹೆಸರು, ಫೋನ್, ವಾಹನ, ಸೆಕ್ಷನ್..."
            )}
            className="h-10 bg-panel border border-line rounded-lg px-3 text-sm outline-none focus:border-brand"
          />

          <select
            value={station}
            onChange={(e) =>
              setStation(e.target.value)
            }
            className="h-10 bg-panel border border-line rounded-lg px-3 text-sm"
          >
            <option value="">
              {t("All stations", "ಎಲ್ಲ ಠಾಣೆಗಳು")}
            </option>

            {optionList(options, "PoliceStation").map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>

          <select
            value={status}
            onChange={(e) =>
              setStatus(e.target.value)
            }
            className="h-10 bg-panel border border-line rounded-lg px-3 text-sm"
          >
            <option value="">
              {t("All statuses", "ಎಲ್ಲ ಸ್ಥಿತಿಗಳು")}
            </option>

            {optionList(options, "Status").map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>

          <button
            onClick={run}
            className="h-10 px-4 bg-brand rounded-lg text-sm font-semibold"
          >
            {t("Search", "ಹುಡುಕಿ")}
          </button>
        </div>

        <div className="flex gap-3 mt-3">
          <button
            onClick={save}
            className="h-9 px-3 border border-line rounded-lg text-xs"
          >
            ☆{" "}
            {t(
              "Save search",
              "ಹುಡುಕಾಟ ಉಳಿಸಿ"
            )}
          </button>

          <span className="text-xs text-muted self-center">
            {results.length}{" "}
            {t(
              "matching cases",
              "ಹೊಂದುವ ಪ್ರಕರಣಗಳು"
            )}
          </span>
        </div>
      </Card>

      <div className="grid xl:grid-cols-[240px_1fr] gap-4">
        <div className="space-y-4">
          <Card className="p-4">
            <div className="text-sm font-semibold">
              {t(
                "Recent searches",
                "ಇತ್ತೀಚಿನ ಹುಡುಕಾಟಗಳು"
              )}
            </div>

            {recent.map((x) => (
              <button
                key={x}
                onClick={() => setQ(x)}
                className="block text-left text-xs text-muted hover:text-brand mt-3"
              >
                ↻ {x}
              </button>
            ))}
          </Card>

          <Card className="p-4">
            <div className="text-sm font-semibold">
              {t(
                "Saved searches",
                "ಉಳಿಸಿದ ಹುಡುಕಾಟಗಳು"
              )}
            </div>

            {saved.map((x) => (
              <button
                key={x}
                onClick={() => setQ(x)}
                className="block text-left text-xs text-muted hover:text-brand mt-3"
              >
                ☆ {x}
              </button>
            ))}
          </Card>
        </div>

        <Card className="p-4">
          <div className="space-y-2">
            {results.map((r) => (
              <button
                onClick={() =>
                  nav(`/fir/${caseRoute(r.raw)}`)
                }
                key={r.id}
                className="w-full p-3 rounded-lg border border-line hover:border-brand/40 text-left flex justify-between"
              >
                <div>
                  <div className="text-sm font-semibold text-brand">
                    {r.label}
                  </div>

                  <div className="text-xs text-muted mt-1">
                    {r.category} · {r.complainant} ·{" "}
                    {r.station}
                  </div>
                </div>

                <div className="text-xs text-muted">
                  {r.status}
                </div>
              </button>
            ))}

            {results.length === 0 && (
              <div className="py-12 text-center text-sm text-muted">
                {t(
                  "No FIR records match the selected filters.",
                  "ಆಯ್ಕೆ ಮಾಡಿದ ಫಿಲ್ಟರ್‌ಗಳಿಗೆ ಹೊಂದುವ ಎಫ್‌ಐಆರ್ ದಾಖಲೆಗಳಿಲ್ಲ."
                )}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};

/* =========================================================
   REPORTS
========================================================= */

export const Reports: React.FC = () => {
  const t = useT();
  const { records, loading, error } = useFirRecords();

  const monthly = useMemo(() => {
    const buckets = new Map<string, { m: string; fir: number; closed: number }>();
    for (const record of records) {
      const date = new Date(record.date);
      if (!Number.isFinite(date.getTime())) continue;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const label = date.toLocaleDateString("en-IN", { month: "short" });
      const bucket = buckets.get(key) || { m: label, fir: 0, closed: 0 };
      bucket.fir += 1;
      if (["Charge Sheeted", "Disposed by Court", "Closed - False Case"].includes(record.status)) {
        bucket.closed += 1;
      }
      buckets.set(key, bucket);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([, value]) => value);
  }, [records]);

  const station = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const record of records) {
      const key = record.station || "Unassigned";
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    return Array.from(buckets.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, value]) => ({ n: name.replace(" Police Station", ""), v: value }));
  }, [records]);

  const pie = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const record of records) {
      const key = record.raw.CrimeHead || record.category || "Other";
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    return Array.from(buckets.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, value]) => ({ name, value }));
  }, [records]);

  const csv = () => {
    const rows = [
      "Case,FIR,Category,Station,Status",
      ...records.map(
        (r) =>
          [r.label, r.fir, r.category, r.station, r.status].map(csvEscape).join(",")
      ),
    ];

    const url = URL.createObjectURL(
      new Blob([rows.join("\n")], {
        type: "text/csv",
      })
    );

    const a = document.createElement("a");

    a.href = url;
    a.download = "fir-report.csv";
    a.click();

    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-5 space-y-4">
      <div className="flex justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            {t(
              "Reports & Analytics",
              "ವರದಿಗಳು ಮತ್ತು ವಿಶ್ಲೇಷಣೆ"
            )}
          </h1>

          <p className="text-sm text-muted mt-1">
            {t(
              "Operational trends, workload and disposal performance.",
              "ಕಾರ್ಯಾಚರಣಾ ಪ್ರವೃತ್ತಿ, ಕೆಲಸದ ಹೊರೆ ಮತ್ತು ವಿಲೇವಾರಿ ಕಾರ್ಯಕ್ಷಮತೆ."
            )}
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="h-9 px-3 border border-line rounded-lg text-xs"
          >
            {t(
              "Generate PDF",
              "ಪಿಡಿಎಫ್ ರಚಿಸಿ"
            )}
          </button>

          <button
            onClick={csv}
            className="h-9 px-3 bg-brand rounded-lg text-xs"
          >
            {t(
              "Export CSV",
              "ಸಿಎಸ್ವಿ ರಫ್ತು"
            )}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          [
            t(
              "Disposal rate",
              "ವಿಲೇವಾರಿ ದರ"
            ),
            "72.4%",
          ],
          [
            t(
              "Avg. investigation",
              "ಸರಾಸರಿ ತನಿಖೆ"
            ),
            "18.6 days",
          ],
          [
            t(
              "Cases this month",
              "ಈ ತಿಂಗಳ ಪ್ರಕರಣಗಳು"
            ),
            "96",
          ],
          [
            t("Overdue", "ಬಾಕಿ"),
            "12",
          ],
        ].map((x) => (
          <Card
            className="p-4"
            key={x[0]}
          >
            <div className="text-[11px] text-muted uppercase">
              {x[0]}
            </div>

            <div className="text-2xl font-semibold mt-2">
              {x[1]}
            </div>
          </Card>
        ))}
      </div>

      <div className="grid xl:grid-cols-2 gap-4">
        <ChartCard
          title={t(
            "FIR and disposal trend",
            "ಎಫ್‌ಐಆರ್ ಮತ್ತು ವಿಲೇವಾರಿ ಪ್ರವೃತ್ತಿ"
          )}
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
          >
            <LineChart data={monthly}>
              <CartesianGrid
                stroke="currentColor"
                strokeOpacity={0.15}
                strokeDasharray="3 3"
              />

              <XAxis
                dataKey="m"
                fontSize={11}
                stroke="currentColor"
                opacity={0.65}
              />

              <YAxis
                fontSize={11}
                stroke="currentColor"
                opacity={0.65}
              />

              <Tooltip content={<ChartTooltip />} />

              <Line
                dataKey="fir"
                stroke="currentColor"
                strokeWidth={2}
              />

              <Line
                dataKey="closed"
                stroke="currentColor"
                strokeDasharray="5 4"
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title={t(
            "Station workload",
            "ಠಾಣೆ ಕೆಲಸದ ಹೊರೆ"
          )}
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
          >
            <BarChart data={station}>
              <CartesianGrid
                stroke="currentColor"
                strokeOpacity={0.15}
                strokeDasharray="3 3"
              />

              <XAxis
                dataKey="n"
                fontSize={10}
                stroke="currentColor"
                opacity={0.65}
              />

              <YAxis
                fontSize={11}
                stroke="currentColor"
                opacity={0.65}
              />

              <Tooltip content={<ChartTooltip />} />

              <Bar
                dataKey="v"
                fill="currentColor"
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title={t(
            "Crime category breakdown",
            "ಅಪರಾಧ ವರ್ಗ ವಿಭಾಗ"
          )}
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
          >
            <PieChart>
              <Pie
                data={pie}
                dataKey="value"
                nameKey="name"
                outerRadius={90}
                label
              >
                {pie.map((_, i) => (
                  <Cell
                    key={i}
                    fill="currentColor"
                    opacity={1 - i * 0.12}
                  />
                ))}
              </Pie>

              <Tooltip content={<ChartTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <Card className="p-4">
          <div className="text-sm font-semibold">
            {t(
              "Performance summary",
              "ಕಾರ್ಯಕ್ಷಮತೆ ಸಾರಾಂಶ"
            )}
          </div>

          <div className="mt-4 space-y-4">
            {[
              [
                t(
                  "Cases disposed within 30 days",
                  "30 ದಿನಗಳಲ್ಲಿ ವಿಲೇವಾರಿ"
                ),
                78,
              ],
              [
                t(
                  "Charge sheets filed on time",
                  "ಸಮಯಕ್ಕೆ ಚಾರ್ಜ್‌ಶೀಟ್"
                ),
                84,
              ],
              [
                t(
                  "Investigation updates current",
                  "ತನಿಖಾ ನವೀಕರಣ ಪ್ರಸ್ತುತ"
                ),
                91,
              ],
            ].map((x) => (
              <div key={String(x[0])}>
                <div className="flex justify-between text-xs">
                  <span>{x[0]}</span>
                  <span>{x[1]}%</span>
                </div>

                <div className="h-2 bg-panel rounded-full mt-2">
                  <div
                    className="h-full bg-brand rounded-full"
                    style={{
                      width: `${x[1]}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};

const ChartCard: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => (
  <Card className="p-4">
    <div className="text-sm font-semibold">
      {title}
    </div>

    <div className="h-[260px] mt-4">
      {children}
    </div>
  </Card>
);

/* =========================================================
   REFERENCE PAGES
========================================================= */

export const Employees: React.FC = () => {
  const { records, loading, error } = useFirRecords();
  const groups = groupByKey(records, (record) => record.raw.EmployeeID || record.io);
  const rows = groups.map(([key, employeeCases]) => {
    const sample = employeeCases[0];
    const active = employeeCases.filter((record) => record.status === "Under Investigation").length;
    return [
      <div>
        <div className="font-semibold text-brand">{sample.raw.EmployeeID || key}</div>
        <div className="text-xs text-muted mt-1">{sample.io || "Officer name not captured"}</div>
      </div>,
      uniqueText(employeeCases.map((record) => record.raw.OfficerRank)),
      uniqueText(employeeCases.map((record) => record.raw.OfficerDesignation)),
      uniqueText(employeeCases.map((record) => record.station), "-"),
      employeeCases.length.toLocaleString("en-IN"),
      active.toLocaleString("en-IN"),
    ];
  });

  return (
    <div className="p-5 space-y-4">
      <ReferenceHeader
        title="Employees"
        description="Officer directory built from EmployeeID, officer name, rank, designation, and assigned cases."
        loading={loading}
        error={error}
        count={records.length}
      />
      <div className="grid md:grid-cols-3 gap-3">
        <ReferenceStat label="Employees" value={groups.length} helper="Unique employee IDs/officers" />
        <ReferenceStat label="Ranks" value={countByValue(records, "OfficerRank").length} />
        <ReferenceStat label="Designations" value={countByValue(records, "OfficerDesignation").length} />
      </div>
      <ReferenceTable
        columns={["Employee", "Rank", "Designation", "Stations", "Cases", "Active"]}
        rows={rows}
      />
    </div>
  );
};

export const MasterData: React.FC = () => {
  const { records, loading, error } = useFirRecords();
  const dataGroups = [
    ["Crime Heads", countByValue(records, "CrimeHead")],
    ["Crime Sub Heads", countByValue(records, "CrimeSubHead")],
    ["Acts", countByValue(records, "Acts", true)],
    ["Sections", countByValue(records, "Sections", true)],
    ["Statuses", countByValue(records, "Status")],
    ["Case Categories", countByValue(records, "CaseCategory")],
    ["Gravity", countByValue(records, "Gravity")],
    ["Chargesheet Status", countByValue(records, "ChargesheetStatus")],
  ] as const;

  const totalValues = dataGroups.reduce((sum, [, values]) => sum + values.length, 0);

  return (
    <div className="p-5 space-y-4">
      <ReferenceHeader
        title="Master Data"
        description="Crime, legal, status, category, and chargesheet reference values currently used by FIR records."
        loading={loading}
        error={error}
        count={records.length}
      />
      <div className="grid md:grid-cols-4 gap-3">
        <ReferenceStat label="Reference Values" value={totalValues} />
        <ReferenceStat label="Crime Heads" value={dataGroups[0][1].length} />
        <ReferenceStat label="Acts" value={dataGroups[2][1].length} />
        <ReferenceStat label="Sections" value={dataGroups[3][1].length} />
      </div>
      <div className="grid xl:grid-cols-2 gap-4">
        {dataGroups.map(([title, values]) => (
          <ReferenceListCard key={title} title={title} values={values} />
        ))}
      </div>
    </div>
  );
};

export const Units: React.FC = () => {
  const { records, loading, error } = useFirRecords();
  const groups = groupByKey(records, (record) => record.station);
  const rows = groups.map(([station, stationCases]) => {
    const active = stationCases.filter((record) => record.status === "Under Investigation").length;
    return [
      <div>
        <div className="font-semibold text-brand">{station}</div>
        <div className="text-xs text-muted mt-1">
          {uniqueText(stationCases.map((record) => record.raw.PoliceStationType))}
        </div>
      </div>,
      uniqueText(stationCases.map((record) => record.raw.District)),
      uniqueText(stationCases.map((record) => record.raw.Court)),
      stationCases.length.toLocaleString("en-IN"),
      active.toLocaleString("en-IN"),
    ];
  });

  return (
    <div className="p-5 space-y-4">
      <ReferenceHeader
        title="Units & Stations"
        description="Police station and unit reference data with current case workload."
        loading={loading}
        error={error}
        count={records.length}
      />
      <div className="grid md:grid-cols-4 gap-3">
        <ReferenceStat label="Stations" value={groups.length} />
        <ReferenceStat label="Station Types" value={countByValue(records, "PoliceStationType").length} />
        <ReferenceStat label="Districts" value={countByValue(records, "District").length} />
        <ReferenceStat
          label="Active Cases"
          value={records.filter((record) => record.status === "Under Investigation").length}
        />
      </div>
      <ReferenceTable
        columns={["Station / Unit", "District", "Courts Used", "Cases", "Active"]}
        rows={rows}
      />
    </div>
  );
};

export const Courts: React.FC = () => {
  const { records, loading, error } = useFirRecords();
  const groups = groupByKey(records, (record) => record.raw.Court);
  const rows = groups.map(([court, courtCases]) => {
    const filed = courtCases.filter((record) => record.raw.ChargesheetStatus === "Filed").length;
    const pendingTrial = courtCases.filter((record) => record.status === "Pending Trial").length;
    return [
      <div className="font-semibold text-brand">{court}</div>,
      uniqueText(courtCases.map((record) => record.raw.District)),
      uniqueText(courtCases.map((record) => record.station)),
      courtCases.length.toLocaleString("en-IN"),
      filed.toLocaleString("en-IN"),
      pendingTrial.toLocaleString("en-IN"),
    ];
  });

  return (
    <div className="p-5 space-y-4">
      <ReferenceHeader
        title="Courts"
        description="Court directory derived from FIR court mappings and chargesheet/trial status."
        loading={loading}
        error={error}
        count={records.length}
      />
      <div className="grid md:grid-cols-4 gap-3">
        <ReferenceStat label="Courts" value={groups.length} />
        <ReferenceStat
          label="Filed Chargesheets"
          value={records.filter((record) => record.raw.ChargesheetStatus === "Filed").length}
        />
        <ReferenceStat
          label="Pending Trial"
          value={records.filter((record) => record.status === "Pending Trial").length}
        />
        <ReferenceStat label="Mapped Stations" value={countByValue(records, "PoliceStation").length} />
      </div>
      <ReferenceTable
        columns={["Court", "District", "Stations", "Cases", "Filed CS", "Pending Trial"]}
        rows={rows}
      />
    </div>
  );
};

/* =========================================================
   SETTINGS
========================================================= */

export const Settings: React.FC = () => {
  const { user } = useAuth();
  const { language, setLanguage } = useLanguage();

  const t = useT();
  const nav = useNavigate();

  const [station, setStation] = useState(
    () =>
      localStorage.getItem(
        "kpfir.defaultStation"
      ) || "Whitefield PS"
  );

  const [newFir, setNewFir] = useState(
    () =>
      localStorage.getItem(
        "kpfir.notify.newFir"
      ) !== "false"
  );

  const [statusUpdates, setStatusUpdates] =
    useState(
      () =>
        localStorage.getItem(
          "kpfir.notify.status"
        ) !== "false"
    );

  const [savedMessage, setSavedMessage] =
    useState("");

  const save = () => {
    localStorage.setItem(
      "kpfir.defaultStation",
      station
    );

    localStorage.setItem(
      "kpfir.notify.newFir",
      String(newFir)
    );

    localStorage.setItem(
      "kpfir.notify.status",
      String(statusUpdates)
    );

    setSavedMessage(
      t(
        "Changes saved",
        "ಬದಲಾವಣೆಗಳನ್ನು ಉಳಿಸಲಾಗಿದೆ"
      )
    );

    window.setTimeout(
      () => setSavedMessage(""),
      2200
    );
  };

  const Toggle = ({
    on,
    set,
  }: {
    on: boolean;
    set: (v: boolean) => void;
  }) => (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => set(!on)}
      className={`relative h-5 w-10 shrink-0 rounded-full transition ${
        on
          ? "bg-brand"
          : "bg-panel border border-line"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition ${
          on ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );

  const SettingRow = ({
    title,
    desc,
    control,
  }: {
    title: string;
    desc: string;
    control: React.ReactNode;
  }) => (
    <div className="flex items-center justify-between gap-5 py-4 border-b border-line last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-semibold">
          {title}
        </div>

        <div className="text-[11px] text-muted mt-1 leading-5">
          {desc}
        </div>
      </div>

      {control}
    </div>
  );

  return (
    <div className="p-5 pb-20 space-y-5 max-w-6xl mx-auto w-full">
      <div className="text-center">
        <h1 className="text-xl font-semibold">
          {t("Settings", "ಸೆಟ್ಟಿಂಗ್‌ಗಳು")}
        </h1>

        <p className="text-sm text-muted mt-1">
          {t(
            "Manage your workspace, alerts and account.",
            "ನಿಮ್ಮ ಕಾರ್ಯಸ್ಥಳ, ಎಚ್ಚರಿಕೆಗಳು ಮತ್ತು ಖಾತೆಯನ್ನು ನಿರ್ವಹಿಸಿ."
          )}
        </p>
      </div>

      <div className="grid xl:grid-cols-2 gap-4">
        <Card className="p-5 settings-card">
          <h2 className="font-semibold">
            {t(
              "Preferences",
              "ಆದ್ಯತೆಗಳು"
            )}
          </h2>

          <p className="text-xs text-muted mt-1">
            {t(
              "Set your default station and display language.",
              "ನಿಮ್ಮ ಡೀಫಾಲ್ಟ್ ಠಾಣೆ ಮತ್ತು ಪ್ರದರ್ಶನ ಭಾಷೆಯನ್ನು ಹೊಂದಿಸಿ."
            )}
          </p>

          <div className="mt-5 space-y-5">
            <label className="block">
              <span className="settings-label">
                {t(
                  "Default Police Station",
                  "ಡೀಫಾಲ್ಟ್ ಪೊಲೀಸ್ ಠಾಣೆ"
                )}
              </span>

              <div className="settings-select-wrap">
                <select
                  value={station}
                  onChange={(e) =>
                    setStation(e.target.value)
                  }
                  className="settings-select"
                >
                  <option>Whitefield PS</option>
                  <option>Indiranagar PS</option>
                  <option>Koramangala PS</option>
                  <option>Cubbon Park PS</option>
                </select>
              </div>
            </label>

            <label className="block">
              <span className="settings-label">
                {t(
                  "Application Language",
                  "ಅಪ್ಲಿಕೇಶನ್ ಭಾಷೆ"
                )}
              </span>

              <div className="settings-select-wrap">
                <select
                  value={language}
                  onChange={(e) =>
                    setLanguage(
                      e.target.value as "en" | "kn"
                    )
                  }
                  className="settings-select"
                >
                  <option value="en">
                    English
                  </option>

                  <option value="kn">
                    ಕನ್ನಡ
                  </option>
                </select>
              </div>
            </label>
          </div>
        </Card>

        <Card className="p-5 settings-card">
          <h2 className="font-semibold">
            {t(
              "Notifications",
              "ಸೂಚನೆಗಳು"
            )}
          </h2>

          <p className="text-xs text-muted mt-1">
            {t(
              "Choose the case alerts that matter to you.",
              "ನಿಮಗೆ ಮುಖ್ಯವಾದ ಪ್ರಕರಣ ಎಚ್ಚರಿಕೆಗಳನ್ನು ಆಯ್ಕೆಮಾಡಿ."
            )}
          </p>

          <div className="mt-3">
            <SettingRow
              title={t(
                "New FIR Alerts",
                "ಹೊಸ ಎಫ್‌ಐಆರ್ ಎಚ್ಚರಿಕೆಗಳು"
              )}
              desc={t(
                "Notify me when a new FIR is registered in my unit.",
                "ನನ್ನ ಘಟಕದಲ್ಲಿ ಹೊಸ ಎಫ್‌ಐಆರ್ ನೋಂದಾಯಿಸಿದಾಗ ಸೂಚಿಸಿ."
              )}
              control={
                <Toggle
                  on={newFir}
                  set={setNewFir}
                />
              }
            />

            <SettingRow
              title={t(
                "Case Status Updates",
                "ಪ್ರಕರಣ ಸ್ಥಿತಿ ನವೀಕರಣಗಳು"
              )}
              desc={t(
                "Alert me when an assigned case changes status.",
                "ನಿಯೋಜಿತ ಪ್ರಕರಣದ ಸ್ಥಿತಿ ಬದಲಾದಾಗ ಎಚ್ಚರಿಸಿ."
              )}
              control={
                <Toggle
                  on={statusUpdates}
                  set={setStatusUpdates}
                />
              }
            />
          </div>
        </Card>

        <Card className="p-5 settings-card xl:col-span-2">
          <h2 className="font-semibold">
            {t(
              "Account & Security",
              "ಖಾತೆ ಮತ್ತು ಭದ್ರತೆ"
            )}
          </h2>

          <p className="text-xs text-muted mt-1">
            {t(
              "Your officer account and password settings.",
              "ನಿಮ್ಮ ಅಧಿಕಾರಿ ಖಾತೆ ಮತ್ತು ಪಾಸ್‌ವರ್ಡ್ ಸೆಟ್ಟಿಂಗ್‌ಗಳು."
            )}
          </p>

          <div className="mt-5 flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div>
              <div className="text-sm font-semibold">
                {user?.name || "Officer 10427"}
              </div>

              <div className="text-xs text-muted mt-1">
                {user?.employeeId ||
                  "KA-SI-10427"}
              </div>
            </div>

            <button
              onClick={() =>
                nav("/change-password")
              }
              className="h-10 px-4 border border-line rounded-lg text-sm font-semibold hover:border-brand/40"
            >
              {t(
                "Change password",
                "ಪಾಸ್‌ವರ್ಡ್ ಬದಲಿಸಿ"
              )}
            </button>
          </div>
        </Card>
      </div>

      <div className="flex items-center justify-end gap-3">
        {savedMessage && (
          <span className="text-sm text-brand">
            ✓ {savedMessage}
          </span>
        )}

        <button
          onClick={save}
          className="h-10 px-5 rounded-lg bg-brand text-white text-sm font-semibold"
        >
          {t(
            "Save changes",
            "ಬದಲಾವಣೆಗಳನ್ನು ಉಳಿಸಿ"
          )}
        </button>
      </div>
    </div>
  );
};
