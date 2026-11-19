"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Eye, EyeOff, Layers, Loader2, RefreshCw, Save, Shield, X } from "lucide-react";

type Row = Record<string, unknown>;
type Preset = { id: string; name: string; base_url: string; adapter: string; model: string; key_required: boolean; hint: string };
type Api = (url: string, body?: unknown, method?: string) => Promise<unknown>;
const defaults = { name: "", base_url: "", api_key: "", model: "", adapter: "openai", priority: 0, enabled: true, rate_limit: 60, cost_per_1k: 0, max_output_tokens: 4096, context_window: 32000, timeout_ms: 120000 };

export default function ProviderForm({ api, existing, onClose, onSaved }: { api: Api; existing?: Row; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ ...defaults, ...(existing ?? {}), api_key: "" } as typeof defaults);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selected, setSelected] = useState(existing ? "custom" : "openai");
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [showKey, setShowKey] = useState(false);
  const [replaceHeaders, setReplaceHeaders] = useState(!existing);
  const [headerRows, setHeaderRows] = useState([{ id: 0, name: "", value: "" }]);
  const [showHeaders, setShowHeaders] = useState(false);
  const [busy, setBusy] = useState("");
  const [failure, setFailure] = useState("");
  const [result, setResult] = useState<{ latency: number; preview: string } | null>(null);
  const [tested, setTested] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);
  const busyRef = useRef(busy);
  const closeRef = useRef(onClose);
  busyRef.current = busy; closeRef.current = onClose;
  const requestClose = () => {
    if (busyRef.current) return;
    if (dirty.current && !window.confirm("Discard your unsaved provider changes?")) return;
    closeRef.current();
  };
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const app = document.querySelector<HTMLElement>(".app");
    const previousInert = app?.inert ?? false;
    if (app) app.inert = true;
    document.body.style.overflow = "hidden";
    panel.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); requestClose(); }
      if (event.key !== "Tab") return;
      const elements = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href]') ?? []).filter(element => element.getClientRects().length);
      if (!elements.length) { event.preventDefault(); panel.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === elements[0] || document.activeElement === panel.current)) { event.preventDefault(); elements.at(-1)?.focus(); }
      else if (!event.shiftKey && (document.activeElement === elements.at(-1) || document.activeElement === panel.current)) { event.preventDefault(); elements[0]?.focus(); }
    };
    const resize = () => {
      if (panel.current) {
        const height = window.visualViewport?.height ?? window.innerHeight;
        panel.current.style.setProperty("--provider-viewport-height", `${height}px`);
        panel.current.dataset.compact = String(height < 560);
      }
    };
    resize(); window.visualViewport?.addEventListener("resize", resize);
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("keydown", keydown, true);
    return () => { document.body.style.overflow = previousOverflow; if (app) app.inert = previousInert; document.removeEventListener("keydown", keydown, true); window.visualViewport?.removeEventListener("resize", resize); window.removeEventListener("beforeunload", beforeUnload); previousFocus?.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    if (failure || result) panel.current?.querySelector<HTMLElement>(".provider-feedback")?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [failure, result]);
  useEffect(() => {
    let active = true;
    void api("providers/presets").then(value => {
      if (!active) return;
      const items = value as Preset[]; setPresets(items);
      if (!existing && items[0]) setForm(previous => ({ ...previous, name: items[0]!.name, base_url: items[0]!.base_url, model: items[0]!.model, adapter: items[0]!.adapter }));
    }).catch(error => { if (active) setFailure(error.message); });
    return () => { active = false; };
  }, [api, existing]);
  const payload = { ...form, custom_headers: replaceHeaders ? Object.fromEntries(headerRows.filter(row => row.name.trim()).map(row => [row.name.trim(), row.value])) : undefined, priority: Number(form.priority), rate_limit: Number(form.rate_limit), cost_per_1k: Number(form.cost_per_1k), max_output_tokens: Number(form.max_output_tokens), context_window: Number(form.context_window), timeout_ms: Number(form.timeout_ms), enabled: Boolean(form.enabled) };
  const signature = JSON.stringify(payload);
  const prefix = existing ? `providers/${existing.id}` : "providers";
  const update = (name: keyof typeof defaults, value: string | number | boolean) => { dirty.current = true; setForm(previous => ({ ...previous, [name]: value })); setResult(null); setFailure(""); };
  const run = async (operation: "models" | "test" | "save") => {
    if (busyRef.current) return;
    busyRef.current = operation;
    setBusy(operation); setFailure("");
    try {
      if (!form.base_url || !/^https?:\/\//.test(form.base_url)) throw new Error("Enter an HTTP(S) API base URL.");
      if (!form.name.trim()) throw new Error("Give this connection a name.");
      if (replaceHeaders) {
        const names = new Set<string>();
        for (const row of headerRows) {
          if (!row.name.trim() && row.value) throw new Error("Enter a name for every header value.");
          if (!row.name.trim()) continue;
          const name = row.name.trim().toLowerCase();
          if (names.has(name)) throw new Error("Duplicate header names are not allowed.");
          names.add(name);
        }
      }
      if (operation !== "models" && !form.model.trim()) throw new Error("Choose or enter a model ID.");
      if (operation === "models") {
        const response = await api(`${prefix}/models`, { ...payload, model: payload.model || "discovery" }) as { models: { id: string; name: string }[] };
        setModels(response.models);
        if (!response.models.length) throw new Error("No models were returned. Enter a model ID manually.");
      } else if (operation === "test") {
        const response = await api(`${prefix}/validate`, payload) as { latency: number; preview: string };
        setResult(response); setTested(signature);
      } else {
        await api(existing ? prefix : "providers", payload, existing ? "PATCH" : "POST");
        await onSaved(); onClose();
      }
    } catch (error) { setFailure(error instanceof Error ? error.message : "The request could not be completed."); }
    finally { busyRef.current = ""; setBusy(""); }
  };
  const preset = presets.find(item => item.id === selected);
  if (typeof document === "undefined") return null;
  return createPortal(<div className="provider-dialog-backdrop" onClick={event => { if (event.target === event.currentTarget) requestClose(); }}>
    <div className="provider-editor" ref={panel} role="dialog" aria-modal="true" aria-labelledby="provider-editor-title" tabIndex={-1}>
    <div className="provider-editor-heading"><div><span className="decision-eyebrow"><Layers size={14} /> MODEL CONNECTION</span><h2 id="provider-editor-title">{existing ? "Edit provider" : "Connect an AI provider"}</h2><p>Configure, test, and save your model connection.</p></div><button type="button" className="btn provider-close" onClick={requestClose} disabled={Boolean(busy)} aria-label="Close provider editor"><X size={19} /></button></div>
    <form aria-busy={Boolean(busy)} onSubmit={event => { event.preventDefault(); void run("save"); }} onChange={() => { dirty.current = true; }} onInvalidCapture={event => { const field = event.target as HTMLInputElement; field.closest("details")?.setAttribute("open", ""); field.scrollIntoView({ block: "center" }); }}>
      <div className="provider-editor-scroll">
      <fieldset disabled={Boolean(busy)}>
        <label className="provider-field">Provider preset<select value={selected} onChange={event => { const item = presets.find(entry => entry.id === event.target.value); setSelected(event.target.value); setModels([]); setResult(null); setTested(""); setReplaceHeaders(true); setHeaderRows([{ id: 0, name: "", value: "" }]); if (item) setForm(previous => ({ ...previous, name: item.id === "custom" ? previous.name : item.name, base_url: item.base_url, adapter: item.adapter, model: item.model, api_key: "" })); }}>{presets.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><small>{preset?.hint}</small></label>
        <div className="provider-fields">
          <label className="provider-field">Connection name<input required maxLength={100} value={form.name} onChange={event => update("name", event.target.value)} placeholder="My primary provider" /></label>
          <label className="provider-field">API protocol<select value={form.adapter} onChange={event => { update("adapter", event.target.value); setModels([]); }}><option value="openai">OpenAI-compatible · Chat Completions</option><option value="responses">OpenAI · Responses API</option><option value="anthropic">Anthropic · Messages API</option></select></label>
          <label className="provider-field provider-field-wide">API base URL<input type="url" required value={form.base_url} onChange={event => { update("base_url", event.target.value); setModels([]); }} placeholder="https://api.example.com/v1" /><small>Use the API root, without /chat/completions, /responses, or /messages. Local addresses refer to the server running PansaOS.</small></label>
          <label className="provider-field provider-field-wide">API key {existing ? "· leave blank to keep the saved key" : preset?.key_required ? "· required by this provider" : "· optional for local endpoints"}<div className="provider-key"><input type={showKey ? "text" : "password"} autoComplete="off" spellCheck={false} value={form.api_key} onChange={event => { update("api_key", event.target.value); setModels([]); }} placeholder={existing ? "Keep existing encrypted key" : "Enter your API key"} /><button type="button" className="btn" aria-label={showKey ? "Hide API key" : "Show API key"} onClick={() => setShowKey(value => !value)}>{showKey ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></label>
          <label className="provider-field provider-field-wide">Model ID<div className="provider-model"><input required list="provider-discovered-models" value={form.model} onChange={event => update("model", event.target.value)} placeholder="Enter an exact model ID or discover available models" /><button type="button" className="btn" onClick={() => void run("models")} disabled={!form.base_url}>{busy === "models" ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Discover models</button></div><datalist id="provider-discovered-models">{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</datalist><small>{models.length ? `${models.length} models found. Type to filter or enter a model ID manually.` : "Select a model that supports tool calling for agent tasks. Preset model IDs are suggestions; availability depends on your account."}</small></label>
        </div>
        <details className="provider-advanced">
          <summary><ChevronDown size={14} /> Custom request headers{Array.isArray(existing?.configured_headers) && !replaceHeaders ? ` (${existing.configured_headers.length} saved)` : ""}</summary>
          <p className="provider-header-help">Add headers required by your provider, such as User-Agent, OpenAI-Beta, or X-API-Key. They apply to model discovery and completion requests and are encrypted at rest. Custom headers override generated authentication headers with the same name.</p>
          {existing && <><p className="provider-header-help">Saved headers: {(existing.configured_headers as string[] ?? []).join(", ") || "none"}. Saved values are never returned to the browser.</p><label className="provider-enabled"><input type="checkbox" checked={replaceHeaders} onChange={event => { setReplaceHeaders(event.target.checked); setResult(null); }} /> Replace all saved headers</label></>}
          {replaceHeaders && <><p className="provider-header-help">Only the headers listed below will be saved. An empty list removes custom headers.</p>{headerRows.map((row, index) => <div className="provider-header-row" key={row.id}>
            <input aria-label={`Header name ${index + 1}`} placeholder="Header name" value={row.name} maxLength={128} onChange={event => { setHeaderRows(previous => previous.map(item => item.id === row.id ? { ...item, name: event.target.value } : item)); setResult(null); }} />
            <input aria-label={`Header value ${index + 1}`} type={showHeaders ? "text" : "password"} autoComplete="off" spellCheck={false} placeholder="Header value" value={row.value} maxLength={8192} onChange={event => { setHeaderRows(previous => previous.map(item => item.id === row.id ? { ...item, value: event.target.value } : item)); setResult(null); }} />
            <button type="button" className="btn" aria-label={`Remove header ${index + 1}`} onClick={() => { setHeaderRows(previous => previous.filter(item => item.id !== row.id)); setResult(null); }}><X size={14} /></button>
          </div>)}<div className="provider-header-actions"><button type="button" className="btn" disabled={headerRows.length >= 32} onClick={() => setHeaderRows(previous => [...previous, { id: Math.max(-1, ...previous.map(row => row.id)) + 1, name: "", value: "" }])}>Add header</button><button type="button" className="btn" onClick={() => setShowHeaders(value => !value)}>{showHeaders ? <EyeOff size={14} /> : <Eye size={14} />}{showHeaders ? "Hide values" : "Show values"}</button></div></>}
        </details>
        <details className="provider-advanced"><summary><ChevronDown size={14} /> Advanced configuration</summary><div className="provider-fields">{([
          ["priority", "Fallback priority", "Lower numbers are tried first.", -1000, 1000, 1],
          ["rate_limit", "Requests per minute", "Local request limit for this connection.", 1, 100000, 1],
          ["max_output_tokens", "Maximum output tokens", "Sent with each completion request.", 16, 200000, 1],
          ["context_window", "Context window (tokens)", "Used for context usage estimates and compaction.", 1024, 10000000, 1],
          ["timeout_ms", "Request timeout (milliseconds)", "Maximum duration of one provider request.", 5000, 600000, 1000],
          ["cost_per_1k", "Estimated USD per 1K tokens", "Blended estimate. Zero means cost is unknown.", 0, 10000, 0.000001],
        ] as const).map(([name, label, hint, min, max, step]) => <label className="provider-field" key={name}>{label}<input required type="number" min={min} max={max} step={step} value={form[name]} onChange={event => update(name, event.target.value)} /><small>{hint}</small></label>)}</div></details>
        <label className="provider-enabled"><input type="checkbox" checked={Boolean(form.enabled)} onChange={event => update("enabled", event.target.checked)} /> Enable this provider for automatic selection and failover</label>
      </fieldset>
      {failure && <div role="alert" className="provider-feedback error">{failure}</div>}
      {result && tested === signature && <div role="status" className="provider-feedback success"><Check size={16} /><div>Connection verified · {result.latency} ms<small>{result.preview}</small></div></div>}
      </div>
      <div className="provider-editor-footer"><p><Shield size={14} /> Credentials are encrypted. Connection tests may incur provider usage.</p><div><button className="btn" type="button" disabled={Boolean(busy)} onClick={() => void run("test")}>{busy === "test" ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} {busy === "test" ? "Testing…" : "Test connection"}</button><button type="submit" className="btn primary" disabled={Boolean(busy)}>{busy === "save" ? <Loader2 size={14} className="spin" /> : <Save size={14} />} {busy === "save" ? "Saving…" : existing ? "Save changes" : "Save provider"}</button></div></div>
    </form>
  </div></div>, document.body);
}
