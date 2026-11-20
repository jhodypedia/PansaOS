"use client";
import { useState } from "react";
import { Check, ChevronRight, Clock, Layers, Loader2, MoreHorizontal, Play, Settings, Shield, Trash2, X } from "lucide-react";

type Row = Record<string, unknown>;
type Api = (url: string, body?: unknown, method?: string) => Promise<unknown>;

export default function ProviderCard({ provider, api, onEdit, onChanged }: { provider: Row; api: Api; onEdit: () => void; onChanged: () => Promise<void> }) {
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const enabled = Boolean(provider.enabled);
  const protocol = { openai: "Chat Completions", responses: "Responses API", anthropic: "Anthropic Messages" }[String(provider.adapter)] ?? String(provider.adapter);
  const run = async (operation: "test" | "toggle" | "delete") => {
    if (pending) return;
    setPending(operation); setError(""); setNotice("");
    try {
      if (operation === "test") {
        const result = await api(`providers/${provider.id}/test`, {}) as { latency: number };
        setNotice(`Connection verified in ${Math.round(result.latency)} ms.`);
      } else if (operation === "toggle") {
        await api(`providers/${provider.id}`, { enabled: !enabled }, "PATCH");
        setNotice(enabled ? "Connection disabled." : "Connection enabled.");
      } else await api(`providers/${provider.id}`, undefined, "DELETE");
      await onChanged();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The action could not be completed."); }
    finally { setPending(""); }
  };
  return <article className={`provider-connection${enabled ? "" : " is-disabled"}`} aria-label={`${String(provider.name)} connection`}>
    <div className="provider-connection-head"><span className="provider-connection-icon"><Layers size={21} /></span><div className="provider-identity"><h2 title={String(provider.name)}>{String(provider.name)}</h2><span className="provider-protocol">{protocol}</span></div><span className={`connection-status ${enabled ? "enabled" : ""}`}><span />{enabled ? "Enabled" : "Disabled"}</span></div>
    <div className="provider-model-name"><code>{String(provider.model)}</code></div>
    <p className="provider-endpoint" title={String(provider.base_url)}>{String(provider.base_url)}</p>
    <div className="provider-security"><Shield size={12} /><span>{provider.api_key === "no key" ? "No API key" : "Encrypted API key"}</span>{Array.isArray(provider.configured_headers) && provider.configured_headers.length > 0 && <span className="provider-header-count">{provider.configured_headers.length} custom headers</span>}</div>
    <dl className="provider-metrics"><div><dt><Clock size={11} /> Latency</dt><dd>{Number(provider.latency) > 0 ? <>{Math.round(Number(provider.latency))}<small> ms</small></> : "Not tested"}</dd></div><div><dt>Success rate</dt><dd>{Number(provider.attempts) > 0 ? `${Math.round(Number(provider.successes) / Number(provider.attempts) * 100)}%` : "No traffic"}</dd></div><div><dt>Priority</dt><dd>{Number(provider.priority ?? 0)}</dd></div></dl>
    {error && <p className="connection-feedback is-error" role="alert"><X size={14} /><span>{error}</span></p>}
    {notice && <p className="connection-feedback" role="status"><Check size={14} /><span>{notice}</span></p>}
    {confirmDelete ? <div className="provider-delete-confirm"><p>Delete <strong>{String(provider.name)}</strong> and its saved credentials?</p><div><button className="btn danger" disabled={Boolean(pending)} onClick={() => void run("delete")}>{pending === "delete" ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} Delete connection</button><button className="btn" disabled={Boolean(pending)} onClick={() => setConfirmDelete(false)}>Cancel</button></div></div> : <div className="provider-connection-actions">
      <button className="btn" disabled={Boolean(pending)} onClick={onEdit} aria-label={`Edit ${String(provider.name)}`}><Settings size={14} /> Edit <ChevronRight size={12} className="provider-edit-arrow" /></button>
      <button className="btn" disabled={Boolean(pending)} onClick={() => void run("test")} aria-label={`Test connection: ${String(provider.name)}`}>{pending === "test" ? <Loader2 size={14} className="spin" /> : <Play size={13} />} Test connection</button>
      <details className="provider-action-menu" onToggle={event => {
        const details = event.currentTarget;
        if (!details.open) return;
        const summary = details.querySelector("summary")!.getBoundingClientRect();
        const menu = details.querySelector<HTMLElement>(".provider-menu-items")!;
        const bottom = window.visualViewport?.height ?? window.innerHeight;
        const above = summary.top - (document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0) - 10;
        const below = bottom - summary.bottom - 10;
        const side = above >= menu.scrollHeight ? "up" : below >= menu.scrollHeight ? "down" : above >= below ? "up" : "down";
        details.dataset.side = side;
        details.style.setProperty("--provider-menu-height", `${Math.max(70, side === "up" ? above : below)}px`);
      }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)) event.currentTarget.open = false; }} onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
        <summary aria-label={`More actions for ${String(provider.name)}`}><MoreHorizontal size={18} /></summary><div className="provider-menu-items"><button disabled={Boolean(pending)} onClick={event => { event.currentTarget.closest("details")!.open = false; void run("toggle"); }}>{pending === "toggle" ? <Loader2 size={14} className="spin" /> : <Layers size={14} />}{enabled ? "Disable connection" : "Enable connection"}</button><button disabled={Boolean(pending)} className="danger" onClick={event => { event.currentTarget.closest("details")!.open = false; setConfirmDelete(true); }}><Trash2 size={14} /> Delete connection</button></div>
      </details>
    </div>}
  </article>;
}
