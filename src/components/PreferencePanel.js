import { EMPTY_PREFERENCES } from "@/lib/preferenceMatch";

function CheckboxField({ id, checked, onChange, children }) {
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-white/8 bg-[#071321] px-3 py-2 text-sm text-slate-300">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-cyan-300"
      />
      <span>{children}</span>
    </label>
  );
}

export default function PreferencePanel({ preferences, onChange, onClear }) {
  return (
    <details className="mt-5 rounded-2xl border border-white/10 bg-[#091827]/90 p-4 sm:p-5">
      <summary className="cursor-pointer rounded-lg text-sm font-semibold text-cyan-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300">
        My preferences <span className="font-normal text-slate-500">&middot; optional, rule-based</span>
      </summary>
      <div className="mt-5 border-t border-white/8 pt-5">
        <p className="max-w-3xl text-sm leading-6 text-slate-400">
          Scores explain how a listing matches the details you choose. They are not AI
          recommendations and do not identify an objectively best position.
        </p>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="preference-keywords" className="form-label">Research keywords</label>
            <input
              id="preference-keywords"
              className="form-control mt-2"
              value={preferences.researchKeywords}
              onChange={(event) => onChange("researchKeywords", event.target.value)}
              placeholder="materials, microscopy, climate"
              maxLength={300}
            />
          </div>
          <div>
            <label htmlFor="preference-countries" className="form-label">Preferred countries</label>
            <input
              id="preference-countries"
              className="form-control mt-2"
              value={preferences.countries}
              onChange={(event) => onChange("countries", event.target.value)}
              placeholder="Germany, Canada"
              maxLength={300}
            />
          </div>
          <div>
            <label htmlFor="preference-languages" className="form-label">Preferred source languages</label>
            <input
              id="preference-languages"
              className="form-control mt-2"
              value={preferences.sourceLanguages}
              onChange={(event) => onChange("sourceLanguages", event.target.value)}
              placeholder="English, French"
              maxLength={200}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="preference-deadline" className="form-label">Deadline preference</label>
              <select
                id="preference-deadline"
                className="form-control form-select mt-2"
                value={preferences.deadline}
                onChange={(event) => onChange("deadline", event.target.value)}
              >
                <option value="">No preference</option>
                <option value="open">Any stated open deadline</option>
                <option value="30">Within 30 days</option>
                <option value="60">Within 60 days</option>
              </select>
            </div>
            <div>
              <label htmlFor="preference-duration" className="form-label">Minimum duration</label>
              <input
                id="preference-duration"
                type="number"
                min="1"
                max="120"
                inputMode="numeric"
                className="form-control mt-2"
                value={preferences.minimumDurationMonths}
                onChange={(event) => onChange("minimumDurationMonths", event.target.value)}
                placeholder="Months"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <CheckboxField
            id="preference-direct-application"
            checked={preferences.requireDirectApplication}
            onChange={(checked) => onChange("requireDirectApplication", checked)}
          >
            Require a separate direct application link
          </CheckboxField>
          <CheckboxField
            id="preference-official-source"
            checked={preferences.preferOfficialSource}
            onChange={(checked) => onChange("preferOfficialSource", checked)}
          >
            Prefer an institution-owned official source
          </CheckboxField>
        </div>

        <div className="mt-5 flex justify-end">
          <button type="button" className="secondary-button min-h-10" onClick={onClear}>
            Clear preferences
          </button>
        </div>
      </div>
    </details>
  );
}

export { EMPTY_PREFERENCES };
