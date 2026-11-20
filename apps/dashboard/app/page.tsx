"use client";
import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ProviderForm from "./provider-form";
import ProviderCard from "./provider-card";
import TelegramSettingsPanel from "./telegram-settings";
import { mergeChatEvents, readChatSession, rememberChatSession, restoreChatSession } from "./chat-session";
import {
  motion,
  AnimatePresence,
  useReducedMotion,
  useAnimationFrame,
} from "framer-motion";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Code2,
  Command,
  Copy,
  Cpu,
  DollarSign,
  Download,
  ExternalLink,
  FileText,
  Gauge,
  Github,
  Globe,
  Layers,
  LayoutDashboard,
  Loader2,
  LogOut,
  MemoryStick,
  Menu,
  MessageSquare,
  Moon,
  MoreHorizontal,
  Network,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Send,
  Server,
  Settings,
  Shield,
  Sparkles,
  Square,
  Sun,
  Terminal,
  Trash2,
  Workflow,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { dictionaries } from "./i18n";
type Row = Record<string, unknown>;
type Tab = keyof typeof dictionaries.id;
const tabs = [
  ["overview", LayoutDashboard],
  ["live", Radio],
  ["chat", MessageSquare],
  ["providers", Layers],
  ["sessions", Terminal],
  ["files", FileText],
  ["tools", Wrench],
  ["skills", BookOpen],
  ["memory", MemoryStick],
  ["schedules", Clock],
  ["settings", Settings],
] as const;
const pageDescriptions: Partial<Record<Tab, string>> = {
  overview: "Your personal assistant, activity, and memory in one workspace.",
  live: "Follow your assistant's activity and inspect the details that matter.",
  chat: "A clear conversation, with your assistant's work just a tap away.",
  providers: "Connect models, manage credentials, and keep your assistant running.",
  sessions: "Pick up a conversation or make room for your next idea.",
  files: "Explore the files in your selected session's workspace.",
  tools: "Choose which tools your assistant can use.",
  skills: "Give your assistant instructions for the work you do most.",
  memory: "Review, organize, and refine what your assistant remembers.",
  schedules: "Manage recurring tasks and review their activity.",
  settings: "Make your workspace, preferences, and assistant your own.",
};
function IntelligenceOrb() {
  return <div className="intelligence-orb" aria-hidden="true">
    <div className="orb-halo" />
    <div className="orb-ring orb-ring-one" /><div className="orb-ring orb-ring-two" /><div className="orb-ring orb-ring-three" />
    <div className="orb-core"><Command size={44} strokeWidth={1.2} /></div>
    <span className="orb-satellite satellite-one"><MemoryStick size={16} /></span>
    <span className="orb-satellite satellite-two"><MessageSquare size={16} /></span>
    <span className="orb-satellite satellite-three"><Zap size={16} /></span>
  </div>;
}
function QuestionCard({ question, onAnswer }: { question: Row; onAnswer: (answer: string) => Promise<unknown> }) {
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState("");
  const select = async (value: string) => {
    if (sending || submitted || !value.trim()) return;
    setSending(true); setFailure("");
    try { await onAnswer(value); setSubmitted(true); }
    catch (error) { setFailure(error instanceof Error ? error.message : "Your answer could not be saved"); }
    finally { setSending(false); }
  };
  const details = question.details as { label: string; description?: string }[] | undefined;
  const options = details ?? (question.options as string[] ?? []).map(label => ({ label, description: "" }));
  return <section className="decision-card" aria-label="Question from Pansa">
    <div className="decision-eyebrow"><MessageSquare size={14} /> {submitted ? "ANSWER SAVED" : "YOUR CHOICE"}<span><Clock size={12} /> 5 minutes</span></div>
    <h3>{String(question.question)}</h3>
    {submitted ? <p className="decision-success"><Check size={15} /> Thank you. Pansa is continuing your task.</p> : <>
      <div className="decision-options">{options.map((option, index) => <button key={option.label} disabled={sending} onClick={() => void select(option.label)}><span className="decision-number">{index + 1}</span><span><strong>{option.label}{question.default === option.label && <small>Default</small>}</strong>{option.description && <p>{option.description}</p>}</span><ArrowUpRight size={15} /></button>)}</div>
      {question.allow_free !== false && <form className="decision-free" onSubmit={event => { event.preventDefault(); void select(answer); }}><input aria-label="Your own answer" placeholder="Or write your own answer…" value={answer} onChange={event => setAnswer(event.target.value)} maxLength={4000} disabled={sending} /><button className="btn" disabled={sending || !answer.trim()} aria-label="Submit answer">{sending ? <Loader2 size={15} className="spin" /> : <ArrowRight size={15} />}</button></form>}
      <p className="decision-note">{question.default ? `If unanswered, ${String(question.default)} will be selected automatically.` : "The task will stop if no answer is received within 5 minutes."}</p>
    </>}
    {failure && <p className="error" role="alert">{failure}</p>}
  </section>;
}
function CodeBlock({ children }: { children?: React.ReactNode }) {
  const pre = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (reset.current) clearTimeout(reset.current); }, []);
  return <div className="code-shell"><div className="code-header"><span><Code2 size={12} /> CODE</span><button type="button" onClick={async () => {
    try { await navigator.clipboard.writeText(pre.current?.textContent ?? ""); setCopied(true); setFailed(false); }
    catch { setFailed(true); }
    if (reset.current) clearTimeout(reset.current);
    reset.current = setTimeout(() => { setCopied(false); setFailed(false); }, 2000);
  }}>{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "Copied" : failed ? "Select and copy manually" : "Copy code"}</button></div><pre className="code-block" ref={pre}>{children}</pre></div>;
}
function Rich({ text }: { text: string }) {
  return <div className="rich-content"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
    a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
    table: ({ children }) => <div className="rich-table"><table>{children}</table></div>,
    img: ({ alt }) => <span className="muted">{alt || "Image"}</span>,
  }}>{text}</ReactMarkdown></div>;
}
const binaryFile = (name: string) => /\.(?:pdf|docx?|xlsx?|pptx?|odt|ods|odp|zip|tar|gz|7z|rar|png|jpe?g|gif|webp|bmp|ico|mp[34]|wav|ogg|webm|woff2?|ttf|otf|sqlite|db)$/i.test(name);
const fileSize = (size: number) => size < 1024 ? `${size} B` : size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MB`;
function ActionBlock({
  e,
  onOpen,
}: {
  e: Row;
  onOpen?: () => void;
}) {
  const d = (typeof e.data === "string" ? JSON.parse(e.data) : e.data) as Row;
  const name = String(d.tool ?? d.name ?? "tool");
  const ok = d.status === "done";
  const bad = d.status === "error";
  const label = String(d.command ?? d.content ?? name);
  const output = String(d.output ?? d.tail ?? d.error ?? "");
  const json = useMemo(() => {
    if (!output.trim()) return null;
    try {
      const parsed = JSON.parse(output.endsWith("…") ? output.slice(0, -1) : output);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }, [output]);
  const summary = useMemo(() => {
    if (!json) return null;
    const rows = Object.entries(json as Record<string, unknown>)
      .slice(0, 6)
      .map(([k, v]) => {
        const text =
          typeof v === "string"
            ? v
            : typeof v === "number" || typeof v === "boolean"
              ? String(v)
              : Array.isArray(v)
                ? `[${v.length}]`
                : "object";
        return [k, text.length > 90 ? `${text.slice(0, 90)}…` : text] as const;
      })
      .filter(([, v]) => v !== "");
    return rows.length ? rows : null;
  }, [json]);
  return (
    <details className={`action ${bad ? "bad" : ok ? "ok" : "running"}`}>
      <summary>
        <span className="action-icon">
          {bad ? <X size={11} /> : ok ? <Check size={11} /> : <RefreshCw size={11} className="spin" />}
        </span>
        <code className="action-cmd">{label.length > 160 ? `${label.slice(0, 160)}…` : label}</code>
        <span className="action-meta">
          {d.durationMs !== undefined && `${Number(d.durationMs)} ms`}
          {d.exitCode !== undefined && ` · exit ${String(d.exitCode)}`}
        </span>
      </summary>
      {summary && (
        <dl className="action-summary">
          {summary.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd title={v}>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {json && typeof (json as Row).diff === "string" && <pre className="action-out diff-preview">{String((json as Row).diff)}</pre>}
      {output ? (
        summary ? (
          <details className="action-raw">
            <summary>Raw output</summary>
            <pre className="action-out">{output.length > 3000 ? `${output.slice(0, 3000)}\n…` : output}</pre>
          </details>
        ) : (
          <pre className="action-out">{output.length > 3000 ? `${output.slice(0, 3000)}\n…` : output}</pre>
        )
      ) : (
        <p className="muted text-xs mt-2">No output yet.</p>
      )}
      {onOpen && (
        <button className="btn mt-2" onClick={onOpen}>
          <Terminal size={11} /> Open in Console
        </button>
      )}
    </details>
  );
}
const LOOP_PATH =
  "M100 55 H300 Q324 55 324 79 V121 Q324 145 300 145 H100 Q76 145 76 121 V79 Q76 55 100 55 Z";

function FlowDiagram({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  const wrap = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const dots = useRef<(HTMLSpanElement | null)[]>([]);
  const nodes = useRef<(HTMLDivElement | null)[]>([]);
  const box = useRef({ w: 0, h: 0 });
  const pos = useRef(0);
  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      box.current = {
        w: entry.contentRect.width,
        h: entry.contentRect.height,
      };
    });
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (reduced) return;
    let i = 0;
    const id = setInterval(() => {
      nodes.current.forEach((n, k) => n?.classList.toggle("glow", k === i));
      i = (i + 1) % 4;
    }, 900);
    return () => {
      clearInterval(id);
      nodes.current.forEach((n) => n?.classList.remove("glow"));
    };
  }, [reduced]);
  useAnimationFrame((_, delta) => {
    const path = pathRef.current;
    if (reduced || !path || document.hidden) return;
    const len = path.getTotalLength();
    if (!len) return;
    pos.current = (pos.current + delta * (active ? 0.09 : 0.035)) % len;
    const { w, h } = box.current;
    dots.current.forEach((dot, i) => {
      if (!dot) return;
      const p = path.getPointAtLength((pos.current - i * 12 + len * 2) % len);
      dot.style.transform = `translate3d(${(p.x / 400) * w}px, ${(p.y / 200) * h}px, 0) translate(-50%, -50%)`;
      dot.style.opacity = String(1 - i * 0.3);
    });
  });
  return (
    <div className={`diagram loop compact${active ? " active" : ""}`} ref={wrap}>
      <svg
        className="loop-path"
        viewBox="0 0 400 200"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="loop-flow" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--violet)" />
            <stop offset="50%" stopColor="var(--cyan)" />
            <stop offset="100%" stopColor="var(--ok, #37d67a)" />
          </linearGradient>
        </defs>
        <path ref={pathRef} d={LOOP_PATH} className="loop-base" />
        <path d={LOOP_PATH} className="loop-trace" stroke="url(#loop-flow)" />
        <path d={LOOP_PATH} className="loop-ants" stroke="url(#loop-flow)" />
      </svg>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="flow-dot"
          ref={(el) => {
            dots.current[i] = el;
          }}
        />
      ))}
      {[
        [Send, "Telegram"],
        [Command, "Pansa Core"],
        [Layers, "Provider"],
        [Wrench, "Tools"],
      ].map(([Icon, label], i) => {
        const I = Icon as typeof Activity;
        return (
          <div
            className="node"
            key={String(label)}
            style={{ "--node-x": i < 2 ? (i === 0 ? "30%" : "70%") : (i === 2 ? "70%" : "30%"), "--node-y": i < 2 ? "25%" : "75%" } as React.CSSProperties}
            ref={(el) => {
              nodes.current[i] = el;
            }}
          >
            <div className="node-icon">
              <I size={i === 1 ? 25 : 19} />
            </div>
            <span>{String(label)}</span>
          </div>
        );
      })}
      <span className="diagram-label">
        Telegram → Core → Provider → Tools → Telegram
      </span>
    </div>
  );
}
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];
function shorten(text: string, max = 40) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}
const DEFAULT_TIMEZONE = "UTC";
const FALLBACK_ZONES = [
  "Asia/Jakarta",
  "Asia/Makassar",
  "Asia/Jayapura",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Australia/Perth",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "UTC",
];
function zoneList() {
  const native =
    typeof Intl.supportedValuesOf === "function"
      ? (Intl.supportedValuesOf("timeZone") as string[])
      : [];
  const merged = new Set<string>([DEFAULT_TIMEZONE, ...FALLBACK_ZONES, ...native]);
  return [...merged].sort((a, b) => a.localeCompare(b, "en"));
}
function zoneLabel(zone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "short",
    }).formatToParts(new Date());
    const abbr = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    const offset =
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        timeZoneName: "shortOffset",
      })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")
        ?.value ?? "";
    const shown = offset.replace(/^GMT/, "UTC").replace(/^UTC$/, "UTC+0");
    return abbr && abbr !== shown ? `${abbr}, ${shown}` : shown;
  } catch {
    return "";
  }
}
function parseStamp(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return new Date(value);
  const raw = String(value).trim();
  if (!raw) return null;
  const naive = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(raw);
  if (naive) return new Date(`${raw.replace(" ", "T")}Z`);
  return new Date(raw);
}
function fmtTime(
  value: unknown,
  zone: string,
  opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" },
) {
  const stamp = parseStamp(value);
  if (!stamp || Number.isNaN(stamp.getTime())) return "";
  try {
    return stamp.toLocaleTimeString("en-GB", { ...opts, timeZone: zone });
  } catch {
    return stamp.toLocaleTimeString("en-GB", opts);
  }
}
function fmtDate(value: unknown, zone: string, opts?: Intl.DateTimeFormatOptions) {
  const stamp = parseStamp(value);
  if (!stamp || Number.isNaN(stamp.getTime())) return "";
  const format: Intl.DateTimeFormatOptions = opts ?? {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  try {
    return stamp.toLocaleString("en-GB", { ...format, timeZone: zone });
  } catch {
    return stamp.toLocaleString("en-GB", format);
  }
}
function shortDate(raw: string, zone: string) {
  const stamp = parseStamp(raw);
  if (!stamp || Number.isNaN(stamp.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      day: "numeric",
      month: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(stamp);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "0";
    return `${Number(get("day"))} ${MONTHS[Number(get("month")) - 1]} ${get("hour")}:${get("minute")}`;
  } catch {
    return "";
  }
}
function SessionPicker({
  sessions,
  value,
  onChange,
  zone = DEFAULT_TIMEZONE,
  disabled = false,
}: {
  sessions: Row[];
  value: string;
  onChange: (id: string) => void;
  zone?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0),
    [pos, setPos] = useState({ top: 0, left: 0, width: 240, max: 320 });
  const trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const options = useMemo(
    () => [
      { id: "", label: "New session", meta: "", fresh: true },
      ...sessions.map((s) => ({
        id: String(s.id),
        label: shorten(String(s.title ?? "")),
        meta: shortDate(String(s.created_at ?? ""), zone),
        fresh: false,
      })),
    ],
    [sessions, zone],
  );
  const current = options.find((o) => o.id === value) ?? {
    id: value,
    label: "Session unavailable",
    meta: "",
    fresh: false,
  };
  const place = useCallback(() => {
    const node = trigger.current;
    if (!node) return;
    const r = node.getBoundingClientRect(),
      width = Math.min(Math.max(r.width, 240), window.innerWidth - 32),
      left = Math.min(Math.max(12, r.left), window.innerWidth - width - 12),
      room = window.innerHeight - r.bottom - 20;
    const above = room < 180 && r.top > room;
    const max = Math.min(320, Math.max(140, above ? r.top - 20 : room));
    setPos({
      top: above ? r.top - 6 - max : r.bottom + 6,
      left,
      width,
      max,
    });
  }, []);
  const close = useCallback((focus?: boolean) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.id === value)));
    menu.current?.focus({ preventScroll: true });
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !trigger.current?.contains(t))
        setOpen(false);
    };
    const resize = () => place();
    document.addEventListener("mousedown", outside);
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", resize, true);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", resize, true);
    };
  }, [open, options, value, place]);
  const pick = (index: number) => {
    const option = options[index];
    if (!option || disabled) return;
    onChange(option.id);
    close(true);
  };
  return (
    <div className="session-picker">
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        className="session-trigger"
        aria-label="Session"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          place();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            place();
            setOpen(true);
          }
        }}
      >
        {current.fresh ? (
          <Plus size={13} className="lead" />
        ) : (
          <MessageSquare size={13} className="lead" />
        )}
        <span className="session-title">{current.label}</span>
        <ChevronDown size={13} className="chev" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className="session-menu"
            role="listbox"
            aria-label="Session list"
            tabIndex={-1}
            style={{
              top: pos.top,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.max,
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                close(true);
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => (i + 1) % options.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => (i - 1 + options.length) % options.length);
              } else if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                pick(active);
              }
            }}
          >
            {options.map((option, index) => (
              <Fragment key={option.id || "new"}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.id === value}
                  className={`session-item${option.fresh ? " new" : ""}${
                    index === active ? " active" : ""
                  }${option.id === value ? " on" : ""}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(index)}
                >
                  {option.fresh ? (
                    <Plus size={13} />
                  ) : (
                    <span className="session-dot" />
                  )}
                  <span className="session-item-main">
                    <span className="session-item-title">{option.label}</span>
                    {option.meta && (
                      <span className="session-item-meta">{option.meta}</span>
                    )}
                  </span>
                  {option.id === value && (
                    <Check size={13} className="session-check" />
                  )}
                </button>
                {option.fresh && <div className="session-sep" />}
              </Fragment>
            ))}
            {!sessions.length && (
              <div className="session-empty">No saved sessions yet.</div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
function Counter({ value }: { value: number }) {
  const [n, setN] = useState(value);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) {
      setN(value);
      return;
    }
    const start = performance.now(),
      from = n;
    let id = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 650);
      setN(from + (value - from) * (1 - (1 - p) ** 3));
      if (p < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [value, reduced]);
  return (
    <>
      {n >= 1000
        ? `${(n / 1000).toFixed(1)}k`
        : Number.isInteger(value)
          ? Math.round(n).toLocaleString()
          : n.toFixed(3)}
    </>
  );
}
export default function Dashboard() {
  const reducedMotion = useReducedMotion();
  const [mobileViewport, setMobileViewport] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const [token, setToken] = useState(""),
    [logged, setLogged] = useState(false),
    [tab, setTab] = useState<Tab>("overview"),
    [lang, setLang] = useState<"id" | "en">("en"),
    [theme, setTheme] = useState<"dark" | "light">("dark"),
    [navOpen, setNavOpen] = useState(false);
  const [profileDocs, setProfileDocs] = useState<Record<string, string>>({ soul: "", user: "", memory: "" });
  const [memoryEdit, setMemoryEdit] = useState<Record<string, { key: string; content: string }>>({});
  useEffect(() => {
    const syncViewport = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--workspace-viewport-height", `${height}px`);
      const field = document.activeElement;
      const editing = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement;
      document.documentElement.dataset.keyboardOpen = String(editing && window.innerHeight - height > 120);
    };
    syncViewport(); window.addEventListener("resize", syncViewport); window.visualViewport?.addEventListener("resize", syncViewport); document.addEventListener("focusin", syncViewport); document.addEventListener("focusout", syncViewport);
    return () => { window.removeEventListener("resize", syncViewport); window.visualViewport?.removeEventListener("resize", syncViewport); document.removeEventListener("focusin", syncViewport); document.removeEventListener("focusout", syncViewport); document.documentElement.style.removeProperty("--workspace-viewport-height"); delete document.documentElement.dataset.keyboardOpen; };
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const sync = () => { setMobileViewport(media.matches); if (!media.matches) setNavOpen(false); };
    sync(); media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (!navOpen || !mobileViewport) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusables = () => Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)") ?? []);
    focusables()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusables();
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", trap); previousFocus?.focus(); };
  }, [navOpen, mobileViewport]);
  useEffect(() => {
    const saved = window.localStorage.getItem("pansa-theme");
    const prefers = window.matchMedia("(prefers-color-scheme: light)").matches;
    setTheme(saved === "light" || saved === "dark" ? saved : prefers ? "light" : "dark");
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("pansa-theme", theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const t = dictionaries[lang];
  const [events, setEvents] = useState<Row[]>([]),
    [providers, setProviders] = useState<Row[]>([]),
    [sessions, setSessions] = useState<Row[]>([]),
    [stats, setStats] = useState<Row>({}),
    [items, setItems] = useState<Row[]>([]),
    [approvals, setApprovals] = useState<Row[]>([]),
    [connected, setConnected] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [session, setSession] = useState(""),
    [stopped, setStopped] = useState<Record<string, number>>({}),
    [zone, setZone] = useState<string>(DEFAULT_TIMEZONE),
    [pageSize, setPageSize] = useState(50),
    [pageNo, setPageNo] = useState(1),
    [pageRows, setPageRows] = useState<Row[]>([]),
    [pageCache, setPageCache] = useState<Record<number, Row[]>>({}),
    [pageBusy, setPageBusy] = useState(false),
    [pending, setPending] = useState(0),
    [hasMore, setHasMore] = useState(false),
    [totalEvents, setTotalEvents] = useState<number | null>(null),
    [prompt, setPrompt] = useState(""),
    [stream, setStream] = useState(""),
    [view, setView] = useState<"chat" | "console">("chat"),
    [stick, setStick] = useState(true),
    [query, setQuery] = useState(""),
    [markdown, setMarkdown] = useState(""),
    [showForm, setShowForm] = useState(false),
    [files, setFiles] = useState<{ name: string; directory: boolean }[]>([]),
    [filePath, setFilePath] = useState("."),
    [fileContent, setFileContent] = useState(""),
    [editing, setEditing] = useState(""),
    [settings, setSettings] = useState({
      max_steps: 60,
      timezone: DEFAULT_TIMEZONE,
    }),
    [settingsInfo, setSettingsInfo] = useState<Row>({}),
    [schedule, setSchedule] = useState({ cron: "0 9 * * *", prompt: "" });
  const [providerEditing, setProviderEditing] = useState<Row | undefined>();
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionMissing, setSessionMissing] = useState(false);
  const [filesSession, setFilesSession] = useState("");
  const [scheduleSession, setScheduleSession] = useState("");
  const sessionRef = useRef("");
  const selectionRestored = useRef(false);
  const sending = useRef(false);
  const [providerQuery, setProviderQuery] = useState("");
  const [draftProvider, setDraftProvider] = useState("");
  const [draftMode, setDraftMode] = useState("build");
  const [providerFilter, setProviderFilter] = useState("all");
  const buffer = useRef("");
  const ticker = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const fileUploadRef = useRef<HTMLInputElement>(null);
  const memoryImportRef = useRef<HTMLInputElement>(null);
  const followLatest = useRef(true);
  const pageRef = useRef(1);
  const sizeRef = useRef(50);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    pageRef.current = pageNo;
  }, [pageNo]);
  useEffect(() => {
    sizeRef.current = pageSize;
  }, [pageSize]);
  const api = useCallback(
    async (url: string, body?: unknown, method?: string) => {
      const response = await fetch(`/api/${url}`, {
        method: method ?? (body ? "POST" : "GET"),
        credentials: "include",
        ...(body !== undefined
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      });
      const data: unknown = await response.json().catch(() => ({}));
      const message = (data as { error?: string }).error;
      if (response.status === 401) {
        if (url !== "auth" && url !== "auth/session") setLogged(false);
        throw new Error(
          message ?? "Your session expired. Sign in again with your admin token.",
        );
      }
      if (!response.ok) {
        const fields = (data as { fields?: { path: string; message: string }[] }).fields;
        throw new Error(fields?.length ? fields.map(field => `${field.path}: ${field.message}`).join(" · ") : message ?? "Request failed");
      }
      return data;
    },
    [],
  );
  const notify = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(""), 4500);
  };
  const [sessionState, setSessionState] = useState<Row>({});
  const [showArchive, setShowArchive] = useState(false);
  const [commandList, setCommandList] = useState<{ name: string; description: string }[]>([]);
  const [mcpServers, setMcpServers] = useState<Row[]>([]);
  const [mcpForm, setMcpForm] = useState({ name: "", transport: "http", url: "", command: "", args: "", headers: "" });
  const applyChatSession = useCallback((id: string) => {
    sessionRef.current = id;
    setSession(id);
    setSessionMissing(false);
    setSessionReady(true);
    selectionRestored.current = true;
    try { rememberChatSession(id, window.sessionStorage, window.localStorage); } catch {}
    setSessionState({});
    setStream("");
    buffer.current = "";
    if (ticker.current) { clearTimeout(ticker.current); ticker.current = null; }
    followLatest.current = true;
    setStick(true);
  }, []);
  const chooseChatSession = (id: string) => {
    if (sending.current) return;
    applyChatSession(id);
  };
  useEffect(() => {
    if (!logged) { selectionRestored.current = false; setSessionReady(false); }
  }, [logged]);
  useEffect(() => {
    if (!logged) return;
    let active = true;
    void api("commands").then(r => setCommandList(r as { name: string; description: string }[])).catch(() => {});
    const load = () => {
      if (session) void api(`sessions/${session}/state`).then(r => { if (active && sessionRef.current === session) setSessionState(r as Row); }).catch(() => {});
      void api("mcp").then(r => { if (active) setMcpServers(r as Row[]); }).catch(() => {});
    };
    load(); const timer = setInterval(load, 3000); return () => { active = false; clearInterval(timer); };
  }, [logged, session, api]);
  const refresh = useCallback(async () => {
    const [e, p, s, st, a] = await Promise.all([
      api("events?hide=token"),
      api("providers"),
      api("sessions"),
      api("stats"),
      api("approvals"),
    ]);
    if (!selectionRestored.current) {
      let remembered = "";
      try { remembered = readChatSession(window.sessionStorage, window.localStorage); } catch {}
      const restored = restoreChatSession(remembered, s as Row[]);
      applyChatSession(restored.id);
      setSessionMissing(restored.missing);
    }
    setEvents(previous => mergeChatEvents(previous, e as Row[], sessionRef.current));
    setProviders(p as Row[]);
    setSessions(s as Row[]);
    setStats(st as Row);
    setApprovals(a as Row[]);
  }, [api, applyChatSession]);
  const lastId = (rows: Row[]) =>
    Number(rows[rows.length - 1]?.id ?? 0) || 0;
  const fetchPage = useCallback(
    async (before: number | null, size: number, search: string) => {
      const params = new URLSearchParams({
        limit: String(size),
        hide: "token",
      });
      if (before !== null) params.set("before", String(before));
      if (search) params.set("q", search);
      const response = await fetch(`/api/events?${params.toString()}`, {
        credentials: "include",
      });
      const rows = (await response.json().catch(() => [])) as Row[];
      if (!response.ok) throw new Error("Unable to load activity");
      const total = Number(response.headers.get("x-total") ?? "");
      return {
        rows,
        more: response.headers.get("x-has-more") === "1",
        total: Number.isFinite(total) ? total : null,
      };
    },
    [],
  );
  const loadPage = useCallback(
    async (target: number) => {
      if (target < 1) return;
      setPageBusy(true);
      try {
        if (pageCache[target]) {
          setPageNo(target);
          setPending(0);
          return;
        }
        const base = target === 1 ? [] : (pageCache[target - 1] ?? []);
        if (target > 1 && !base.length) return;
        const { rows, more, total } = await fetchPage(
          target === 1 ? null : lastId(base),
          pageSize,
          query,
        );
        setPageCache((prev) => ({ ...prev, [target]: rows }));
        setHasMore(more);
        setTotalEvents(total);
        setPageNo(target);
        setPending(0);
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e));
      } finally {
        setPageBusy(false);
      }
    },
    [pageCache, pageSize, query, fetchPage],
  );
  const resetPages = useCallback(
    async (size = pageSize, search = query) => {
      setPageBusy(true);
      try {
        const { rows, more, total } = await fetchPage(null, size, search);
        setPageCache({ 1: rows });
        setHasMore(more);
        setTotalEvents(total);
        setPageNo(1);
        setPending(0);
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e));
      } finally {
        setPageBusy(false);
      }
    },
    [pageSize, query, fetchPage],
  );
  useEffect(() => {
    const once = new URLSearchParams(location.hash.slice(1)).get("login");
    if (once) {
      history.replaceState(null, "", location.pathname + location.search);
      void api("auth", { token: once })
        .then(() => setLogged(true))
        .catch((e) => setError(String(e)));
      return;
    }
    sessionStorage.removeItem("pansa-token");
    void api("auth/session")
      .then(() => setLogged(true))
      .catch(() => {});
  }, [api]);
  useEffect(() => {
    if (!logged) return;
    refresh().catch((e) => setError(String(e)));
    void resetPages();
    const timer = setInterval(() => {
      refresh().catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logged, refresh]);
  useEffect(() => {
    if (!logged) return;
    let socket: WebSocket;
    let timer: ReturnType<typeof setTimeout>;
    let active = true;
    const connect = () => {
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
      );
      socket.onopen = () => setConnected(true);
      socket.onmessage = ({ data }) => {
        const e = JSON.parse(String(data)) as Row;
        if (e.type === "connected") return;
        if (e.type !== "token") setEvents(previous => mergeChatEvents(previous, [e], sessionRef.current));
        if (e.type !== "token") {
          if (pageRef.current === 1) {
            setPageCache((prev) => {
              const first = prev[1];
              if (!first) return prev;
              if (first.some((x) => String(x.id) === String(e.id))) return prev;
              return { ...prev, 1: [e, ...first].slice(0, sizeRef.current) };
            });
          } else setPending((n) => n + 1);
        }
        const payload = e.data as Row;
        if (e.type === "token" && e.session_id === session) {
          buffer.current += String(payload.text ?? "");
          if (!ticker.current)
            ticker.current = setTimeout(() => {
              const chunk = buffer.current;
              buffer.current = "";
              ticker.current = null;
              if (chunk) setStream((prev) => (prev + chunk).slice(-20000));
            }, 120);
        }
        if (e.type === "message" && e.session_id === session) {
          buffer.current = "";
          if (ticker.current) {
            clearTimeout(ticker.current);
            ticker.current = null;
          }
          setStream("");
        }
        if (
          e.type === "task" &&
          e.session_id === session &&
          (showArchive || Number(e.id) > Number(sessionState.visible_after ?? 0)) &&
          payload.status !== "running"
        ) {
          buffer.current = "";
          if (ticker.current) {
            clearTimeout(ticker.current);
            ticker.current = null;
          }
          setStream("");
        }
        if (e.type === "switch")
          notify(`Provider switched: ${payload.reason}`);
        if (e.type === "task" || e.type === "approval" || e.type === "usage" || (e.type === "audit" && payload.action === "model_selected"))
          void refresh();
      };
      socket.onclose = () => {
        setConnected(false);
        if (active) timer = setTimeout(connect, 2500);
      };
    };
    connect();
    return () => {
      active = false;
      clearTimeout(timer);
      if (ticker.current) {
        clearTimeout(ticker.current);
        ticker.current = null;
      }
      buffer.current = "";
      socket?.close();
    };
  }, [logged, session, refresh]);
  useEffect(() => {
    if (!logged) return;
    setItems([]);
    setError("");
    const route =
      tab === "memory"
        ? `memory?q=${encodeURIComponent(query)}${session ? `&session=${encodeURIComponent(session)}` : ""}`
        : ["skills", "tools", "schedules"].includes(tab)
          ? tab
          : null;
    if (route)
      api(route)
        .then((r) => setItems(r as Row[]))
        .catch((e) => setError(String(e)));
  }, [tab, logged, query, api, session]);
  useEffect(() => {
    if (!logged || (tab !== "settings" && tab !== "memory")) return;
    for (const document of ["soul", "user", "memory"] as const)
      void api(`profile/${document}`).then((result) => setProfileDocs((previous) => ({ ...previous, [document]: String((result as Row).content ?? "") }))).catch((e) => setError(String(e)));
  }, [tab, logged, api]);
  const loadFiles = useCallback(
    async (p = filePath) => {
      if (!filesSession) return;
      const r = (await api(
        `sessions/${filesSession}/files?path=${encodeURIComponent(p)}`,
      )) as Row[] | Row;
      if (Array.isArray(r)) {
        setFileContent("");
        setEditing("");
        setFiles(
          r.map((f) => ({
            name: String(f.name),
            directory: Boolean(f.directory),
          })),
        );
      } else {
        setEditing(String(r.name));
        setFileContent(
          new TextDecoder().decode(
            Uint8Array.from(atob(String(r.content)), (c) => c.charCodeAt(0)),
          ),
        );
      }
    },
    [api, filesSession, filePath],
  );
  useEffect(() => {
    if (tab !== "files" || !logged || !filesSession) return;
    void loadFiles().catch((e) => setError(String(e)));
  }, [tab, logged, filesSession, loadFiles]);
  useEffect(() => {
    if (!logged) return;
    void api("settings")
      .then((r) => {
        const saved = (r as Row).timezone;
        if (typeof saved === "string" && saved) setZone(saved);
      })
      .catch(() => {});
  }, [logged, api]);
  useEffect(() => {
    if (tab !== "settings" || !logged) return;
    void api("settings")
      .then((r) => {
        const s = r as Row;
        setSettingsInfo(s);
        const saved =
          typeof s.timezone === "string" && s.timezone
            ? s.timezone
            : DEFAULT_TIMEZONE;
        setZone(saved);
        setSettings((prev) => ({
          ...prev,
          max_steps: Number(s.max_steps ?? 60),
          timezone: saved,
        }));
      })
      .catch((e) => setError(String(e)));
  }, [tab, logged, api]);
  const action = async (
    fn: () => Promise<unknown>,
    message: string | null = "Saved",
  ) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      if (message) notify(message);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const send = async (text = prompt) => {
    if (!text.trim() || busy || running || sending.current || !sessionReady || sessionMissing) return;
    sending.current = true;
    try {
      await action(async () => {
        let id = sessionRef.current;
        if (!id) {
          const created = (await api("sessions", { title: text.slice(0, 50) })) as Row;
          id = String(created.id);
          applyChatSession(id);
          setSessions(previous => [created, ...previous.filter(row => row.id !== id)]);
          if (draftProvider) await api(`sessions/${id}/model`, { provider: draftProvider }, "PUT");
          await api(`sessions/${id}/mode`, { mode: draftMode });
          setSessionState({ mode: draftMode });
        }
        setStream("");
        await api(`sessions/${id}/message`, { prompt: text });
        setPrompt(previous => previous === text ? "" : previous);
      }, "Task submitted");
    } finally {
      sending.current = false;
    }
  };
  const data = useCallback(
    (e: Row): Row =>
      typeof e.data === "string"
        ? (JSON.parse(e.data) as Row)
        : ((e.data as Row) ?? {}),
    [],
  );
  const merge = useCallback((incoming: Row[]) => {
    setEvents((prev) => {
      return mergeChatEvents(prev, incoming, sessionRef.current);
    });
  }, []);
  useEffect(() => {
    if (!logged || !session) return;
    void api(`events?session=${encodeURIComponent(session)}&hide=token`)
      .then((r) => merge(r as Row[]))
      .catch(() => {});
  }, [logged, session, api, merge]);
  const timeline = useMemo(() => {
    const own = events
      .filter(
        (e) =>
          e.session_id === session &&
          e.type !== "token" &&
          e.type !== "usage" &&
          e.type !== "audit",
      )
      .slice()
      .sort((a, b) => Number(a.id) - Number(b.id));
    const pending = new Map<string, number>();
    const out: { key: string; type: string; e: Row }[] = [];
    for (const e of own) {
      if (e.type !== "tool") {
        out.push({ key: String(e.id), type: String(e.type), e });
        continue;
      }
      const d = data(e);
      const sig = `${String(d.tool ?? d.name)}|${String(d.command ?? d.content ?? "")}`;
      const at = pending.get(sig);
      if (d.status === "running") {
        pending.set(sig, out.length);
        out.push({ key: String(e.id), type: "tool", e });
      } else if (at !== undefined && out[at]) {
        out[at] = { key: out[at].key, type: "tool", e };
        pending.delete(sig);
      } else {
        out.push({ key: String(e.id), type: "tool", e });
      }
    }
    return out;
  }, [events, session, data, showArchive, sessionState.visible_after]);
  const enabledProviders = providers.filter(provider => provider.enabled);
  const preferredProvider = String((session ? sessions.find(row => row.id === session)?.pinned : draftProvider) ?? "");
  const changeModel = async (provider: string) => {
    if (!session) { setDraftProvider(provider); return; }
    await action(async () => {
      const { pinned } = await api(`sessions/${session}/model`, { provider: provider || null }, "PUT") as { pinned: string | null };
      setSessions(rows => rows.map(row => row.id === session ? { ...row, pinned } : row));
    }, "Model preference saved for the next task");
  };
  const changeMode = async (mode: string) => {
    if (!session) { setDraftMode(mode); return; }
    await action(async () => {
      await api(`sessions/${session}/mode`, { mode });
      setSessionState(previous => ({ ...previous, mode }));
    }, null);
  };
  const running = useMemo(() => {
    if (!session) return false;
    const last = events.find(
      (e) => e.type === "task" && e.session_id === session,
    );
    const marker = stopped[session];
    if (marker !== undefined && (!last || Number(last.id) <= marker))
      return false;
    if (last) return String(data(last).status ?? "") === "running";
    const row = sessions.find((s) => String(s.id) === session);
    return Boolean(row?.running);
  }, [events, session, sessions, data, stopped]);
  const conversation = useMemo(() => timeline.filter(item => {
    const payload = data(item.e);
    return item.type === "message" && ["user", "assistant"].includes(String(payload.role)) && String(payload.content ?? "").trim();
  }), [timeline, data]);
  const taskArtifacts = useMemo(() => {
    const byPath = new Map<string, { path: string; size: number; key: string }>();
    for (const item of timeline) {
      if (item.type !== "task" || data(item.e).status !== "done") continue;
      const artifacts = data(item.e).artifacts;
      if (!Array.isArray(artifacts)) continue;
      for (const value of artifacts) {
        const file = value as Row;
        if (typeof file.path === "string" && typeof file.size === "number")
          byPath.set(file.path, { path: file.path, size: file.size, key: item.key });
      }
    }
    return [...byPath.values()].slice(-12);
  }, [timeline, data]);
  const conversationVersion = conversation.map(item => item.key).join(",");
  const scrollVersion = view === "chat" ? `${conversationVersion}:${taskArtifacts.map(file => `${file.key}:${file.path}`).join(",")}` : timeline.map(item => `${item.key}:${data(item.e).status ?? ""}`).join(",");
  const sessionApprovals = approvals.filter(item => item.session_id === session);
  const sessionQuestions = sessionState.questions as Row[] ?? [];
  const lastTask = events.find(event => event.session_id === session && event.type === "task");
  const taskFailure = !running && lastTask && data(lastTask).status === "error" ? String(data(lastTask).error ?? "Your request could not be completed. Please try again.") : "";
  const liveActivity = useMemo(() => {
    if (sessionApprovals.length) return { label: "Waiting for your approval", detail: "Review the action below to continue.", waiting: true };
    if (sessionQuestions.length) return { label: "Waiting for your answer", detail: "Choose an option or write your answer below.", waiting: true };
    const latest = events.filter(event => event.session_id === session);
    const task = latest.find(event => event.type === "task");
    const latestTool = latest.find(event => event.type === "tool" && Number(event.id) > Number(task?.id ?? 0));
    if (latestTool && data(latestTool).status === "running") {
      const payload = data(latestTool);
      const name = String(payload.name ?? payload.tool ?? "tool");
      const labels: Record<string, string> = { web_fetch: "Reading a web page", http_request: "Fetching web data", web_search: "Searching the web", bash: "Running a command", run_python: "Analyzing data", run_node: "Running code", read_file: "Reading a file", write_file: "Writing a file", edit_file: "Updating a file" };
      let detail = name.replace(/_/g, " ");
      const url = (payload.args as Row | undefined)?.url;
      if (url) { try { detail = new URL(String(url)).hostname; } catch {} }
      return { label: labels[name] ?? "Working on your task", detail, waiting: false };
    }
    return { label: stream ? "Composing a response" : "Thinking", detail: "Pansa is working on your request.", waiting: false };
  }, [events, session, data, stream, sessionApprovals.length, sessionQuestions.length]);
  const transcript = useMemo(
    () =>
      timeline
        .map((i) => {
          const d = data(i.e);
          if (i.type === "message")
            return `## ${String(d.role)}\n\n${String(d.content ?? "")}`;
          if (i.type === "tool")
            return `### ${String(d.tool ?? d.name)} · ${String(d.status)}\n\n\`\`\`\n${String(d.command ?? "")}\n\`\`\`\n\n${String(d.output ?? d.tail ?? "").slice(0, 1500)}`;
          if (i.type === "switch")
            return `> provider switch: ${String(d.reason ?? "")}`;
          if (i.type === "task")
            return `> task ${String(d.status ?? "")} ${String(d.error ?? "")}`;
          if (i.type === "error") return `> error: ${String(d.error ?? "")}`;
          return "";
        })
        .filter(Boolean)
        .join("\n\n"),
    [timeline, data],
  );
  useEffect(() => {
    const el = historyRef.current;
    if (!el || !followLatest.current) return;
    el.scrollTop = el.scrollHeight;
  }, [scrollVersion, stream, view, session, tab, running, sessionApprovals.length, sessionQuestions.length]);
  const onScroll = () => {
    const el = historyRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    followLatest.current = atBottom;
    setStick(atBottom);
  };
  const jump = () => {
    const el = historyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    followLatest.current = true;
    setStick(true);
  };
  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(label);
    } catch {
      setError("Clipboard access is unavailable in this browser");
    }
  };
  const download = () => {
    const blob = new Blob([transcript], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pansa-${session.slice(0, 8) || "chat"}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    notify("Transcript downloaded");
  };
  const activity = events.filter((e) => e.type !== "token").slice(0, 8);
  const chart = Array.from({ length: 12 }, (_, i) => {
    const minutes = 55 - i * 5,
      time = Date.now() - minutes * 60000;
    const usage = events.filter((e) => {
      const at = parseStamp(e.created_at)?.getTime();
      return (
        e.type === "usage" &&
        at !== undefined &&
        at >= time &&
        at < time + 300000
      );
    });
    return {
      time: new Date(time).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: zone,
      }),
      tokens: usage.reduce((sum, e) => sum + Number(data(e).tokens ?? 0), 0),
      cost: usage.reduce((sum, e) => sum + Number(data(e).cost ?? 0), 0),
    };
  });
  const Feed = ({ all = false, rows }: { all?: boolean; rows?: Row[] }) => (
    <div className={all ? "" : "feed"} role={all ? undefined : "region"} tabIndex={all ? undefined : 0} aria-label={all ? undefined : "Recent activity"}>
      <AnimatePresence initial={false}>
        {(rows ??
          (all
            ? events.filter(
                (e) =>
                  e.type !== "token" &&
                  (!query ||
                    JSON.stringify(e)
                      .toLowerCase()
                      .includes(query.toLowerCase())),
              )
            : activity)
        ).map((e) => (
          <motion.div
            key={String(e.id)}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="feed-item"
          >
            <div className="feed-icon">
              {e.type === "switch" ? (
                <RefreshCw size={13} />
              ) : e.type === "tool" ? (
                <Terminal size={13} />
              ) : e.type === "error" ? (
                <Shield size={13} />
              ) : (
                <Activity size={13} />
              )}
            </div>
            <div className="feed-text">
              <strong>
                {String(
                  data(e).name ?? data(e).status ?? data(e).role ?? e.type,
                )}
              </strong>
              <p>
                {String(
                  data(e).command ??
                    data(e).content ??
                    data(e).output ??
                    data(e).tail ??
                    data(e).reason ??
                    data(e).prompt ??
                    data(e).error ??
                    JSON.stringify(data(e)),
                )}
              </p>
              {all && (
                <details>
                  <summary className="muted text-xs mt-2 cursor-pointer">
                    Detail event
                  </summary>
                  <pre className="text-xs whitespace-pre-wrap mt-3">
                    {JSON.stringify(data(e), null, 2)}
                  </pre>
                </details>
              )}
            </div>
            <span className="feed-time">{fmtTime(e.created_at, zone)}</span>
          </motion.div>
        ))}
      </AnimatePresence>
      {!(rows ?? (all ? events : activity)).length && (
        <div className="empty">
          <Activity size={22} />
          {t.empty}
        </div>
      )}
    </div>
  );
  if (!logged)
    return (
      <main className="login">
        <section className="login-story">
          <div className="eyebrow">YOUR PERSONAL INTELLIGENCE</div>
          <h1>Your space.<br /><span>Endless possibilities.</span></h1>
          <p>Your conversations, ideas, and work. Connected through a personal assistant that belongs entirely to you.</p>
          <IntelligenceOrb />
          <div className="login-promises"><span><Shield size={15} /> Self-hosted</span><span><MemoryStick size={15} /> Personal memory</span><span><Zap size={15} /> Real action</span></div>
        </section>
        <form
          className="panel login-card"
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              await api("auth", { token });
              setToken("");
              setLogged(true);
            }, "Welcome back");
          }}
        >
          <div className="brand">
            <span className="brand-icon">
              <Command size={22} />
            </span>
            Pansa<em>OS</em>
          </div>
          <h2 className="text-xl">{t.login}</h2>
          <p className="muted mt-2 text-xs">{t.tagline}</p>
          <label className="login-label" htmlFor="admin-token">Your access token</label>
          <input
            id="admin-token"
            type="password"
            autoComplete="current-password"
            placeholder="Admin token from your installation"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
          />
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn primary" disabled={busy}>
            {busy ? <><Loader2 size={15} className="spin" /> Connecting…</> : <>Open workspace <ArrowRight size={15} /></>}
          </button>
          <p className="login-security"><Shield size={13} /> Private access. Your data stays on your server.</p>
        </form>
      </main>
    );
  return (
    <div className={navOpen ? "app nav-open" : "app"}>
      <a href="#workspace-content" className="skip-link">Skip to content</a>
      <div className="ambient-light" aria-hidden="true" />
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
      <aside id="workspace-sidebar" className="sidebar" ref={sidebarRef} inert={mobileViewport && !navOpen} role={mobileViewport && navOpen ? "dialog" : undefined} aria-modal={mobileViewport && navOpen ? true : undefined} aria-label="Navigation workspace">
        <button type="button" className="brand" aria-label="Go to overview" onClick={() => { setTab("overview"); setNavOpen(false); }}>
          <span className="brand-icon">
            <Command size={22} />
          </span>
          <span className="brand-text">
            Pansa<em>OS</em>
            <span className="text-[8px] tracking-normal muted ml-2">
              v1.0
            </span>
          </span>
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav className="nav">
          {tabs.slice(0, 7).map(([key, Icon]) => (
            <button
              key={key}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => {
                setTab(key);
                setNavOpen(false);
              }}
              className={tab === key ? "active" : ""}
            >
              <Icon size={16} />
              <span>{t[key]}</span>
              {key === "live" && <b className="pill">LIVE</b>}
            </button>
          ))}
          <div className="nav-label">INTELLIGENCE</div>
          {tabs.slice(7, 10).map(([key, Icon]) => (
            <button
              key={key}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => {
                setTab(key);
                setNavOpen(false);
              }}
              className={tab === key ? "active" : ""}
            >
              <Icon size={16} />
              <span>{t[key]}</span>
            </button>
          ))}
          <div className="nav-label">SYSTEM</div>
          <button
            aria-current={tab === "settings" ? "page" : undefined}
            onClick={() => {
              setTab("settings");
              setNavOpen(false);
            }}
            className={tab === "settings" ? "active" : ""}
          >
            <Settings size={16} />
            <span>{t.settings}</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="system-box">
            <span className="status-dot" />
            {connected ? "All systems connected" : "Connecting to realtime"}
            <p>Self-hosted. Entirely yours.</p>
            <div className="flex justify-between mt-3 text-[9px] muted">
              <span>CORE ENGINE</span>
              <span style={{ color: "var(--cyan)" }}>
                {connected ? "ONLINE" : "CONNECTING"}
              </span>
            </div>
          </div>
          <div className="flex justify-between items-center pt-5 text-[10px] muted">
            <span>
              <a className="sidebar-doc-link" href="https://github.com/jhodypedia/PansaOS#readme" target="_blank" rel="noreferrer">
                Documentation <ExternalLink size={10} className="inline ml-1" />
              </a>
            </span>
            <button
              aria-label="Sign out"
              onClick={() => {
                void api("auth/logout", {});
                setLogged(false);
                setToken("");
              }}
            >
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button
            className="icon-btn menu"
            aria-label="Open menu"
            aria-expanded={navOpen}
            aria-controls="workspace-sidebar"
            onClick={() => setNavOpen(true)}
          >
            <Menu size={17} />
          </button>
          <div className="breadcrumb">
            Workspace <ChevronRight size={11} className="inline" />
            <span>{t[tab]}</span>
          </div>
          <div className="top-actions">
            <span>
              <span className="status-dot" />
              {Number(stats.running) > 0 ? "Agent working" : "Agent ready"}
            </span>
            <span className="keycap">SELF-HOSTED</span>
            <button
              className="icon-btn theme"
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              aria-pressed={theme === "dark"}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button
              className="icon-btn theme"
              aria-label="View live activity"
              onClick={() => setTab("live")}
            >
              <Bell size={15} />
            </button>
            <div className="avatar">PA</div>
          </div>
        </header>
        <div className={`content${tab === "chat" ? " content-chat" : ""}`} id="workspace-content" tabIndex={-1}>
          <div className={`page-title${tab === "chat" ? " sr-only" : ""}`}>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="eyebrow !m-0 !text-[8px]">
                  PANSAOS CONTROL CENTER
                </span>
              </div>
              <h1>
                {tab === "overview" ? "Mission control" : t[tab]}
                <span className="text-[var(--violet)]">.</span>
              </h1>
              <p>
                  {pageDescriptions[tab] ?? t.tagline}
              </p>
            </div>
            {tab !== "chat" && <div className="title-actions">
              <button
                className="btn icon-only"
                aria-label="Refresh"
                title="Refresh"
                onClick={() => void action(refresh, "Data refreshed")}
              >
                <RefreshCw size={12} /> <span className="label">Refresh</span>
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  if (tab === "providers") { setProviderEditing(undefined); setShowForm(true); return; }
                  setTab("chat");
                   chooseChatSession("");
                }}
              >
                <Plus size={13} /> {tab === "providers" ? "Add provider" : "New task"}
              </button>
            </div>}
          </div>
          {error && <div className="error">{error}</div>}
          <AnimatePresence mode="sync">
            <div
              key={tab}
              className="view-transition"
            >
              {tab === "overview" && (
                <>
                  <section className="workspace-hero">
                    <div className="hero-copy">
                      <div className={`hero-status ${connected ? "online" : ""}`}><span className="status-dot" />{connected ? "WORKSPACE CONNECTED" : "CONNECTING WORKSPACE"}</div>
                      <h2>Room for ideas.<br /><span>Power to make them happen.</span></h2>
                      <p>From everyday conversations to ambitious projects. Pansa helps you think, remember, and move forward.</p>
                       <button className="btn primary hero-cta" onClick={() => setTab("chat")}><Sparkles size={16} /> Open Chat <ArrowUpRight size={16} /></button>
                    </div>
                    <IntelligenceOrb />
                    <div className="hero-bottom"><span><Shield size={13} /> Your server. Your control.</span><span>{sessions.length} sessions <i /> {providers.filter(provider => provider.enabled).length} active providers</span></div>
                  </section>
                  <div className="overview-section-heading"><h2>Your workspace at a glance</h2><span><Activity size={13} /> Actual activity data</span></div>
                  <div className="stats">
                    {[
                      [
                        "Total events",
                        stats.events ?? 0,
                        Activity,
                        "Recorded activity",
                      ],
                      [
                        "Tokens used",
                        stats.tokens ?? 0,
                        Zap,
                        "Across all providers",
                      ],
                      [
                        "Estimated cost",
                        stats.cost ?? 0,
                        DollarSign,
                        "USD · based on your configuration",
                      ],
                      [
                        "Tool executions",
                        stats.tools ?? 0,
                        Terminal,
                        "Tool executions and results",
                      ],
                      [
                        "Auto switches",
                        stats.switches ?? 0,
                        RefreshCw,
                        "Provider failover",
                      ],
                    ].map(([label, value, Icon, foot], i) => {
                      const I = Icon as typeof Activity;
                      return (
                        <div
                          key={String(label)}
                          style={{ animationDelay: reducedMotion ? "0s" : `${i * 0.055}s` }}
                          className="stat"
                        >
                          <div className="stat-head">
                            <span>{String(label)}</span>
                            <span className="stat-icon">
                              <I size={13} />
                            </span>
                          </div>
                          <div className="stat-value">
                            {i === 2 ? "$" : ""}
                            <Counter value={Number(value)} />
                          </div>
                          <div className="stat-foot">
                            <span className="status-dot !w-1 !h-1 !mr-0" />
                            {String(foot)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="row">
                    <section className="panel">
                      <div className="panel-header">
                        <h2>
                          <Activity size={14} /> Token usage{" "}
                          <span className="badge ml-2">REALTIME</span>
                        </h2>
                        <div className="chart-legend">
                          <span>
                            <i className="legend-dot" />
                            Tokens
                          </span>
                          <span>
                            60 minutes{" "}
                            <ChevronDown size={10} className="inline" />
                          </span>
                        </div>
                      </div>
                      <div className="chart">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart
                            data={chart}
                            margin={{ top: 5, right: 18, left: -12, bottom: 0 }}
                          >
                            <defs>
                              <linearGradient
                                id="purple"
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="1"
                              >
                                <stop
                                  offset="0%"
                                  stopColor="var(--violet)"
                                  stopOpacity={0.32}
                                />
                                <stop
                                  offset="100%"
                                  stopColor="var(--violet)"
                                  stopOpacity={0}
                                />
                              </linearGradient>
                            </defs>
                            <CartesianGrid
                              stroke="var(--border)"
                              vertical={false}
                            />
                            <XAxis
                              dataKey="time"
                              tick={{ fill: "var(--text-dim)", fontSize: 9 }}
                              tickLine={false}
                              axisLine={false}
                              interval={2}
                            />
                            <YAxis
                              tick={{ fill: "var(--text-dim)", fontSize: 9 }}
                              tickLine={false}
                              axisLine={false}
                            />
                            <Tooltip
                              contentStyle={{
                                background: "var(--bg-elev)",
                                border: "1px solid var(--border-3)",
                                borderRadius: 8,
                                fontSize: 11,
                                color: "var(--text)",
                              }}
                            />
                            <Area
                              dataKey="tokens"
                              type="monotone"
                              stroke="var(--violet-2)"
                              strokeWidth={2}
                              fill="url(#purple)"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </section>
                    <section className="panel">
                      <div className="panel-header">
                        <h2>
                          <Network size={14} /> Live architecture
                        </h2>
                        <small>
                          <span className="status-dot !w-1 !h-1" /> LIVE FLOW
                        </small>
                      </div>
                      <FlowDiagram active={Number(stats.running) > 0} />
                    </section>
                  </div>
                  <div className="row">
                    <section className="panel">
                      <div className="panel-header">
                        <h2>
                          <Radio size={14} /> Recent activity{" "}
                          <span className="badge ml-2">LIVE</span>
                        </h2>
                        <button
                          className="text-[10px] text-[var(--text-2)] flex gap-2 items-center"
                          onClick={() => setTab("live")}
                        >
                          View all <ArrowUpRight size={12} />
                        </button>
                      </div>
                      <Feed />
                    </section>
                    <section className="panel">
                      <div className="panel-header">
                        <h2>
                          <Layers size={14} /> Provider network
                        </h2>
                        <button
                          className="text-[10px] text-[var(--text-2)]"
                          onClick={() => setTab("providers")}
                        >
                          Manage <ArrowUpRight size={12} className="inline" />
                        </button>
                      </div>
                      {providers.length ? (
                        providers.slice(0, 4).map((p, i) => (
                          <div className="provider-row" key={String(p.id)}>
                            <div className="provider-logo">
                              <Layers size={16} />
                            </div>
                            <div className="provider-info">
                              <h3>
                                {String(p.name)}{" "}
                                {i === 0 && (
                                  <span className="text-[8px] text-[var(--violet-2)] ml-2">
                                    PRIMARY
                                  </span>
                                )}
                              </h3>
                              <p>{String(p.model)}</p>
                            </div>
                            <div className="text-right">
                              <span className="badge">
                                {Number(p.cooldown_until) > Date.now()
                                  ? "cooldown"
                                  : p.enabled
                                    ? "ready"
                                    : "off"}
                              </span>
                              <p className="text-[9px] text-[var(--text-dim)] mt-2 font-mono">
                                {Math.round(Number(p.latency))} ms
                              </p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="empty">
                          <Layers size={24} />
                          <p>Hubungkan provider pertamamu.</p>
                          <button
                            className="btn mt-4"
                            onClick={() => setTab("providers")}
                          >
                            <Plus size={12} /> Add provider
                          </button>
                        </div>
                      )}
                      <div className="px-5 py-4 flex justify-between text-[9px] font-mono text-[var(--text-dim)]">
                        <span>PRIORITY-BASED FAILOVER</span>
                        <Shield size={12} className="text-[var(--cyan)]" />
                      </div>
                    </section>
                  </div>
                </>
              )}
              {tab === "live" && (
                <section className="panel">
                  <div className="panel-header">
                    <h2>
                      <Radio size={15} /> Event stream
                    </h2>
                    <input
                      aria-label="Search activity"
                      placeholder="Search activity…"
                      value={query}
                      onChange={(e) => {
                        const value = e.target.value;
                        setQuery(value);
                        if (searchTimer.current)
                          clearTimeout(searchTimer.current);
                        searchTimer.current = setTimeout(() => {
                          void resetPages(pageSize, value);
                        }, 320);
                      }}
                      className="!py-2 !text-xs"
                    />
                  </div>
                  {query && (
                    <p className="pager-note">
                      Search includes the full activity history on your server.
                      {totalEvents !== null ? ` ${totalEvents} matching events.` : ""}
                    </p>
                  )}
                  {pending > 0 && pageNo > 1 && (
                    <button
                      className="btn new-events ml-5 mr-5 mt-4"
                      onClick={() => void resetPages(pageSize, query)}
                    >
                      <Bell size={12} /> {pending} new events — return to page 1
                    </button>
                  )}
                  <Feed all rows={pageCache[pageNo] ?? []} />
                  <div className="pager">
                    <button
                      className="btn"
                      disabled={pageNo === 1 || pageBusy}
                      onClick={() => void loadPage(pageNo - 1)}
                    >
                      <ChevronLeft size={13} /> Previous
                    </button>
                    <span className="pager-info">
                      Page {pageNo}
                      {totalEvents !== null
                        ? ` of ${Math.max(1, Math.ceil(totalEvents / pageSize))}`
                        : hasMore
                          ? " · older events available"
                          : ""}
                    </span>
                    <button
                      className="btn"
                      disabled={!hasMore || pageBusy}
                      onClick={() => void loadPage(pageNo + 1)}
                    >
                      Next <ChevronRight size={13} />
                    </button>
                    <label className="pager-size">
                      <span>Per page</span>
                      <select
                        aria-label="Events per page"
                        value={pageSize}
                        onChange={(e) => {
                          const size = Number(e.target.value);
                          setPageSize(size);
                          sizeRef.current = size;
                          void resetPages(size, query);
                        }}
                      >
                        {[20, 50, 100].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </section>
              )}
              {tab === "schedules" && (
                <>
                  <section className="panel generic">
                    <form
                      className="toolbar"
                      onSubmit={(e) => {
                        e.preventDefault();
                         if (!scheduleSession) {
                           setError("Choose a session for this schedule.");
                          return;
                        }
                        void action(
                          () =>
                            api("schedules", {
                              cron: schedule.cron,
                              prompt: schedule.prompt,
                               session_id: scheduleSession,
                            }),
                          "Schedule created",
                        ).then(() => setSchedule({ ...schedule, prompt: "" }));
                      }}
                    >
                      <select
                        aria-label="Schedule session"
                         value={scheduleSession}
                         onChange={(e) => setScheduleSession(e.target.value)}
                      >
                        <option value="">Select a session</option>
                        {sessions.map((s) => (
                          <option key={String(s.id)} value={String(s.id)}>
                            {String(s.title)}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label="Cron"
                        placeholder="0 9 * * *"
                        value={schedule.cron}
                        onChange={(e) =>
                          setSchedule({ ...schedule, cron: e.target.value })
                        }
                        required
                      />
                      <input
                        className="flex-1"
                        aria-label="Scheduled prompt"
                        placeholder="Task to run automatically"
                        value={schedule.prompt}
                        onChange={(e) =>
                          setSchedule({ ...schedule, prompt: e.target.value })
                        }
                        required
                      />
                      <button className="btn primary" disabled={busy}>
                        <Plus size={12} /> Add schedule
                      </button>
                    </form>
                    {items.map((s) => (
                      <div className="list-card" key={String(s.id)}>
                        <div>
                          <h3>
                            <Clock size={12} className="inline mr-2" />
                            {String(s.cron)}
                            <span className="badge ml-2">
                              {s.enabled ? "enabled" : "disabled"}
                            </span>
                          </h3>
                          <p className="muted text-xs mt-2">
                            {String(s.prompt)}
                          </p>
                          <p className="text-[10px] muted mt-1">
                            Session {String(s.session_id)} · last run{" "}
                            {Number(s.last_run)
                              ? fmtDate(Number(s.last_run), zone)
                              : "never"}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            className="btn"
                            onClick={() =>
                              void action(
                                () =>
                                  api(
                                    `schedules/${s.id}`,
                                    { enabled: !s.enabled },
                                    "PATCH",
                                  ),
                                "Schedule updated",
                              )
                            }
                          >
                            {s.enabled ? "Disable" : "Enable"}
                          </button>
                          <button
                            className="btn danger"
                            aria-label="Delete schedule"
                            onClick={() =>
                              void action(async () => {
                                await api(
                                  `schedules/${s.id}`,
                                  undefined,
                                  "DELETE",
                                );
                                setItems(items.filter((i) => i.id !== s.id));
                              }, "Schedule deleted")
                            }
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {!items.length && (
                      <div className="empty">
                        No scheduled tasks yet.
                      </div>
                    )}
                  </section>
                  <section className="panel">
                    <div className="panel-header">
                      <h2>
                        <Radio size={15} /> Event stream
                      </h2>
                    </div>
                    <Feed all />
                  </section>
                </>
              )}
              {tab === "chat" && (
                <section className="panel generic chat-panel">
                  <div className="toolbar chat-toolbar">
                      <SessionPicker
                        sessions={sessions}
                        value={session}
                        zone={zone}
                       disabled={busy || !sessionReady}
                       onChange={chooseChatSession}
                    />
                    <div className="seg" role="tablist" aria-label="View mode">
                      <button
                        role="tab"
                        aria-selected={view === "chat"}
                        className={view === "chat" ? "on" : ""}
                        onClick={() => setView("chat")}
                      >
                        <MessageSquare size={12} /> Chat
                      </button>
                      <button
                        role="tab"
                        aria-selected={view === "console"}
                        className={view === "console" ? "on" : ""}
                        onClick={() => setView("console")}
                      >
                        <Terminal size={12} /> Console
                      </button>
                    </div>
                    <span className={`ws ${connected ? "on" : "off"}`}>
                      <span className="status-dot !w-1 !h-1" />
                      {connected ? "LIVE" : "offline"}
                    </span>
                    <div className="chat-actions">
                      <button
                        className="icon-btn"
                        aria-label="Copy transcript"
                        title="Copy transcript"
                        disabled={!transcript}
                        onClick={() => void copy(transcript, "Transcript copied")}
                      >
                        <Copy size={13} />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label="Download transcript"
                        title="Download transcript (.md)"
                        disabled={!transcript}
                        onClick={download}
                      >
                        <Download size={13} />
                      </button>
                      {session && running && (
                        <button
                          className="btn danger"
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              const id = session;
                              const r = (await api(
                                `sessions/${id}/stop`,
                                {},
                              )) as { status?: string };
                              setStopped((prev) => ({
                                ...prev,
                                [id]: Number(
                                  events.find(
                                    (e) =>
                                      e.type === "task" && e.session_id === id,
                                  )?.id ?? 0,
                                ),
                              }));
                              if (r?.status !== "idle") notify("Task stopped");
                              setStream("");
                            }, null)
                          }
                        >
                          <Square size={12} /> Stop
                        </button>
                      )}
                    </div>
                  </div>
                    <div className="chat-shell">
                     {session && view === "console" && <details className="console-session-details">
                      <summary>Session details</summary>
                      <div className="session-work-panel">
                      <button className="btn" onClick={() => void action(() => api(`sessions/${session}/permissions`, undefined, "DELETE"), "Session permissions and auto-approve revoked")}><Shield size={13} /> Revoke session permissions</button>
                      <span>{String((sessionState.usage as Row)?.provider ?? "—")} / {String((sessionState.usage as Row)?.model ?? "—")} · {Number((sessionState.usage as Row)?.tokens ?? 0).toLocaleString()} tokens · {(sessionState.usage as Row)?.cost == null ? "Cost unknown" : `$${Number((sessionState.usage as Row)?.cost).toFixed(4)}`}</span>
                      {!!((sessionState.usage as Row)?.context) && <label>Context ~{Number(((sessionState.usage as Row).context as Row).percent)}% (estimated)<progress max={100} value={Number(((sessionState.usage as Row).context as Row).percent)} /></label>}
                      {(sessionState.todos as Row[] ?? []).map((item, index) => <div key={index}>{item.status === "completed" ? "✓" : item.status === "in_progress" ? "◉" : "○"} {String(item.content)} · {String(item.status)}</div>)}
                      {(sessionState.subagents as Row[] ?? []).map(task => <div key={String(task.id)}>Subagent {String(task.type)} · {String(task.status)} · since {fmtTime(task.since, zone)}</div>)}
                      {!!(sessionState.checkpoints as Row[] ?? []).length && <details><summary>Checkpoint ({(sessionState.checkpoints as Row[]).length})</summary>{(sessionState.checkpoints as Row[]).map(cp => <div key={String(cp.id)}>{String(cp.name)} · {String(cp.time)} · {(cp.files as string[]).length} file</div>)}</details>}
                      <details><summary>Available commands</summary>{commandList.map(command => <div key={command.name}>/{command.name} — {command.description}</div>)}</details>
                      <button className="btn" onClick={() => setShowArchive(!showArchive)}>{showArchive ? "Close archive" : "Open history archive"}</button>
                      <details><summary>MCP servers ({mcpServers.length})</summary>
                        <p>Stdio servers run in the session sandbox without the Docker socket. MCP tools require approval and are unavailable in Plan mode. Remote servers control their own access.</p>
                        {mcpServers.map(server => <div key={String(server.name)}>{String(server.name)} · {server.connected ? "connected" : "failed"} · {Number(server.count)} tools {String(server.error ?? "")}<button className="btn" onClick={() => void api(`mcp/${server.name}`, undefined, "DELETE").then(() => api("mcp")).then(r => setMcpServers(r as Row[]))}>Delete</button></div>)}
                        <div className="mcp-form">
                          <input aria-label="MCP name" placeholder="Server name" value={mcpForm.name} onChange={e => setMcpForm({ ...mcpForm, name: e.target.value })} />
                          <select aria-label="Transport MCP" value={mcpForm.transport} onChange={e => setMcpForm({ ...mcpForm, transport: e.target.value })}><option value="http">HTTP</option><option value="sse">SSE</option><option value="stdio">stdio sandbox</option></select>
                          {mcpForm.transport === "stdio" ? <><input aria-label="MCP command" placeholder="Command inside the sandbox" value={mcpForm.command} onChange={e => setMcpForm({ ...mcpForm, command: e.target.value })} /><input aria-label="MCP arguments" placeholder={'JSON arguments: ["/workspace/server.js"]'} value={mcpForm.args} onChange={e => setMcpForm({ ...mcpForm, args: e.target.value })} /></> : <><input aria-label="MCP URL" placeholder="https://server.example/mcp" value={mcpForm.url} onChange={e => setMcpForm({ ...mcpForm, url: e.target.value })} /><input type="password" autoComplete="off" aria-label="MCP secret headers" placeholder='JSON headers (encrypted at rest)' value={mcpForm.headers} onChange={e => setMcpForm({ ...mcpForm, headers: e.target.value })} /></>}
                          <button className="btn" disabled={!session || !mcpForm.name} onClick={() => {
                            try {
                              const payload = { name: mcpForm.name, transport: mcpForm.transport, session, ...(mcpForm.transport === "stdio" ? { command: mcpForm.command, args: JSON.parse(mcpForm.args || "[]") } : { url: mcpForm.url, headers: JSON.parse(mcpForm.headers || "{}") }) };
                              void api("mcp", payload).then(r => { setMcpServers(r as Row[]); setMcpForm(prev => ({ ...prev, headers: "" })); }).catch(e => notify(String(e.message)));
                            } catch { notify("Arguments and headers must be valid JSON."); }
                          }}>Save MCP server</button>
                        </div>
                      </details>
                      </div>
                     </details>}
                    <div
                      className={`chat-history ${view === "console" ? "console" : ""}`}
                      ref={historyRef}
                      onScroll={onScroll}
                      role="region"
                      aria-label={view === "chat" ? "Conversation history" : "Execution log"}
                      tabIndex={0}
                    >
                       {!sessionReady && <div className="empty" role="status">Loading sessions…</div>}
                       {sessionMissing && <div className="empty" role="status">This session is unavailable. Select an existing session to continue.</div>}
                       {sessionReady && !session && (
                        <div className="empty">
                          <Bot size={32} />
                          <p>Your ideas. Pansa's next move.</p>
                          <p className="mt-2 text-[10px]">
                            Ask a question or describe a task to get started.
                          </p>
                        </div>
                      )}
                      {session && !conversation.length && !running && view === "chat" && (
                        <div className="empty">
                          <MessageSquare size={26} />
                          <p>No messages in this session yet.</p>
                        </div>
                      )}
                      {view === "chat"
                        ? conversation.map((i) => {
                            const d = data(i.e);
                            if (i.type === "message") {
                              const text = String(d.content ?? "").trim();
                              if (!text) return null;
                              return (
                                <div
                                  key={i.key}
                                  className={`bubble ${String(d.role ?? "")}`}
                                >
                                  <span className="bubble-role">
                                    {d.role === "user" ? "You" : "Pansa"}
                                  </span>
                                  <Rich text={text} />
                                </div>
                              );
                            }
                            return null;
                          })
                        : timeline.map((i) => {
                            const d = data(i.e);
                            const stamp = fmtTime(i.e.created_at ?? Date.now(), zone, {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            });
                            let line = "";
                            let cls = "";
                            if (i.type === "tool") {
                              const ok = d.status === "done";
                              const bad = d.status === "error";
                              cls = bad ? "bad" : ok ? "ok" : "run";
                              line = `$ ${String(d.command ?? d.content ?? d.tool ?? d.name)}\n${String(d.output ?? d.tail ?? d.error ?? "").slice(-2000)}`;
                              if (d.durationMs !== undefined)
                                line += `\n(${Number(d.durationMs)} ms${d.exitCode !== undefined ? ` · exit ${String(d.exitCode)}` : ""})`;
                            } else if (i.type === "message") {
                              cls = String(d.role ?? "");
                              line = `${String(d.role) === "user" ? "»" : "«"} ${String(d.content ?? "")}`;
                            } else if (i.type === "progress") {
                              cls = "run";
                              line = `… ${String(d.text ?? "")}${d.step !== undefined ? ` (${String(d.step)}/${String(d.of ?? "")})` : ""}`;
                            } else if (i.type === "switch") {
                              line = `~ provider: ${String(d.reason ?? "")}`;
                            } else if (i.type === "error") {
                              cls = "bad";
                              line = `! ${String(d.error ?? "")}`;
                            } else if (i.type === "task") {
                              line = `# task ${String(d.status ?? "")}${d.error ? ` · ${String(d.error)}` : ""}`;
                            }
                            if (!line) return null;
                            return (
                              <div className={`console-line ${cls}`} key={i.key}>
                                <span className="console-time">{stamp}</span>
                                <pre>{line}</pre>
                              </div>
                            );
                          })}
                      {view === "chat" && taskArtifacts.length > 0 && (
                        <section className="chat-artifacts" aria-label="Files created by Pansa">
                          <div className="chat-artifacts-heading"><FileText size={14} /> {t.createdFiles}</div>
                          <div className="chat-artifacts-list">
                            {taskArtifacts.map((file) => (
                              <a
                                key={`${file.key}:${file.path}`}
                                className="chat-artifact"
                                href={`/api/sessions/${encodeURIComponent(session)}/files/download?path=${encodeURIComponent(file.path)}`}
                                download
                                aria-label={`Download ${file.path}`}
                              >
                                <FileText size={15} />
                                <span>{file.path}</span>
                                <small>{fileSize(file.size)}</small>
                                <Download size={14} />
                              </a>
                            ))}
                          </div>
                        </section>
                      )}
                      {view === "console" && stream && (
                        <div className="bubble streaming">
                          <span className="bubble-role">streaming</span>
                          <pre className="stream-text">{stream}</pre>
                        </div>
                      )}
                      {view === "chat" && running && <div className={`chat-activity${liveActivity.waiting ? " waiting" : ""}`} role="status" aria-live="polite">
                        <span className="activity-orbit" aria-hidden="true"><span /><span /><span /></span>
                        <div><strong key={liveActivity.label}>{liveActivity.label}<span className="activity-ellipsis" aria-hidden="true">…</span></strong><p>{liveActivity.detail}</p></div>
                        <button type="button" onClick={() => setView("console")} aria-label="View details in Console">Details <ArrowUpRight size={12} /></button>
                      </div>}
                      {view === "chat" && taskFailure && <div className="notice-row bad" role="alert"><Shield size={15} /><span>{taskFailure}</span></div>}
                      {sessionQuestions.map(question => <QuestionCard key={String(question.id)} question={question} onAnswer={answer => api(`questions/${question.id}`, { answer })} />)}
                      {sessionApprovals.map(approval => <div key={String(approval.id)} className="chat-approval decision-card">
                        <div className="decision-eyebrow"><Shield size={14} /> APPROVAL REQUIRED</div>
                        <p>Pansa needs permission to run <strong>{String(approval.tool).replace(/_/g, " ")}</strong>.</p>
                        {!!approval.root && <p className="muted">Workspace: {String(approval.root)}</p>}
                        {!!approval.notice && <p className="muted">{String(approval.notice)}</p>}
                        <details><summary>Review action</summary><pre>{String(approval.args)}</pre></details>
                        <div className="approval-actions"><button className="btn primary" disabled={busy} onClick={() => void action(() => api(`approvals/${approval.id}`, { approved: true, duration: "once" }), "Action approved once")}><Check size={14} /> Allow once</button>{approval.allowSession === true && <button className="btn" disabled={busy} onClick={() => void action(() => api(`approvals/${approval.id}`, { approved: true, duration: "session" }), "Execution allowed for this session and workspace")}><Shield size={14} /> Allow for session</button>}<button className="btn" disabled={busy} onClick={() => void action(() => api(`approvals/${approval.id}`, { approved: false }), "Action denied")}><X size={14} /> Deny</button></div>
                        {approval.allowSession === true && <p className="decision-note">Session permission applies to this workspace until core restarts or you revoke it in Console. Protected actions still require one-time approval.</p>}
                      </div>)}
                    </div>
                  </div>
                  {!stick && session && (
                    <div className="chat-jump-row">
                      <button
                        className="chat-jump"
                        onClick={jump}
                        aria-label="Jump to latest message"
                      >
                        <ArrowDown size={13} /> Latest
                      </button>
                    </div>
                  )}
                  <form
                    className="console-bar chat-composer"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void send();
                    }}
                  >
                    <textarea
                      aria-label="Task"
                      placeholder="What would you like to work on today?"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                    />
                    {prompt.startsWith("/") && !prompt.includes(" ") && <div className="command-autocomplete">{commandList.filter(command => `/${command.name}`.startsWith(prompt)).map(command => <button type="button" className="btn" key={command.name} onClick={() => setPrompt(`/${command.name} `)}>/{command.name} · {command.description}</button>)}</div>}
                    <div className="composer-controls">
                      <div className="composer-preferences">
                        <label className="chat-model-picker" title="Preferred model for the next task">
                          <Layers size={14} aria-hidden="true" />
                          <select aria-label="Preferred model for next task" value={enabledProviders.some(provider => provider.id === preferredProvider) ? preferredProvider : ""} disabled={busy || !enabledProviders.length} onChange={event => void changeModel(event.target.value)}>
                            <option value="">{enabledProviders.length ? "Automatic model" : "No enabled providers"}</option>
                            {enabledProviders.map(provider => <option key={String(provider.id)} value={String(provider.id)}>{String(provider.name)} · {String(provider.model)}</option>)}
                          </select>
                        </label>
                        <label className="composer-mode-picker" title="Plan: read only · Build: workspace edits · Ask: approve each action">
                          <Shield size={14} aria-hidden="true" />
                          <select className="chat-mode-picker" aria-label="Session mode" value={session ? String(sessionState.mode ?? "build") : draftMode} disabled={busy || running} onChange={event => void changeMode(event.target.value)}>
                            <option value="plan">Plan</option>
                            <option value="build">Build</option>
                            <option value="ask">Ask</option>
                          </select>
                        </label>
                      </div>
                      <button className="btn primary composer-send" type="submit" aria-label="Send task" title="Send task (Ctrl/⌘ + Enter)" disabled={busy || running || !sessionReady || sessionMissing || !prompt.trim()}>
                        <Send size={16} />
                        <span>{t.send}</span>
                      </button>
                    </div>
                  </form>
                </section>
              )}
              {tab === "providers" && (
                <section className="providers-page">
                  <div className="providers-summary"><span><Layers size={15} /><strong>{providers.length}</strong> connections</span><span><span className="status-dot" /><strong>{providers.filter(provider => provider.enabled).length}</strong> enabled</span><span><Shield size={14} /> Encrypted credentials</span></div>
                  <div className="providers-toolbar"><label className="provider-search"><Search size={16} /><input type="search" aria-label="Search providers" placeholder="Search by name, model, or endpoint…" value={providerQuery} onChange={event => setProviderQuery(event.target.value)} /></label><select aria-label="Filter provider status" value={providerFilter} onChange={event => setProviderFilter(event.target.value)}><option value="all">All connections</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></div>
                  {showForm && <ProviderForm key={String(providerEditing?.id ?? "new")} api={api} existing={providerEditing} onClose={() => { setShowForm(false); setProviderEditing(undefined); }} onSaved={refresh} />}
                  <div className="provider-connections">{providers.filter(provider => (providerFilter === "all" || Boolean(provider.enabled) === (providerFilter === "enabled")) && `${provider.name} ${provider.model} ${provider.base_url} ${provider.adapter}`.toLowerCase().includes(providerQuery.toLowerCase().trim())).map(provider => <ProviderCard key={String(provider.id)} provider={provider} api={api} onEdit={() => { setProviderEditing(provider); setShowForm(true); }} onChanged={refresh} />)}</div>
                  {!providers.length && (
                    <div className="empty providers-empty"><Layers size={30} /><h2>Your next connection starts here.</h2><p>Bring a cloud provider or local model into your workspace.</p><button className="btn primary" onClick={() => { setProviderEditing(undefined); setShowForm(true); }}><Plus size={14} /> Connect a provider</button></div>
                  )}
                  {providers.length > 0 && !providers.some(provider => (providerFilter === "all" || Boolean(provider.enabled) === (providerFilter === "enabled")) && `${provider.name} ${provider.model} ${provider.base_url} ${provider.adapter}`.toLowerCase().includes(providerQuery.toLowerCase().trim())) && <div className="empty providers-empty"><Search size={25} /><h2>No matching connections</h2><p>Try a different search or status filter.</p><button className="btn" onClick={() => { setProviderQuery(""); setProviderFilter("all"); }}>Clear filters</button></div>}
                </section>
              )}
              {tab === "sessions" && (
                <section className="panel generic">
                  {sessions.map((s) => (
                    <div className="list-card" key={String(s.id)}>
                      <div>
                        <h3>{String(s.title)}</h3>
                        <p className="muted text-xs mt-2">{String(s.id)}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          className="btn"
                          onClick={() => {
                             chooseChatSession(String(s.id));
                            setTab("chat");
                          }}
                        >
                          Open <ArrowRight size={12} />
                        </button>
                        <button
                          className="btn danger"
                          aria-label="Delete session"
                          disabled={busy}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Delete session "${String(s.title)}"? Its chat history, memory, schedules, and session workspace will be permanently removed.`,
                              )
                            )
                              return;
                            void action(async () => {
                              await api(
                                `sessions/${s.id}`,
                                undefined,
                                "DELETE",
                              );
                               if (sessionRef.current === String(s.id)) setSessionMissing(true);
                            }, "Session deleted");
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {!sessions.length && <div className="empty">{t.empty}</div>}
                </section>
              )}
              {tab === "files" && (
                <section className="panel generic">
                  <div className="toolbar files-toolbar">
                    <label className="field-label">Session
                    <select
                      aria-label="Session for workspace files"
                       value={filesSession}
                      onChange={(e) => {
                         setFilesSession(e.target.value);
                         setFiles([]);
                         setEditing("");
                        setFilePath(".");
                      }}
                    >
                      <option value="">Select a session</option>
                      {sessions.map((s) => (
                        <option key={String(s.id)} value={String(s.id)}>
                          {String(s.title)}
                        </option>
                      ))}
                    </select>
                    </label>
                    <label className="field-label">Workspace path
                    <input
                      aria-label="Workspace path"
                      value={filePath}
                      onChange={(e) => setFilePath(e.target.value)}
                      placeholder="."
                    />
                    </label>
                    <div className="files-actions">
                    <button
                      className="btn"
                       disabled={!filesSession}
                      onClick={() =>
                        void loadFiles().catch((e) => setError(String(e)))
                      }
                    >
                      <RefreshCw size={12} /> Load
                    </button>
                     <button type="button" className="btn" disabled={!filesSession} onClick={() => fileUploadRef.current?.click()}><ArrowDownToLine size={12} /> Upload</button>
                      <input
                        ref={fileUploadRef}
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                           if (!f || !filesSession) return;
                          const fd = new FormData();
                          fd.append("file", f);
                          void action(async () => {
                            const r = await fetch(
                               `/api/sessions/${filesSession}/upload`,
                              {
                                method: "POST",
                                credentials: "include",
                                body: fd,
                              },
                            );
                            const d = (await r.json().catch(() => ({}))) as Row;
                            if (!r.ok)
                              throw new Error(
                                String(d.error ?? "Upload failed"),
                              );
                            await loadFiles();
                          }, "File uploaded");
                          e.target.value = "";
                        }}
                      />
                    </div>
                  </div>
                   {!filesSession ? (
                    <div className="empty">
                      Select a session to browse its workspace.
                    </div>
                  ) : (
                    <>
                      {files.map((f) => (
                        <div className="list-card" key={f.name}>
                          <div>
                            <h3>
                              {f.directory ? "📁" : "📄"} {f.name}
                            </h3>
                          </div>
                          {(() => {
                            const next = filePath === "." ? f.name : `${filePath}/${f.name}`;
                            return <div className="flex gap-2">
                              {f.directory || !binaryFile(f.name) ? (
                                <button className="btn" onClick={() => { setFilePath(next); void loadFiles(next).catch((e) => setError(String(e))); }}>{t.open}</button>
                              ) : null}
                              {!f.directory && <a className="btn" href={`/api/sessions/${encodeURIComponent(filesSession)}/files/download?path=${encodeURIComponent(next)}`} download>{t.download} <Download size={12} /></a>}
                            </div>;
                          })()}
                        </div>
                      ))}
                      {!files.length && <div className="empty">{t.empty}</div>}
                      {editing && (
                        <>
                          <p className="muted text-xs mt-4">
                            Editing <b>{editing}</b>
                          </p>
                          <textarea
                            className="font-mono !min-h-72"
                            aria-label="File contents"
                            value={fileContent}
                            onChange={(e) => setFileContent(e.target.value)}
                          />
                          <button
                            className="btn primary mt-3"
                            onClick={() => {
                               if (!filesSession) return;
                              const fd = new FormData();
                              fd.append(
                                "file",
                                new Blob([fileContent], {
                                  type: "text/plain",
                                }),
                                editing,
                              );
                              void action(async () => {
                                const r = await fetch(
                                   `/api/sessions/${filesSession}/upload`,
                                  {
                                    method: "POST",
                                    credentials: "include",
                                    body: fd,
                                  },
                                );
                                if (!r.ok) throw new Error("Unable to save file");
                                await loadFiles();
                              }, "File saved");
                            }}
                          >
                            Save file
                          </button>
                        </>
                      )}
                    </>
                  )}
                </section>
              )}
              {tab === "skills" && (
                <section className="panel generic">
                  <div className="toolbar">
                    <button
                      className="btn primary"
                      onClick={() =>
                        setMarkdown(
                          "---\nname: new-skill\ndescription: Instructions for a specialized task\ntriggers: [build]\ntools: [bash, write_file]\n---\n\n# Instructions\n\nDeliver a working result and verify it with appropriate tests.",
                        )
                      }
                    >
                      <Plus size={12} /> New skill
                    </button>
                  </div>
                  {items.map((s) => (
                    <div className="list-card" key={String(s.name)}>
                      <div>
                        <h3>{String(s.name)}</h3>
                        <p className="muted text-xs mt-2">
                          {String(s.description)}
                        </p>
                      </div>
                      <button
                        className="btn"
                        onClick={() => setMarkdown(String(s.raw))}
                      >
                        Edit
                      </button>
                    </div>
                  ))}
                  {markdown && (
                    <>
                      <textarea
                        className="font-mono !min-h-72"
                        aria-label="Markdown skill editor"
                        value={markdown}
                        onChange={(e) => setMarkdown(e.target.value)}
                      />
                      <button
                        className="btn primary mt-3"
                        onClick={() =>
                          void action(() => api("skills", { markdown }))
                        }
                      >
                        Validate & save
                      </button>
                    </>
                  )}
                </section>
              )}
              {tab === "memory" && (
                <section className="panel generic">
                  <div className="toolbar">
                    <button className="btn" onClick={() => void api("memory/export").then((r) => { const a = document.createElement("a"); const url = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: "application/json" })); a.href = url; a.download = "pansa-memory.json"; a.click(); URL.revokeObjectURL(url); })}><Download size={13} /> Export all</button>
                    <button className="btn" onClick={() => memoryImportRef.current?.click()}><ArrowDownToLine size={13} /> Import</button><input ref={memoryImportRef} type="file" accept="application/json" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void file.text().then((text) => action(() => api("memory/import", JSON.parse(text)), "Memory imported")); e.target.value = ""; }} />
                  </div>
                  <details className="list-card document-editor"><summary>USER.md · User profile</summary><textarea aria-label="User profile" value={profileDocs.user} onChange={(e) => setProfileDocs({ ...profileDocs, user: e.target.value })} /><button className="btn" onClick={() => void action(() => api("profile/user", { content: profileDocs.user }, "PUT"), "Profile saved")}>Save profile</button></details>
                  <div className="toolbar">
                    <input
                      aria-label="Search memory"
                      placeholder="Search your memory…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <button
                      className="btn"
                      onClick={() => {
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(
                          new Blob([JSON.stringify(items, null, 2)], {
                            type: "application/json",
                          }),
                        );
                        a.download = "pansaos-memory.json";
                        a.click();
                        URL.revokeObjectURL(a.href);
                      }}
                    >
                      <ArrowDownToLine size={12} /> Export results
                    </button>
                  </div>
                  {items.map((m) => (
                    <div className="list-card" key={String(m.id)}>
                      {memoryEdit[String(m.id)] ? <div className="memory-edit-form"><label>Title<input aria-label="Memory title" value={memoryEdit[String(m.id)]!.key} onChange={(e) => setMemoryEdit({ ...memoryEdit, [String(m.id)]: { ...memoryEdit[String(m.id)]!, key: e.target.value } })} /></label><label>Memory<textarea aria-label="Memory contents" value={memoryEdit[String(m.id)]!.content} onChange={(e) => setMemoryEdit({ ...memoryEdit, [String(m.id)]: { ...memoryEdit[String(m.id)]!, content: e.target.value } })} /></label><div><button className="btn primary" disabled={busy} onClick={() => void action(async () => { await api(`memory/${m.id}`, memoryEdit[String(m.id)], "PUT"); setMemoryEdit({ ...memoryEdit, [String(m.id)]: undefined as never }); }, "Memory updated")}>Save changes</button><button className="btn" disabled={busy} onClick={() => setMemoryEdit({ ...memoryEdit, [String(m.id)]: undefined as never })}>Cancel</button></div></div> : <div>
                        <span className="badge">{String(m.kind)}</span>
                        <h3 className="mt-3">{String(m.key)}</h3>
                        <p className="text-xs muted mt-2 whitespace-pre-wrap">
                          {String(m.content)}
                        </p>
                      </div>}
                      {!memoryEdit[String(m.id)] && <button className="btn" aria-label="Edit memory" onClick={() => setMemoryEdit({ ...memoryEdit, [String(m.id)]: { key: String(m.key), content: String(m.content) } })}>Edit</button>}
                      <button
                        className="btn danger"
                        aria-label="Delete memory"
                        disabled={busy || Boolean(memoryEdit[String(m.id)])}
                        onClick={() =>
                          void action(async () => {
                            await api(`memory/${m.id}`, undefined, "DELETE");
                            setItems(items.filter((i) => i.id !== m.id));
                          }, "Memory deleted")
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  {!items.length && (
                    <div className="empty">
                      Memories appear as your assistant learns what matters to you.
                    </div>
                  )}
                  <details className="list-card document-editor"><summary>MEMORY.md · Curated memory</summary><textarea aria-label="Curated memory" value={profileDocs.memory} onChange={(e) => setProfileDocs({ ...profileDocs, memory: e.target.value })} /><button className="btn" onClick={() => void action(() => api("profile/memory", { content: profileDocs.memory }, "PUT"), "Curated memory saved")}>Save memory</button></details>
                </section>
              )}
              {tab === "tools" && (
                <section className="panel generic">
                  {items.length ? (
                    items.map((tool) => (
                      <div className="list-card" key={String(tool.name)}>
                        <div>
                          <h3>{String(tool.name)}</h3>
                          <p className="muted text-xs mt-2">
                            {String(tool.description)}
                          </p>
                        </div>
                        <div className="flex gap-2 items-center">
                          <span className="badge">
                            {tool.risky ? "approval" : "sandbox"}
                          </span>
                          <button
                            className="btn"
                            onClick={() =>
                              void action(
                                async () => {
                                  await api(
                                    `tools/${tool.name}`,
                                    { enabled: !tool.enabled },
                                    "PATCH",
                                  );
                                  setItems(
                                    items.map((i) =>
                                      i.name === tool.name
                                        ? { ...i, enabled: !i.enabled }
                                        : i,
                                    ),
                                  );
                                },
                                tool.enabled ? "Tool disabled" : "Tool enabled",
                              )
                            }
                          >
                            {tool.enabled ? "Disable" : "Enable"}
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="empty">The tool catalog is loaded from core.</div>
                  )}
                </section>
              )}
              {tab === "settings" && (
                <section className="panel generic">
                  <h2 className="mb-4">Workspace preferences</h2>
                  <TelegramSettingsPanel api={api} />
                  <div className="list-card">
                    <span>Navigation language</span>
                    <select
                      aria-label="Navigation language"
                      value={lang}
                      onChange={(e) => setLang(e.target.value as "id" | "en")}
                    >
                      <option value="id">Bahasa Indonesia</option>
                      <option value="en">English</option>
                    </select>
                  </div>
                  <div className="list-card"><span>Project directory</span><code>{String(settingsInfo.workspace_dir ?? "—")}</code></div>
                  <div className="list-card document-editor"><span>SOUL.md · Assistant persona</span><textarea aria-label="Assistant persona" value={profileDocs.soul} onChange={(e) => setProfileDocs({ ...profileDocs, soul: e.target.value })} /><button className="btn" onClick={() => void action(() => api("profile/soul", { content: profileDocs.soul }, "PUT"), "Persona saved")}>Save persona</button></div>
                  <div className="list-card document-editor"><span>USER.md · User profile</span><textarea aria-label="User profile" value={profileDocs.user} onChange={(e) => setProfileDocs({ ...profileDocs, user: e.target.value })} /><button className="btn" onClick={() => void action(() => api("profile/user", { content: profileDocs.user }, "PUT"), "Profile saved")}>Save profile</button></div>
                  <div className="list-card tz-card">
                    <span>Time zone</span>
                    <div className="tz-control">
                      <select
                        aria-label="Time zone"
                        value={zone}
                        onChange={(e) => {
                          const next = e.target.value;
                          setZone(next);
                          setSettings((prev) => ({ ...prev, timezone: next }));
                          void action(async () => {
                            await api("settings", { timezone: next });
                          }, null);
                        }}
                      >
                        {zoneList().map((z) => (
                          <option key={z} value={z}>
                            {z}
                          </option>
                        ))}
                      </select>
                      <span className="tz-offset">
                        {zoneLabel(zone) ? `${zone} (${zoneLabel(zone)})` : zone}
                      </span>
                    </div>
                  </div>
                  <div className="list-card">
                    <span>Realtime connection</span>
                    <span className="badge">
                      {connected ? "CONNECTED" : "RECONNECTING"}
                    </span>
                  </div>
                  <div className="list-card">
                    <span>Execution mode</span>
                    <span className="badge">
                      {String(settingsInfo.sandbox ?? "docker")} · network{" "}
                      {settingsInfo.sandbox_network ? "on" : "off"}
                    </span>
                  </div>
                  <h2 className="mt-6 mb-4">Agent</h2>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void action(
                        () =>
                          api("settings", {
                            max_steps: Number(settings.max_steps) || undefined,
                            timezone: settings.timezone || DEFAULT_TIMEZONE,
                          }),
                        "Settings saved",
                      );
                    }}
                  >
                    <div className="list-card">
                      <span>Maximum steps per task</span>
                      <input
                        aria-label="Maximum steps"
                        type="number"
                        min={1}
                        max={100}
                        value={settings.max_steps}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            max_steps: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                    <button className="btn primary" disabled={busy}>
                      Save settings
                    </button>
                  </form>
                  <h2 className="mt-6 mb-4">Backup</h2>
                  <div className="list-card">
                    <span>Database snapshot</span>
                    <button
                      className="btn"
                      onClick={() =>
                        void action(
                          () => api("backup", {}),
                          "Backup created in the data directory",
                        )
                      }
                    >
                      <ArrowDownToLine size={12} /> Back up now
                    </button>
                  </div>
                  <p className="muted text-xs leading-6">
                    Configure the dashboard token, encryption key, and execution resources through the server environment. Telegram can be configured above. Use the Pansa CLI for backup and restore.
                  </p>
                </section>
              )}
            </div>
          </AnimatePresence>
          <footer className="footer">
            <div className="footer-brand">
              <div className="footer-logo">
                <span className="footer-mark">
                  <Zap size={12} />
                </span>
                <span>PANSAOS <span className="light">/</span> PERSONAL ASSISTANT</span>
              </div>
              <p className="footer-tagline">
                One workspace for your conversations, tasks, and personal memory.
              </p>
            </div>
            <nav className="footer-links" aria-label="Footer links">
              <a
                href="https://github.com/jhodypedia/PansaOS"
                target="_blank"
                rel="noreferrer"
              >
                <Github size={12} /> Repository
              </a>
              <a
                href="https://github.com/jhodypedia/PansaOS/issues"
                target="_blank"
                rel="noreferrer"
              >
                <Shield size={12} /> Report an issue
              </a>
              <a
                href="https://github.com/jhodypedia/PansaOS#readme"
                target="_blank"
                rel="noreferrer"
              >
                <BookOpen size={12} /> Documentation
              </a>
              <a
                href="https://github.com/jhodypedia/PansaOS/releases"
                target="_blank"
                rel="noreferrer"
              >
                <FileText size={12} /> Releases
              </a>
            </nav>
            <div className="footer-meta">
              <span className={`footer-chip ${connected ? "is-live" : ""}`}>
                <span className="status-dot !w-1 !h-1" />
                {connected ? "LIVE" : "CONNECTING"}
              </span>
              <span className="footer-chip">
                <Server size={11} /> v1.0.0
              </span>
              <span className="footer-chip" title={zoneLabel(zone)}>
                <Clock size={11} /> {zone.split("/").pop()?.replace(/_/g, " ")}
              </span>
            </div>
          </footer>
        </div>
      </main>
      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="toast"
          >
            <Check size={14} className="inline text-[var(--cyan)] mr-2" />
            {notice}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
