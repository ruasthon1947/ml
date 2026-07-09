import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
import {
  CaseOptions,
  CaseRecord,
  caseKey,
  caseRoute,
  findCase,
  joinNames,
  optionList,
  saveCase,
  splitNames,
  subHeadOptions,
  todayIso,
  useCases,
} from "../lib/cases";

const STEPS = [
  {
    id: 1,
    title: "Case Basics",
    subtitle: "Save the case row before related details are entered",
  },
  {
    id: 2,
    title: "Incident Details",
    subtitle: "Facts, reporting date, incident window, and location",
  },
  {
    id: 3,
    title: "Complainant",
    subtitle: "Person or entity that filed the complaint",
  },
  {
    id: 4,
    title: "Victims",
    subtitle: "Victim names are stored in the Consolidated_Cases row",
  },
  {
    id: 5,
    title: "Accused",
    subtitle: "Accused details unlock only after the case exists",
  },
  {
    id: 6,
    title: "Acts & Sections",
    subtitle: "Statutes, sections, arrests, and chargesheet fields",
  },
  {
    id: 7,
    title: "Review & Submit",
    subtitle: "Final save to local_db and Google Sheets sync trigger",
  },
] as const;

const CASE_HEADERS = [
  "CaseMasterID",
  "CrimeNo",
  "CaseNo",
  "CrimeRegisteredDate",
  "CrimeHead",
  "CrimeSubHead",
  "PoliceStation",
  "PoliceStationType",
  "District",
  "Court",
  "EmployeeID",
  "Officer",
  "OfficerRank",
  "OfficerDesignation",
  "Status",
  "CaseCategory",
  "Gravity",
  "AccusedCount",
  "AccusedNames",
  "VictimCount",
  "VictimNames",
  "Complainant",
  "ArrestCount",
  "ChargesheetCount",
  "LatestChargesheetDate",
  "ChargesheetStatus",
  "Acts",
  "Sections",
  "InfoReceivedPSDate",
  "IncidentFromDate",
  "IncidentToDate",
  "Latitude",
  "Longitude",
  "BriefFacts",
];

type FormState = Record<string, string>;

type SaveState = {
  status: "idle" | "saving" | "saved" | "error";
  message: string;
};

const emptyForm = (): FormState => ({
  CaseMasterID: "",
  CrimeNo: "",
  CaseNo: "",
  CrimeRegisteredDate: todayIso(),
  CrimeHead: "",
  CrimeSubHead: "",
  PoliceStation: "",
  PoliceStationType: "Police Station",
  District: "Bangalore Urban",
  Court: "",
  EmployeeID: "",
  Officer: "",
  OfficerRank: "",
  OfficerDesignation: "Investigating Officer (IO)",
  Status: "Under Investigation",
  CaseCategory: "FIR",
  Gravity: "Non-Heinous",
  AccusedCount: "0",
  AccusedNames: "",
  VictimCount: "0",
  VictimNames: "",
  Complainant: "",
  ArrestCount: "0",
  ChargesheetCount: "0",
  LatestChargesheetDate: "",
  ChargesheetStatus: "Pending",
  Acts: "",
  Sections: "",
  InfoReceivedPSDate: "",
  IncidentFromDate: "",
  IncidentToDate: "",
  Latitude: "",
  Longitude: "",
  BriefFacts: "",
});

const toForm = (record?: CaseRecord): FormState => {
  const base = emptyForm();
  if (!record) return base;
  for (const header of CASE_HEADERS) {
    base[header] = record[header] || "";
  }
  return base;
};

const buildPayload = (form: FormState): CaseRecord => {
  const payload: CaseRecord = {};
  for (const header of CASE_HEADERS) {
    payload[header] = form[header] || "";
  }
  payload.AccusedNames = joinNames(splitNames(payload.AccusedNames));
  payload.VictimNames = joinNames(splitNames(payload.VictimNames));
  payload.AccusedCount = String(splitNames(payload.AccusedNames).length);
  payload.VictimCount = String(splitNames(payload.VictimNames).length);
  return payload;
};

const inputClass =
  "w-full bg-shell border border-line rounded-lg px-3 py-2 text-sm text-white placeholder-muted outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/15 disabled:opacity-55 disabled:cursor-not-allowed";

const Section: React.FC<{ title?: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <div className="mb-5">
    {title && (
      <div className="text-xs text-muted mb-2 uppercase tracking-wide">
        {title}
      </div>
    )}
    {children}
  </div>
);

