import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";

const STEPS = [
  { id: 1, title: ["Case Basics", "ಪ್ರಕರಣದ ಮೂಲ ವಿವರಗಳು"], subtitle: ["Crime number, station, IO, dates, location", "ಅಪರಾಧ ಸಂಖ್ಯೆ, ಠಾಣೆ, ತನಿಖಾಧಿಕಾರಿ, ದಿನಾಂಕ, ಸ್ಥಳ"] },
  { id: 2, title: ["Incident Details", "ಘಟನೆಯ ವಿವರಗಳು"], subtitle: ["Brief facts and incident timeframe", "ಸಂಕ್ಷಿಪ್ತ ಮಾಹಿತಿ ಮತ್ತು ಘಟನೆಯ ಕಾಲಾವಧಿ"] },
  { id: 3, title: ["Complainant(s)", "ದೂರುದಾರರು"], subtitle: ["File by whom?", "ದೂರು ಸಲ್ಲಿಸಿದವರು ಯಾರು?"] },
  { id: 4, title: ["Victim(s)", "ಬಾಧಿತರು"], subtitle: ["Who was harmed?", "ಯಾರು ಬಾಧಿತರಾದರು?"] },
  { id: 5, title: ["Accused", "ಆರೋಪಿತರು"], subtitle: ["Who is alleged? Auto A1, A2...", "ಯಾರ ಮೇಲೆ ಆರೋಪ? ಸ್ವಯಂ A1, A2..."] },
  { id: 6, title: ["Acts & Sections", "ಕಾಯ್ದೆಗಳು ಮತ್ತು ಸೆಕ್ಷನ್‌ಗಳು"], subtitle: ["Invoked statutes, cascading picker", "ಅನ್ವಯಿಸಿದ ಕಾಯ್ದೆಗಳು ಮತ್ತು ಸೆಕ್ಷನ್‌ಗಳು"] },
  { id: 7, title: ["Review & Submit", "ಪರಿಶೀಲಿಸಿ ಮತ್ತು ಸಲ್ಲಿಸಿ"], subtitle: ["Confirm and file the FIR", "ದೃಢೀಕರಿಸಿ ಎಫ್‌ಐಆರ್ ದಾಖಲಿಸಿ"] },
] as const;

type FormState = Record<string, any>;

const initialForm: FormState = {
  crimeNo: "204430000202600099",
  registeredDate: "08-07-2026",
  station: "",
  io: "",
  category: "Non-Heinous",
  gravity: "Non-Heinous",
  crimeHead: "Offences Against Property",
  crimeSubHead: "Theft",
  lat: "12.9716",
  lng: "77.5946",
};

const Section: React.FC<{ children: React.ReactNode; title?: string }> = ({
  children,
  title,
}) => (
  <div className="mb-4">
    {title && (
      <label className="block text-xs text-muted mb-1.5 uppercase tracking-wide">
        {title}
      </label>
    )}
    {children}
  </div>
);

const Field: React.FC<{
  label: string;
  children: React.ReactNode;
  hint?: string;
}> = ({ label, children, hint }) => (
  <div>
    <label className="block text-xs text-muted mb-1.5">{label}</label>
    {children}
    {hint && <p className="text-[11px] text-muted mt-1">{hint}</p>}
  </div>
);

const inputClass =
  "w-full bg-shell border border-line rounded-lg px-3 py-2 text-sm text-white placeholder-muted outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/15";

