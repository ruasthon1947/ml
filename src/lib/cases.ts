import { useCallback, useEffect, useMemo, useState } from "react";

export type CaseRecord = Record<string, string>;

export type CaseOptions = {
  [field: string]: string[] | Record<string, string[]> | undefined;
  crimeSubHeadsByHead?: Record<string, string[]>;
};

export type CasesResponse = {
  ok: boolean;
  headers: string[];
  cases: CaseRecord[];
  options: CaseOptions;
  error?: string;
};

export type SyncResult = {
  ok: boolean;
  skipped?: boolean;
  command?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  message?: string;
};

export type CaseSaveResponse = {
  ok: boolean;
  created: boolean;
  headers: string[];
  case: CaseRecord;
  options: CaseOptions;
  sync: SyncResult;
  error?: string;
};

export type FirRecord = {
  id: string;
  label: string;
  fir: string;
  caseNo: string;
  category: string;
  station: string;
  io: string;
  status: string;
  gravity: string;
  date: string;
  complainant: string;
  accused: string;
  victims: string;
  section: string;
  raw: CaseRecord;
};

const api = (path: string) => `/api${path}`;

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }
  return data;
}

export async function fetchCases(): Promise<CasesResponse> {
  return readJson<CasesResponse>(await fetch(api("/cases")));
}

export async function saveCase(
  record: CaseRecord,
  caseId?: string,
  options?: { skipSync?: boolean },
): Promise<CaseSaveResponse> {
  const response = await fetch(caseId ? api(`/cases/${encodeURIComponent(caseId)}`) : api("/cases"), {
    method: caseId ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ case: record, skipSync: Boolean(options?.skipSync) }),
  });
  return readJson<CaseSaveResponse>(response);
}

export async function runCaseSync(): Promise<{ ok: boolean; sync: SyncResult }> {
  const response = await fetch(api("/cases/sync"), { method: "POST" });
  return readJson<{ ok: boolean; sync: SyncResult }>(response);
}

export function useCases() {
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [options, setOptions] = useState<CaseOptions>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const data = await fetchCases();
      setCases(data.cases || []);
      setHeaders(data.headers || []);
      setOptions(data.options || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void reload(true);
    };
    const interval = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [reload]);

  return { cases, headers, options, loading, error, reload, setCases, setOptions };
}

export function useFirRecords() {
  const caseState = useCases();
  const records = useMemo(() => caseState.cases.map(toFirRecord), [caseState.cases]);
  return { ...caseState, records };
}

export function caseKey(record: CaseRecord): string {
  return record.CaseMasterID || record.CaseNo || record.CrimeNo || "";
}

export function caseRoute(record: CaseRecord): string {
  return encodeURIComponent(caseKey(record));
}

export function caseLabel(record: CaseRecord): string {
  if (record.CaseNo) return `CR-${record.CaseNo}`;
  if (record.CaseMasterID) return `Case ${record.CaseMasterID}`;
  return record.CrimeNo || "Unnumbered case";
}

export function splitNames(value: string | undefined): string[] {
  return String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function joinNames(values: string[]): string {
  return values.map((value) => value.trim()).filter(Boolean).join("; ");
}

export function optionList(options: CaseOptions, field: string): string[] {
  const value = options[field];
  return Array.isArray(value) ? value : [];
}

export function subHeadOptions(options: CaseOptions, crimeHead: string): string[] {
  return options.crimeSubHeadsByHead?.[crimeHead] || optionList(options, "CrimeSubHead");
}

export function findCase(records: CaseRecord[], id: string | undefined): CaseRecord | undefined {
  const wanted = decodeURIComponent(id || "");
  return records.find(
    (record) =>
      record.CaseMasterID === wanted ||
      record.CaseNo === wanted ||
      record.CrimeNo === wanted,
  );
}

export function formatActSection(record: CaseRecord): string {
  const acts = splitNames(record.Acts);
  const sections = splitNames(record.Sections);
  if (acts.length === 0 && sections.length === 0) return "";
  if (acts.length === 1 && sections.length > 0) return `${acts[0]} ${sections.join(", ")}`;
  if (acts.length > 0 && sections.length > 0) return `${acts.join(", ")} | ${sections.join(", ")}`;
  return [...acts, ...sections].join(", ");
}

export function toFirRecord(record: CaseRecord): FirRecord {
  return {
    id: caseKey(record),
    label: caseLabel(record),
    fir: record.CrimeNo || record.CaseNo || "",
    caseNo: record.CaseNo || "",
    category: record.CrimeSubHead || record.CrimeHead || record.CaseCategory || "Case",
    station: record.PoliceStation || "",
    io: record.Officer || "",
    status: record.Status || "",
    gravity: record.Gravity || "",
    date: record.CrimeRegisteredDate || "",
    complainant: record.Complainant || "",
    accused: record.AccusedNames || "Unknown",
    victims: record.VictimNames || "",
    section: formatActSection(record),
    raw: record,
  };
}

export function searchText(record: FirRecord | CaseRecord): string {
  if ("raw" in record) {
    return Object.values(record.raw).join(" ").toLowerCase();
  }
  return Object.values(record).join(" ").toLowerCase();
}

export function countWhere(records: FirRecord[], predicate: (record: FirRecord) => boolean): number {
  return records.reduce((total, record) => total + (predicate(record) ? 1 : 0), 0);
}

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