const Field: React.FC<{
  label: string;
  children: React.ReactNode;
  hint?: string;
}> = ({ label, children, hint }) => (
  <label className="block">
    <span className="block text-xs text-muted mb-1.5">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-muted mt-1">{hint}</span>}
  </label>
);

const OptionInput: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  field: string;
  placeholder?: string;
  disabled?: boolean;
}> = ({ label, value, onChange, options, field, placeholder, disabled }) => {
  const listId = `${field}-options`;
  return (
    <Field label={label}>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        list={listId}
        placeholder={placeholder}
        disabled={disabled}
        className={inputClass}
      />
      <datalist id={listId}>
        {options.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
    </Field>
  );
};

const namesFromTextarea = (value: string) => joinNames(value.split(/\n|;/));
const textareaFromNames = (value: string) => splitNames(value).join("\n");

const syncMessage = (sync: { ok: boolean; skipped?: boolean; message?: string; stderr?: string }) => {
  if (sync.ok) return sync.skipped ? "Local save complete. Sync was skipped." : "Local save complete. Google sync script ran.";
  return `Local save complete, but Google sync needs attention: ${sync.stderr || sync.message || "script failed"}`;
};

const NewFIR: React.FC = () => {
  const { tr } = useLanguage();
  const navigate = useNavigate();
  const { id } = useParams();
  const editing = Boolean(id);
  const { cases, options, loading, error, reload } = useCases();

  const existingCase = useMemo(() => findCase(cases, id), [cases, id]);
  const [loadedKey, setLoadedKey] = useState("");
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [step, setStep] = useState(1);
  const [highestUnlocked, setHighestUnlocked] = useState(editing ? STEPS.length : 1);
  const [persistedCaseId, setPersistedCaseId] = useState("");
  const [complaint, setComplaint] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({
    status: "idle",
    message: "",
  });

  useEffect(() => {
    if (!editing || !existingCase) return;
    const key = caseKey(existingCase);
    if (key && key !== loadedKey) {
      setForm(toForm(existingCase));
      setPersistedCaseId(key);
      setHighestUnlocked(STEPS.length);
      setLoadedKey(key);
    }
  }, [editing, existingCase, loadedKey]);

  const persisted = Boolean(persistedCaseId || form.CaseMasterID);
  const meta = STEPS[step - 1];
  const accusedCount = splitNames(form.AccusedNames).length;
  const victimCount = splitNames(form.VictimNames).length;

  const update = (field: string, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveState((current) =>
      current.status === "saved" ? { status: "idle", message: "" } : current,
    );
  };

  const saveCurrentStep = async () => {
    if (!form.CrimeRegisteredDate || !form.PoliceStation || !form.CrimeHead) {
      setSaveState({
        status: "error",
        message: "CrimeRegisteredDate, PoliceStation, and CrimeHead are required before the case row can be saved.",
      });
      return null;
    }

    setSaveState({ status: "saving", message: "Saving to local_db..." });
    try {
      const result = await saveCase(buildPayload(form), persistedCaseId || form.CaseMasterID || undefined);
      const nextForm = toForm(result.case);
      const nextKey = caseKey(result.case);
      setForm(nextForm);
      setPersistedCaseId(nextKey);
      setLoadedKey(nextKey);
      setSaveState({ status: result.sync.ok ? "saved" : "error", message: syncMessage(result.sync) });
      await reload();
      return result;
    } catch (err) {
      setSaveState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  };

  const goNext = async () => {
    const result = await saveCurrentStep();
    if (!result) return;
    setHighestUnlocked((current) => Math.max(current, Math.min(STEPS.length, step + 1)));
    setStep((current) => Math.min(STEPS.length, current + 1));
  };

  const submit = async () => {
    const result = await saveCurrentStep();
    if (result) {
      navigate(`/fir/${caseRoute(result.case)}`);
    }
  };

  const generateDraft = () => {
    if (!complaint.trim()) return;
    setAiLoading(true);
    window.setTimeout(() => {
      setForm((current) => ({
        ...current,
        BriefFacts: complaint,
        CrimeHead: current.CrimeHead || "Cyber Crime",
        CrimeSubHead: current.CrimeSubHead || "Online Financial Fraud",
        Complainant: current.Complainant || "Ananya Rao",
        AccusedNames: current.AccusedNames || "Unknown",
        Acts: current.Acts || "BNS; IT Act",
        Sections: current.Sections || "318(4); 66D",
      }));
      setAiReady(true);
      setAiLoading(false);
    }, 500);
  };

  const stationOptions = optionList(options, "PoliceStation");
  const crimeHeadOptions = optionList(options, "CrimeHead");
  const crimeSubHeadOptions = subHeadOptions(options, form.CrimeHead);

  if (loading && editing && !existingCase) {
    return <div className="p-6 text-sm text-muted">Loading case from local_db...</div>;
  }

  if (error && editing && !existingCase) {
    return <div className="p-6 text-sm text-rose">{error}</div>;
  }

  if (editing && !loading && !existingCase) {
    return <div className="p-6 text-sm text-muted">Case not found in Consolidated_Cases.csv.</div>;
  }

  return (
    <div className="min-h-full bg-ink text-white">
      <div className="px-6 py-3 border-b border-line bg-ink flex items-center justify-between gap-4">
        <h2 className="text-white text-sm font-medium">
          {editing ? "Edit FIR" : "New FIR"}
        </h2>
        <div className="text-xs text-muted">
          Source: <span className="text-white">local_db/Consolidated_Cases.csv</span>
        </div>
      </div>

      <div className="px-6 pt-6">
        <div className="max-w-6xl mx-auto bg-shell border border-line rounded-2xl p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-white">
                {tr("AI FIR Draft Assistant", "AI FIR Draft Assistant")}
              </h1>
              <p className="text-xs text-muted mt-1">
                Enter a complaint draft, then save case details in CSV order. Each step writes back to local_db and runs the sync script.
              </p>
            </div>
            <span className="text-[10px] border border-line rounded-full px-2.5 py-1 text-muted">
              {persisted ? `Case saved: ${form.CaseMasterID || persistedCaseId}` : "Case not saved yet"}
            </span>
          </div>

          <div className="grid lg:grid-cols-[1fr_auto] gap-3 mt-4 items-stretch">
            <textarea
              value={complaint}
              onChange={(event) => setComplaint(event.target.value)}
              rows={3}
              placeholder="Describe what happened, who reported it, where and when..."
              className="w-full resize-none bg-panel border border-line rounded-xl p-3 text-sm text-white placeholder-muted outline-none focus:border-brand/50"
            />
            <button
              type="button"
              onClick={generateDraft}
              disabled={!complaint.trim() || aiLoading}
              className="lg:w-48 rounded-xl bg-brand px-5 py-3 text-sm font-medium text-white disabled:opacity-40"
            >
              {aiLoading ? "Analysing..." : aiReady ? "Refresh draft" : "Generate draft"}
            </button>
          </div>

          {saveState.message && (
            <div
              className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                saveState.status === "error"
                  ? "border-amber/30 bg-amber/10 text-amber"
                  : "border-sage/30 bg-sage/10 text-sage"
              }`}
            >
              {saveState.message}
            </div>
          )}
        </div>
      </div>

      <div className="flex mt-4">
        <aside className="w-72 shrink-0 border-r border-line bg-ink sticky top-0 self-start py-8 px-6">
          <div className="space-y-1">
            {STEPS.map((item) => {
              const active = step === item.id;
              const done = step > item.id;
              const locked = item.id > highestUnlocked;
              return (
                <button
                  key={item.id}
                  onClick={() => !locked && setStep(item.id)}
                  disabled={locked}
                  className={`new-fir-step w-full text-left rounded-xl px-3 py-3 transition border ${
                    active
                      ? "bg-brand/10 border-brand/40"
                      : done
                      ? "border-sage/30 bg-sage/5 hover:bg-sage/10"
                      : "border-transparent hover:bg-panel"
                  } ${locked ? "opacity-45 cursor-not-allowed" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`h-7 w-7 rounded-full grid place-items-center text-xs font-semibold shrink-0 ${
                        active
                          ? "bg-brand text-white"
                          : done
                          ? "bg-sage/15 text-sage border border-sage/30"
                          : "bg-panel text-muted border border-line"
                      }`}
                    >
                      {done ? "OK" : item.id}
                    </div>
                    <div className="min-w-0">
                      <div className={`text-sm font-medium ${active ? "text-white" : "text-muted"}`}>
                        {item.title}
                      </div>
                      <div className="text-[11px] text-muted mt-0.5">{item.subtitle}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="flex-1 px-8 py-8 min-h-[calc(100vh-4rem)]">
          <div className="max-w-4xl">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h1 className="text-2xl font-schibsted text-white font-semibold">
                  {meta.title}
                </h1>
                <p className="text-muted text-sm mt-1">{meta.subtitle}</p>
              </div>
              <div className="text-xs text-muted">
                Step <span className="text-white font-semibold">{step}</span> of {STEPS.length}
              </div>
            </div>

            <div className="bg-shell/40 border border-line rounded-2xl p-6">
              {step === 1 && (
                <Step1
                  form={form}
                  update={update}
                  options={options}
                  stationOptions={stationOptions}
                  crimeHeadOptions={crimeHeadOptions}
                  crimeSubHeadOptions={crimeSubHeadOptions}
                />
              )}
              {step === 2 && <Step2 form={form} update={update} />}
              {step === 3 && <Step3 form={form} update={update} />}
              {step === 4 && <Step4 form={form} update={update} victimCount={victimCount} />}
              {step === 5 && (
                <Step5
                  form={form}
                  update={update}
                  disabled={!persisted}
                  accusedCount={accusedCount}
                />
              )}
              {step === 6 && <Step6 form={form} update={update} options={options} />}
              {step === 7 && <Step7 form={form} persisted={persisted} />}
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                onClick={() => setStep((current) => Math.max(1, current - 1))}
                disabled={step === 1 || saveState.status === "saving"}
                className="text-sm text-muted hover:text-white disabled:opacity-40 px-3 py-2"
              >
                &lt;- Previous
              </button>

              <div className="flex items-center gap-3">
                <button
                  onClick={saveCurrentStep}
                  disabled={saveState.status === "saving"}
                  className="h-10 px-4 rounded-lg border border-line text-sm text-muted hover:text-white disabled:opacity-40"
                >
                  {saveState.status === "saving" ? "Saving..." : "Save step"}
                </button>

                {step < STEPS.length ? (
                  <button
                    onClick={goNext}
                    disabled={saveState.status === "saving"}
                    className="bg-brand text-white text-sm font-medium px-5 py-2 rounded-lg hover:bg-brand/90 shadow-glow disabled:opacity-40"
                  >
                    Save & continue -&gt;
                  </button>
                ) : (
                  <button
                    onClick={submit}
                    disabled={saveState.status === "saving"}
                    className="bg-sage text-white text-sm font-medium px-5 py-2 rounded-lg hover:bg-sage/90 disabled:opacity-40"
                  >
                    Submit FIR
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default NewFIR;

const Step1: React.FC<{
  form: FormState;
  update: (field: string, value: string) => void;
  options: CaseOptions;
  stationOptions: string[];
  crimeHeadOptions: string[];
  crimeSubHeadOptions: string[];
}> = ({ form, update, options, stationOptions, crimeHeadOptions, crimeSubHeadOptions }) => (
  <>
    <Section title="Case identity">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label="CaseMasterID">
          <input value={form.CaseMasterID} readOnly placeholder="Assigned on save" className={inputClass} />
        </Field>
        <Field label="CaseNo">
          <input
            value={form.CaseNo}
            onChange={(event) => update("CaseNo", event.target.value)}
            placeholder="Assigned on save if blank"
            className={inputClass}
          />
        </Field>
        <Field label="CrimeNo">
          <input
            value={form.CrimeNo}
            onChange={(event) => update("CrimeNo", event.target.value)}
            placeholder="Assigned on save if blank"
            className={inputClass}
          />
        </Field>
      </div>
    </Section>

    <Section title="Case basics">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="CrimeRegisteredDate">
          <input
            type="date"
            value={form.CrimeRegisteredDate}
            onChange={(event) => update("CrimeRegisteredDate", event.target.value)}
            className={inputClass}
          />
        </Field>
        <OptionInput
          label="PoliceStation"
          field="PoliceStation"
          value={form.PoliceStation}
          onChange={(value) => update("PoliceStation", value)}
          options={stationOptions}
          placeholder="Select or type station"
        />
        <OptionInput
          label="PoliceStationType"
          field="PoliceStationType"
          value={form.PoliceStationType}
          onChange={(value) => update("PoliceStationType", value)}
          options={optionList(options, "PoliceStationType")}
        />
        <OptionInput
          label="District"
          field="District"
          value={form.District}
          onChange={(value) => update("District", value)}
          options={optionList(options, "District")}
        />
        <OptionInput
          label="CrimeHead"
          field="CrimeHead"
          value={form.CrimeHead}
          onChange={(value) => {
            update("CrimeHead", value);
            update("CrimeSubHead", "");
          }}
          options={crimeHeadOptions}
          placeholder="Required"
        />
        <OptionInput
          label="CrimeSubHead"
          field="CrimeSubHead"
          value={form.CrimeSubHead}
          onChange={(value) => update("CrimeSubHead", value)}
          options={crimeSubHeadOptions}
        />
        <OptionInput
          label="CaseCategory"
          field="CaseCategory"
          value={form.CaseCategory}
          onChange={(value) => update("CaseCategory", value)}
          options={optionList(options, "CaseCategory")}
        />
        <OptionInput
          label="Gravity"
          field="Gravity"
          value={form.Gravity}
          onChange={(value) => update("Gravity", value)}
          options={optionList(options, "Gravity")}
        />
        <OptionInput
          label="Status"
          field="Status"
          value={form.Status}
          onChange={(value) => update("Status", value)}
          options={optionList(options, "Status")}
        />
        <OptionInput
          label="Court"
          field="Court"
          value={form.Court}
          onChange={(value) => update("Court", value)}
          options={optionList(options, "Court")}
        />
      </div>
    </Section>

    <Section title="Officer assignment">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="EmployeeID">
          <input
            value={form.EmployeeID}
            onChange={(event) => update("EmployeeID", event.target.value)}
            className={inputClass}
          />
        </Field>
        <OptionInput
          label="Officer"
          field="Officer"
          value={form.Officer}
          onChange={(value) => update("Officer", value)}
          options={optionList(options, "Officer")}
        />
        <OptionInput
          label="OfficerRank"
          field="OfficerRank"
          value={form.OfficerRank}
          onChange={(value) => update("OfficerRank", value)}
          options={optionList(options, "OfficerRank")}
        />
        <OptionInput
          label="OfficerDesignation"
          field="OfficerDesignation"
          value={form.OfficerDesignation}
          onChange={(value) => update("OfficerDesignation", value)}
          options={optionList(options, "OfficerDesignation")}
        />
      </div>
    </Section>
  </>
);

const Step2: React.FC<{ form: FormState; update: (field: string, value: string) => void }> = ({
  form,
  update,
}) => (
  <>
    <Field label="BriefFacts" hint="This maps directly to the BriefFacts column.">
      <textarea
        rows={6}
        value={form.BriefFacts}
        onChange={(event) => update("BriefFacts", event.target.value)}
        className={inputClass}
      />
    </Field>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
      <Field label="InfoReceivedPSDate">
        <input
          value={form.InfoReceivedPSDate}
          onChange={(event) => update("InfoReceivedPSDate", event.target.value)}
          placeholder="YYYY-MM-DD HH:MM:SS"
          className={inputClass}
        />
      </Field>
      <Field label="IncidentFromDate">
        <input
          value={form.IncidentFromDate}
          onChange={(event) => update("IncidentFromDate", event.target.value)}
          placeholder="YYYY-MM-DD HH:MM:SS"
          className={inputClass}
        />
      </Field>
      <Field label="IncidentToDate">
        <input
          value={form.IncidentToDate}
          onChange={(event) => update("IncidentToDate", event.target.value)}
          placeholder="YYYY-MM-DD HH:MM:SS"
          className={inputClass}
        />
      </Field>
      <Field label="Latitude">
        <input
          value={form.Latitude}
          onChange={(event) => update("Latitude", event.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Longitude">
        <input
          value={form.Longitude}
          onChange={(event) => update("Longitude", event.target.value)}
          className={inputClass}
        />
      </Field>
    </div>
  </>
);

const Step3: React.FC<{ form: FormState; update: (field: string, value: string) => void }> = ({
  form,
  update,
}) => (
  <Field label="Complainant" hint="Consolidated_Cases stores one complainant text value.">
    <input
      value={form.Complainant}
      onChange={(event) => update("Complainant", event.target.value)}
      className={inputClass}
    />
  </Field>
);

const Step4: React.FC<{
  form: FormState;
  update: (field: string, value: string) => void;
  victimCount: number;
}> = ({ form, update, victimCount }) => (
  <>
    <Field label="VictimNames" hint="Enter one victim per line. The CSV stores them with semicolons.">
      <textarea
        rows={6}
        value={textareaFromNames(form.VictimNames)}
        onChange={(event) => update("VictimNames", namesFromTextarea(event.target.value))}
        className={inputClass}
      />
    </Field>
    <div className="text-xs text-muted mt-3">
      VictimCount will be saved as <span className="text-white font-semibold">{victimCount}</span>.
    </div>
  </>
);

const Step5: React.FC<{
  form: FormState;
  update: (field: string, value: string) => void;
  disabled: boolean;
  accusedCount: number;
}> = ({ form, update, disabled, accusedCount }) => (
  <>
    {disabled && (
      <div className="mb-4 rounded-lg border border-amber/30 bg-amber/10 text-amber text-sm px-4 py-3">
        Save Case Basics first. Accused details cannot be entered until the case row exists.
      </div>
    )}
    <Field label="AccusedNames" hint="Enter one accused per line. Unknown accused can be entered as Unknown.">
      <textarea
        rows={6}
        value={textareaFromNames(form.AccusedNames)}
        onChange={(event) => update("AccusedNames", namesFromTextarea(event.target.value))}
        className={inputClass}
        disabled={disabled}
      />
    </Field>
    <div className="text-xs text-muted mt-3">
      AccusedCount will be saved as <span className="text-white font-semibold">{accusedCount}</span>.
    </div>
  </>
);

const Step6: React.FC<{
  form: FormState;
  update: (field: string, value: string) => void;
  options: CaseOptions;
}> = ({ form, update, options }) => (
  <>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="Acts" hint="Separate multiple acts with semicolons.">
        <input
          value={form.Acts}
          onChange={(event) => update("Acts", joinNames(event.target.value.split(";")))}
          list="Acts-options"
          className={inputClass}
        />
        <datalist id="Acts-options">
          {optionList(options, "Acts").map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
      </Field>
      <Field label="Sections" hint="Separate multiple sections with semicolons.">
        <input
          value={form.Sections}
          onChange={(event) => update("Sections", joinNames(event.target.value.split(";")))}
          list="Sections-options"
          className={inputClass}
        />
        <datalist id="Sections-options">
          {optionList(options, "Sections").map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
      </Field>
      <Field label="ArrestCount">
        <input
          value={form.ArrestCount}
          onChange={(event) => update("ArrestCount", event.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="ChargesheetCount">
        <input
          value={form.ChargesheetCount}
          onChange={(event) => update("ChargesheetCount", event.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="LatestChargesheetDate">
        <input
          type="date"
          value={form.LatestChargesheetDate}
          onChange={(event) => update("LatestChargesheetDate", event.target.value)}
          className={inputClass}
        />
      </Field>
      <OptionInput
        label="ChargesheetStatus"
        field="ChargesheetStatus"
        value={form.ChargesheetStatus}
        onChange={(value) => update("ChargesheetStatus", value)}
        options={optionList(options, "ChargesheetStatus")}
      />
    </div>
  </>
);

const Step7: React.FC<{ form: FormState; persisted: boolean }> = ({ form, persisted }) => {
  const summary = [
    ["CaseMasterID", form.CaseMasterID || "Assigned on save"],
    ["CaseNo", form.CaseNo || "Assigned on save"],
    ["CrimeNo", form.CrimeNo || "Assigned on save"],
    ["PoliceStation", form.PoliceStation],
    ["CrimeHead", form.CrimeHead],
    ["CrimeSubHead", form.CrimeSubHead],
    ["Complainant", form.Complainant],
    ["VictimCount", String(splitNames(form.VictimNames).length)],
    ["AccusedCount", String(splitNames(form.AccusedNames).length)],
    ["Status", form.Status],
  ];

  return (
    <>
      <p className="text-sm text-muted mb-4">
        Review the row before the final save. The final submit updates Consolidated_Cases.csv and runs import_data.py.
      </p>

      {!persisted && (
        <div className="mb-4 rounded-lg border border-amber/30 bg-amber/10 text-amber text-sm px-4 py-3">
          Case Basics have not been saved yet.
        </div>
      )}

      <div className="bg-panel border border-line rounded-lg divide-y divide-line">
        {summary.map(([label, value]) => (
          <div key={label} className="grid grid-cols-3 px-4 py-2.5">
            <div className="text-xs text-muted uppercase tracking-wide">{label}</div>
            <div className="col-span-2 text-white text-sm">{value || "-"}</div>
          </div>
        ))}
      </div>
    </>
  );
};