const NewFIR: React.FC = () => {
  const { language, tr } = useLanguage();
  const [step, setStep] = useState(1);
  const [complaint, setComplaint] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const [form, setForm] = useState<FormState>(initialForm);
  const navigate = useNavigate();
  const meta = STEPS[step - 1];
  const stepText = (pair: readonly [string, string]) => pair[language === "kn" ? 1 : 0];

  const update = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const go = (dir: 1 | -1) =>
    setStep((s) => Math.min(STEPS.length, Math.max(1, s + dir)));

  const generateDraft = () => {
    if (!complaint.trim()) return;
    setAiLoading(true);
    window.setTimeout(() => {
      const kannada = /[\u0C80-\u0CFF]/.test(complaint);
      setForm((f) => ({
        ...f,
        brief: complaint,
        place: kannada ? "ವೈಟ್‌ಫೀಲ್ಡ್, ಬೆಂಗಳೂರು" : "Whitefield, Bengaluru",
        crimeHead: "Offences Against Property",
        crimeSubHead: "Cheating",
        complainants: [{ name: kannada ? "ಅನನ್ಯ ರಾವ್" : "Ananya Rao", age: "", gender: "Female", contact: "", address: "" }],
        accused: [{ name: "", age: "Unknown", gender: "Male", contact: "", address: "Unknown" }],
        acts: [{ act: "BNS 2023", section: "318(4)", notes: "Cheating" }, { act: "IT Act", section: "66D", notes: "Personation using communication device" }],
      }));
      setAiReady(true);
      setAiLoading(false);
    }, 650);
  };

  return (
    <div className="min-h-full bg-ink text-white">
      {/* Sub-header */}
      <div className="px-6 py-3 border-b border-line bg-ink flex items-center">
        <h2 className="text-white text-sm font-medium">Fir</h2>
      </div>

      <div className="px-6 pt-6">
        <div className="max-w-6xl mx-auto bg-shell border border-line rounded-2xl p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-white">{tr("AI FIR Draft Assistant", "ಎಐ ಎಫ್‌ಐಆರ್ ಕರಡು ಸಹಾಯಕ")}</h1>
              <p className="text-xs text-muted mt-1">{tr("Type the complaint in English or Kannada. AI prepares a reviewable draft and pre-fills the FIR form below.", "ದೂರನ್ನು ಇಂಗ್ಲಿಷ್ ಅಥವಾ ಕನ್ನಡದಲ್ಲಿ ಟೈಪ್ ಮಾಡಿ. ಎಐ ಪರಿಶೀಲಿಸಬಹುದಾದ ಕರಡು ಸಿದ್ಧಪಡಿಸಿ ಕೆಳಗಿನ ಎಫ್‌ಐಆರ್ ಫಾರ್ಮ್ ಅನ್ನು ಪೂರ್ವಭರ್ತಿ ಮಾಡುತ್ತದೆ.")}</p>
            </div>
            <span className="text-[10px] border border-line rounded-full px-2.5 py-1 text-muted">{aiReady ? tr("Draft applied", "ಕರಡು ಅನ್ವಯಿಸಲಾಗಿದೆ") : tr("Optional", "ಐಚ್ಛಿಕ")}</span>
          </div>
          <div className="grid lg:grid-cols-[1fr_auto] gap-3 mt-4 items-stretch">
            <textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} rows={3} lang="kn" placeholder={tr("Describe what happened, who reported it, where and when...", "ಏನಾಯಿತು, ಯಾರು ವರದಿ ಮಾಡಿದರು, ಎಲ್ಲಿ ಮತ್ತು ಯಾವಾಗ ಎಂಬುದನ್ನು ವಿವರಿಸಿ...")} className="w-full resize-none bg-panel border border-line rounded-xl p-3 text-sm text-white placeholder-muted outline-none focus:border-brand/50" />
            <button type="button" onClick={generateDraft} disabled={!complaint.trim() || aiLoading} className="lg:w-48 rounded-xl bg-brand px-5 py-3 text-sm font-medium text-white disabled:opacity-40">{aiLoading ? tr("Analysing...", "ವಿಶ್ಲೇಷಿಸಲಾಗುತ್ತಿದೆ...") : tr("Generate & pre-fill", "ರಚಿಸಿ ಮತ್ತು ಭರ್ತಿ ಮಾಡಿ")}</button>
          </div>
          <p className="text-[10px] text-muted mt-2">{tr("AI suggestions are draft assistance only. The officer must verify every field and legal section before filing.", "ಎಐ ಸಲಹೆಗಳು ಕರಡು ಸಹಾಯ ಮಾತ್ರ. ದಾಖಲಿಸುವ ಮೊದಲು ಅಧಿಕಾರಿ ಪ್ರತಿಯೊಂದು ಕ್ಷೇತ್ರ ಮತ್ತು ಕಾನೂನು ಸೆಕ್ಷನ್ ಅನ್ನು ಪರಿಶೀಲಿಸಬೇಕು.")}</p>
        </div>
      </div>

      <div className="flex mt-4">
        {/* Steps rail */}
        <aside className="w-72 shrink-0 border-r border-line bg-ink sticky top-0 self-start py-8 px-6">
          <div className="space-y-1">
            {STEPS.map((s) => {
              const active = step === s.id;
              const done = step > s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setStep(s.id)}
                  className={`new-fir-step w-full text-left rounded-xl px-3 py-3 transition border ${
                    active
                      ? "bg-brand/10 border-brand/40"
                      : done
                      ? "border-sage/30 bg-sage/5 hover:bg-sage/10"
                      : "border-transparent hover:bg-panel"
                  }`}
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
                      {done ? "✓" : s.id}
                    </div>
                    <div className="min-w-0">
                      <div
                        className={`text-sm font-medium ${
                          active ? "text-white" : "text-muted"
                        }`}
                      >
                        {stepText(s.title)}
                      </div>
                      <div className="text-[11px] text-muted mt-0.5">{stepText(s.subtitle)}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Form panel */}
        <section className="flex-1 px-8 py-8 min-h-[calc(100vh-4rem)]">
          <div className="max-w-3xl">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h1 className="text-2xl font-schibsted text-white font-semibold">
                  {stepText(meta.title)}
                </h1>
                <p className="text-muted text-sm mt-1">{stepText(meta.subtitle)}</p>
              </div>
              <div className="text-xs text-muted">
                {tr("Step", "ಹಂತ")} <span className="text-white font-semibold">{step}</span> {tr("of", "ರಲ್ಲಿ")} {STEPS.length}
              </div>
            </div>

            <div className="bg-shell/40 border border-line rounded-2xl p-6">
              {step === 1 && <Step1 form={form} update={update} />}
              {step === 2 && <Step2 form={form} update={update} />}
              {step === 3 && <Step3 form={form} update={update} />}
              {step === 4 && <Step4 form={form} update={update} />}
              {step === 5 && <Step5 form={form} update={update} />}
              {step === 6 && <Step6 form={form} update={update} />}
              {step === 7 && <Step7 form={form} />}
            </div>

            <div className="mt-5 flex items-center justify-between">
              <button
                onClick={() => go(-1)}
                disabled={step === 1}
                className="text-sm text-muted hover:text-white disabled:opacity-40 px-3 py-2"
              >
                ← {tr("Previous", "ಹಿಂದಿನದು")}
              </button>
              {step < STEPS.length ? (
                <button
                  onClick={() => go(1)}
                  className="bg-brand text-white text-sm font-medium px-5 py-2 rounded-lg hover:bg-brand/90 shadow-glow"
                >
                  {tr("Continue", "ಮುಂದುವರಿಸಿ")} →
                </button>
              ) : (
                <button
                  onClick={() => navigate("/fir")}
                  className="bg-sage text-white text-sm font-medium px-5 py-2 rounded-lg hover:bg-sage/90"
                >
                  {tr("Submit FIR", "ಎಫ್‌ಐಆರ್ ಸಲ್ಲಿಸಿ")}
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default NewFIR;

/* ---------- Steps ---------- */

const Step1: React.FC<{ form: FormState; update: (k: string, v: any) => void }> = ({
  form,
  update,
}) => (
  <>
    <Section title="Auto-generated Crimeno Preview">
      <div className="bg-panel border border-line rounded-lg px-3 py-3 flex items-center justify-between">
        <div className="text-white font-mono num">{form.crimeNo}</div>
        <span className="text-[10px] uppercase tracking-wider text-muted">
          Live preview
        </span>
      </div>
      <p className="text-[11px] text-muted mt-2">
        Format: <code className="text-brand">1 + DDDD + SSSS + YYYY + #####</code>{" "}
        (district locked to <span className="text-white">0443 Bengaluru City</span>)
      </p>
    </Section>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="Crime Registered Date">
        <input
          type="text"
          value={form.registeredDate}
          onChange={(e) => update("registeredDate", e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Police Station">
        <select
          value={form.station}
          onChange={(e) => update("station", e.target.value)}
          className={inputClass}
        >
          <option value="">Select station</option>
          <option>Whitefield PS</option>
          <option>Indiranagar PS</option>
          <option>Cubbon Park PS</option>
          <option>Yelahanka PS</option>
        </select>
      </Field>
      <Field label="Investigating Officer">
        <select
          value={form.io}
          onChange={(e) => update("io", e.target.value)}
          className={inputClass}
        >
          <option value="">Select IO</option>
          <option>SI Suresh Kumar — Whitefield</option>
          <option>ASI Rekha M — Whitefield</option>
          <option>Inspector Anand Rao — Indiranagar</option>
        </select>
      </Field>
      <Field label="Case Category">
        <select
          value={form.category}
          onChange={(e) => update("category", e.target.value)}
          className={inputClass}
        >
          <option>Non-Heinous</option>
          <option>Heinous</option>
        </select>
      </Field>
      <Field label="Gravity">
        <select
          value={form.gravity}
          onChange={(e) => update("gravity", e.target.value)}
          className={inputClass}
        >
          <option>Non-Heinous</option>
          <option>Heinous</option>
        </select>
      </Field>
      <Field label="Crime Head">
        <select
          value={form.crimeHead}
          onChange={(e) => update("crimeHead", e.target.value)}
          className={inputClass}
        >
          <option>Offences Against Property</option>
          <option>Offences Against Person</option>
          <option>Local & Special Laws</option>
        </select>
      </Field>
      <Field label="Crime Sub-Head">
        <select
          value={form.crimeSubHead}
          onChange={(e) => update("crimeSubHead", e.target.value)}
          className={inputClass}
        >
          <option>Theft</option>
          <option>Robbery</option>
          <option>Burglary</option>
          <option>Cheating</option>
        </select>
      </Field>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
      <Field label="Latitude">
        <input
          value={form.lat}
          onChange={(e) => update("lat", e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Longitude">
        <input
          value={form.lng}
          onChange={(e) => update("lng", e.target.value)}
          className={inputClass}
        />
      </Field>
    </div>
  </>
);

const Step2: React.FC<{ form: FormState; update: (k: string, v: any) => void }> = ({
  form,
  update,
}) => (
  <>
    <Field label="Brief facts of the case" hint="Plain-language summary (max 1000 chars).">
      <textarea
        rows={6}
        value={form.brief ?? ""}
        onChange={(e) => update("brief", e.target.value)}
        placeholder="On 08-07-2026 at about 14:30 hrs, the complainant..."
        className={inputClass}
      />
    </Field>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
      <Field label="Incident from">
        <input
          type="datetime-local"
          value={form.from ?? ""}
          onChange={(e) => update("from", e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Incident to">
        <input
          type="datetime-local"
          value={form.to ?? ""}
          onChange={(e) => update("to", e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Place of occurrence">
        <input
          value={form.place ?? ""}
          onChange={(e) => update("place", e.target.value)}
          placeholder="e.g. ITPL Main Road, Whitefield"
          className={inputClass}
        />
      </Field>
      <Field label="Beat / Sub-division">
        <input
          value={form.beat ?? ""}
          onChange={(e) => update("beat", e.target.value)}
          placeholder="Whitefield Sector-7"
          className={inputClass}
        />
      </Field>
    </div>
  </>
);

type Party = { name: string; age: string; gender: string; contact: string; address: string };

const Step3: React.FC<{ form: FormState; update: (k: string, v: any) => void }> = ({
  form,
  update,
}) => {
  const list: Party[] = form.complainants ?? [{ name: "", age: "", gender: "Male", contact: "", address: "" }];
  const set = (idx: number, p: Party) =>
    update("complainants", list.map((x, i) => (i === idx ? p : x)));
  const add = () =>
    update("complainants", [...list, { name: "", age: "", gender: "Male", contact: "", address: "" }]);
  const remove = (i: number) =>
    update("complainants", list.filter((_, idx) => idx !== i));

  return (
    <>
      {list.map((p, i) => (
        <PartyBlock
          key={i}
          index={i}
          party={p}
          onChange={(np) => set(i, np)}
          onRemove={list.length > 1 ? () => remove(i) : undefined}
        />
      ))}
      <button onClick={add} className="text-brand text-sm mt-2 hover:text-brand/80">
        + Add another complainant
      </button>
    </>
  );
};

const Step4: React.FC<{ form: FormState; update: (k: string, v: any) => void }> = ({
  form,
  update,
}) => {
  const list: Party[] = form.victims ?? [{ name: "", age: "", gender: "Male", contact: "", address: "" }];
  const set = (idx: number, p: Party) =>
    update("victims", list.map((x, i) => (i === idx ? p : x)));
  const add = () =>
    update("victims", [...list, { name: "", age: "", gender: "Male", contact: "", address: "" }]);
  const remove = (i: number) =>
    update("victims", list.filter((_, idx) => idx !== i));

  return (
    <>
      {list.map((p, i) => (
        <PartyBlock
          key={i}
          index={i}
          party={p}
          onChange={(np) => set(i, np)}
          onRemove={list.length > 1 ? () => remove(i) : undefined}
        />
      ))}
      <button onClick={add} className="text-brand text-sm mt-2 hover:text-brand/80">
        + Add another victim
      </button>
    </>
  );
};

const Step5: React.FC<{ form: FormState; update: (k: string, v: any) => void }> = ({
  form,
  update,
}) => {
  const accused: Party[] = form.accused ?? [{ name: "", age: "Unknown", gender: "Male", contact: "", address: "Unknown" }];
  const set = (idx: number, p: Party) =>
    update("accused", accused.map((x, i) => (i === idx ? p : x)));
  const add = () =>
    update("accused", [...accused, { name: "", age: "Unknown", gender: "Male", contact: "", address: "Unknown" }]);
  const remove = (i: number) =>
    update("accused", accused.filter((_, idx) => idx !== i));

  return (
    <>
      <p className="text-xs text-muted mb-3">
        Unknown accused will be auto-labelled A1, A2, etc. Fill known details below.
      </p>
      {accused.map((p, i) => (
        <PartyBlock
          key={i}
          index={i}
          label={i === 0 ? "A1" : `A${i + 1}`}
          party={p}
          onChange={(np) => set(i, np)}
          onRemove={accused.length > 1 ? () => remove(i) : undefined}
        />
      ))}
      <button onClick={add} className="text-brand text-sm mt-2 hover:text-brand/80">
        + Add accused
      </button>
    </>
  );
};

const Step6: React.FC<{ form: FormState; update: (k: string, v: any) => void }> = ({
  form,
  update,
}) => {
  const acts: { act: string; section: string; notes?: string }[] =
    form.acts ?? [
      { act: "Indian Penal Code", section: "379", notes: "Theft" },
    ];
  const setList = (next: typeof acts) => update("acts", next);
  const updateRow = (i: number, patch: Partial<(typeof acts)[number]>) =>
    setList(acts.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  const addRow = () =>
    setList([...acts, { act: "Indian Penal Code", section: "", notes: "" }]);
  const removeRow = (i: number) => setList(acts.filter((_, idx) => idx !== i));

  return (
    <>
      <Section title="Invoked acts & sections">
        <div className="space-y-2">
          {acts.map((a, i) => (
            <div
              key={i}
              className="grid grid-cols-12 gap-2 items-center bg-panel border border-line rounded-lg px-3 py-2"
            >
              <select
                value={a.act}
                onChange={(e) => updateRow(i, { act: e.target.value })}
                className="col-span-4 bg-shell border border-line rounded-md px-2 py-1.5 text-sm"
              >
                <option>Indian Penal Code</option>
                <option>BNS 2023</option>
                <option>CrPC</option>
                <option>IT Act</option>
                <option>Local & Special Laws</option>
              </select>
              <input
                value={a.section}
                onChange={(e) => updateRow(i, { section: e.target.value })}
                placeholder="Section"
                className="col-span-2 bg-shell border border-line rounded-md px-2 py-1.5 text-sm"
              />
              <input
                value={a.notes ?? ""}
                onChange={(e) => updateRow(i, { notes: e.target.value })}
                placeholder="Short description"
                className="col-span-5 bg-shell border border-line rounded-md px-2 py-1.5 text-sm"
              />
              <button
                onClick={() => removeRow(i)}
                disabled={acts.length === 1}
                className="col-span-1 text-muted hover:text-rose text-sm disabled:opacity-30"
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button onClick={addRow} className="text-brand text-sm mt-2 hover:text-brand/80">
          + Add act / section
        </button>
      </Section>

      <Field label="Cascading notes (auto-suggested from crime head)" hint="These update as you pick different heads above.">
        <textarea
          rows={4}
          className={inputClass}
          value={form.cascade ?? "For Theft (IPC 379) the typical charge sheet includes property recovery, identification of accused, and statements under 161 CrPC."}
          onChange={(e) => update("cascade", e.target.value)}
        />
      </Field>
    </>
  );
};

const Step7: React.FC<{ form: FormState }> = ({ form }) => {
  const summary: [string, string][] = [
    ["Crime No.", form.crimeNo],
    ["Station", form.station || "Whitefield PS"],
    ["IO", form.io || "SI Suresh Kumar"],
    ["Category", form.category],
    ["Gravity", form.gravity],
    ["Crime Head", `${form.crimeHead} · ${form.crimeSubHead}`],
    ["Place", form.place || "ITPL Main Road, Whitefield"],
    [
      "Coordinates",
      form.lat && form.lng ? `${form.lat}, ${form.lng}` : "12.9716, 77.5946",
    ],
  ];
  return (
    <>
      <p className="text-sm text-muted mb-4">
        Confirm the entries below. Filing the FIR generates a Crimeno and locks the
        record for the IO of record.
      </p>

      <div className="bg-panel border border-line rounded-lg divide-y divide-line">
        {summary.map(([k, v]) => (
          <div key={k} className="grid grid-cols-3 px-4 py-2.5">
            <div className="text-xs text-muted uppercase tracking-wide">{k}</div>
            <div className="col-span-2 text-white text-sm">{v}</div>
          </div>
        ))}
      </div>

      <div className="mt-5 bg-amber/10 border border-amber/30 text-amber text-sm rounded-lg px-4 py-3">
        ⚠ Once submitted, this FIR becomes immutable and a unique Crimeno is reserved for
        Bengaluru City District.
      </div>
    </>
  );
};

/* ---------- Reusable party block ---------- */
const PartyBlock: React.FC<{
  index: number;
  party: Party;
  label?: string;
  onChange: (p: Party) => void;
  onRemove?: () => void;
}> = ({ index, party, label, onChange, onRemove }) => (
  <div className="bg-panel border border-line rounded-xl p-4 mb-3">
    <div className="flex items-center justify-between mb-3">
      <div className="text-xs uppercase tracking-wider text-muted">
        {label ?? `Party ${index + 1}`}
      </div>
      {onRemove && (
        <button onClick={onRemove} className="text-xs text-muted hover:text-rose">
          Remove
        </button>
      )}
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Field label="Full name">
        <input
          value={party.name}
          onChange={(e) => onChange({ ...party, name: e.target.value })}
          className={inputClass}
        />
      </Field>
      <Field label="Age">
        <input
          value={party.age}
          onChange={(e) => onChange({ ...party, age: e.target.value })}
          className={inputClass}
        />
      </Field>
      <Field label="Gender">
        <select
          value={party.gender}
          onChange={(e) => onChange({ ...party, gender: e.target.value })}
          className={inputClass}
        >
          <option>Male</option>
          <option>Female</option>
          <option>Other</option>
        </select>
      </Field>
      <Field label="Contact">
        <input
          value={party.contact}
          onChange={(e) => onChange({ ...party, contact: e.target.value })}
          className={inputClass}
          placeholder="+91"
        />
      </Field>
      <div className="md:col-span-2">
        <Field label="Address">
          <input
            value={party.address}
            onChange={(e) => onChange({ ...party, address: e.target.value })}
            className={inputClass}
          />
        </Field>
      </div>
    </div>
  </div>
);
