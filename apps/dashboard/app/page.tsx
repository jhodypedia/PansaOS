"use client";
import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
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
  ListChecks,
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
  Square,
  Sun,
  Terminal,
  Trash2,
  Trophy,
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
  ["bounties", Trophy],
  ["schedules", Clock],
  ["settings", Settings],
] as const;
function Rich({ text }: { text: string }) {
  const blocks = useMemo(() => splitFences(text), [text]);
  return (
    <>
      {blocks.map((b, i) =>
        b.code !== undefined ? (
          <pre className="code-block" key={i}>
            {b.lang && <span className="code-lang">{b.lang}</span>}
            <code>{b.code}</code>
          </pre>
        ) : (
          <p className="rich" key={i}>
            {inline(b.text)}
          </p>
        ),
      )}
    </>
  );
}
function splitFences(text: string): { code?: string; lang?: string; text: string }[] {
  const out: { code?: string; lang?: string; text: string }[] = [];
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ code: (m[2] ?? "").replace(/\n$/, ""), lang: m[1] || undefined, text: "" });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.filter((b) => b.code !== undefined || b.text.trim());
}
function inline(text: string) {
  const parts = text.split(/(`[^`]+`|https?:\/\/[^\s)<>]+)/g);
  return parts.map((p, i) => {
    if (/^`[^`]+`$/.test(p)) return <code key={i}>{p.slice(1, -1)}</code>;
    if (/^https?:\/\//.test(p))
      return (
        <a key={i} href={p} target="_blank" rel="noreferrer noopener">
          {p}
        </a>
      );
    return <span key={i}>{p}</span>;
  });
}
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
      {output ? (
        <pre className="action-out">{output.length > 3000 ? `${output.slice(0, 3000)}\n…` : output}</pre>
      ) : (
        <p className="muted text-xs mt-2">Belum ada output.</p>
      )}
      {onOpen && (
        <button className="btn mt-2" onClick={onOpen}>
          <Terminal size={11} /> Buka di Console
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
const DEFAULT_TIMEZONE = "Asia/Jakarta";
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
    const parts = new Intl.DateTimeFormat("id-ID", {
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
    return stamp.toLocaleTimeString("id-ID", { ...opts, timeZone: zone });
  } catch {
    return stamp.toLocaleTimeString("id-ID", opts);
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
    return stamp.toLocaleString("id-ID", { ...format, timeZone: zone });
  } catch {
    return stamp.toLocaleString("id-ID", format);
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
}: {
  sessions: Row[];
  value: string;
  onChange: (id: string) => void;
  zone?: string;
}) {
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0),
    [pos, setPos] = useState({ top: 0, left: 0, width: 240, max: 320 });
  const trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const options = useMemo(
    () => [
      { id: "", label: "Session baru", meta: "", fresh: true },
      ...sessions.map((s) => ({
        id: String(s.id),
        label: shorten(String(s.title ?? "")),
        meta: shortDate(String(s.created_at ?? ""), zone),
        fresh: false,
      })),
    ],
    [sessions, zone],
  );
  const current = options.find((o) => o.id === value) ?? options[0] ?? {
    id: "",
    label: "Session baru",
    meta: "",
    fresh: true,
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
    if (!option) return;
    onChange(option.id);
    close(true);
  };
  return (
    <div className="session-picker">
      <button
        ref={trigger}
        type="button"
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
            aria-label="Daftar session"
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
              <div className="session-empty">Belum ada session tersimpan.</div>
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
  const [token, setToken] = useState(""),
    [logged, setLogged] = useState(false),
    [tab, setTab] = useState<Tab>("overview"),
    [lang, setLang] = useState<"id" | "en">("id"),
    [theme, setTheme] = useState<"dark" | "light">("dark"),
    [navOpen, setNavOpen] = useState(false);
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
      makefun_base_url: "",
      makefun_credentials: "",
      max_steps: 25,
      timezone: DEFAULT_TIMEZONE,
    }),
    [settingsInfo, setSettingsInfo] = useState<Row>({}),
    [schedule, setSchedule] = useState({ cron: "0 9 * * *", prompt: "" }),
    [form, setForm] = useState({
      name: "",
      base_url: "https://api.openai.com/v1",
      api_key: "",
      model: "",
    });
  const buffer = useRef("");
  const ticker = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
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
          message ?? "Sesi berakhir. Masuk kembali dengan token admin.",
        );
      }
      if (!response.ok) throw new Error(message ?? "Request gagal");
      return data;
    },
    [],
  );
  const notify = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(""), 4500);
  };
  const refresh = useCallback(async () => {
    const [e, p, s, st, a] = await Promise.all([
      api("events"),
      api("providers"),
      api("sessions"),
      api("stats"),
      api("approvals"),
    ]);
    setEvents(e as Row[]);
    setProviders(p as Row[]);
    setSessions(s as Row[]);
    setStats(st as Row);
    setApprovals(a as Row[]);
  }, [api]);
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
      if (!response.ok) throw new Error("Gagal memuat halaman event");
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
      history.replaceState(null, "", location.pathname);
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
        setEvents((prev) => [e, ...prev].slice(0, 300));
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
          notify(`Provider berpindah: ${payload.reason}`);
        if (e.type === "task" || e.type === "approval" || e.type === "usage")
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
        ? `memory?q=${encodeURIComponent(query)}`
        : ["skills", "bounties", "tools", "schedules"].includes(tab)
          ? tab
          : null;
    if (route)
      api(route)
        .then((r) => setItems(r as Row[]))
        .catch((e) => setError(String(e)));
  }, [tab, logged, query, api]);
  const loadFiles = useCallback(
    async (p = filePath) => {
      if (!session) return;
      const r = (await api(
        `sessions/${session}/files?path=${encodeURIComponent(p)}`,
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
    [api, session, filePath],
  );
  useEffect(() => {
    if (tab !== "files" || !logged || !session) return;
    void loadFiles().catch((e) => setError(String(e)));
  }, [tab, logged, session, loadFiles]);
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
          makefun_base_url: String(s.makefun_base_url ?? ""),
          max_steps: Number(s.max_steps ?? 25),
          timezone: saved,
        }));
      })
      .catch((e) => setError(String(e)));
  }, [tab, logged, api]);
  const action = async (
    fn: () => Promise<unknown>,
    message: string | null = "Tersimpan",
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
    if (!text.trim()) return;
    await action(async () => {
      let id = session;
      if (!id) {
        const created = (await api("sessions", {
          title: text.slice(0, 50),
        })) as Row;
        id = String(created.id);
        setSession(id);
      }
      setStream("");
      await api(`sessions/${id}/message`, { prompt: text });
      setPrompt("");
    }, "Task dikirim");
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
      const seen = new Set(prev.map((x) => String(x.id)));
      const added = incoming.filter((x) => !seen.has(String(x.id)));
      if (!added.length) return prev;
      return [...added, ...prev]
        .sort((a, b) => Number(b.id) - Number(a.id))
        .slice(0, 600);
    });
  }, []);
  useEffect(() => {
    if (!logged || !session) return;
    void api(`events?session=${encodeURIComponent(session)}`)
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
  }, [events, session, data]);
  const activeProvider = useMemo(() => {
    const pinned = sessions.find((s) => String(s.id) === session)?.pinned;
    if (pinned) {
      const p = providers.find((x) => String(x.id) === String(pinned));
      if (p) return `${String(p.name)} · ${String(p.model)}`;
    }
    const first = providers.find((p) => p.enabled);
    return first ? `${String(first.name)} · ${String(first.model)}` : "—";
  }, [sessions, session, providers]);
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
  const bountySteps = useMemo(
    () =>
      timeline
        .filter(
          (i) => i.type === "tool" && String(data(i.e).tool ?? "").startsWith("makefun_"),
        )
        .map((i) => {
          const d = data(i.e);
          return {
            key: i.key,
            name: String(d.tool).replace(/^makefun_/, ""),
            status: String(d.status ?? ""),
          };
        }),
    [timeline, data],
  );
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
    if (!el || !stick) return;
    el.scrollTop = el.scrollHeight;
  }, [timeline, stream, view, stick]);
  const onScroll = () => {
    const el = historyRef.current;
    if (!el) return;
    setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  };
  const jump = () => {
    const el = historyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setStick(true);
  };
  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(label);
    } catch {
      setError("Clipboard tidak tersedia di browser ini");
    }
  };
  const download = () => {
    const blob = new Blob([transcript], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pansa-${session.slice(0, 8) || "chat"}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    notify("Transkrip diunduh");
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
      time: new Date(time).toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: zone,
      }),
      tokens: usage.reduce((sum, e) => sum + Number(data(e).tokens ?? 0), 0),
      cost: usage.reduce((sum, e) => sum + Number(data(e).cost ?? 0), 0),
    };
  });
  const Feed = ({ all = false, rows }: { all?: boolean; rows?: Row[] }) => (
    <div className={all ? "" : "feed"}>
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
      <div className="login">
        <motion.form
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel login-card"
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              await api("auth", { token });
              setToken("");
              setLogged(true);
            }, "Selamat datang");
          }}
        >
          <div className="brand">
            <span className="brand-icon">
              <Command size={22} />
            </span>
            Pansa<em>OS</em>
          </div>
          <h1 className="text-xl">{t.login}</h1>
          <p className="muted mt-2 text-xs">{t.tagline}</p>
          <input
            type="password"
            autoComplete="current-password"
            aria-label="Token admin"
            placeholder="Token admin dari installer"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
          />
          {error && <p className="error">{error}</p>}
          <button className="btn primary" disabled={busy}>
            Hubungkan <ArrowRight size={13} />
          </button>
        </motion.form>
      </div>
    );
  return (
    <div className={navOpen ? "app nav-open" : "app"}>
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
      <aside className="sidebar">
        <a className="brand" href="#" onClick={() => setTab("overview")}>
          <span className="brand-icon">
            <Command size={22} />
          </span>
          <span className="brand-text">
            Pansa<em>OS</em>
            <span className="text-[8px] tracking-normal muted ml-2">
              v1.0
            </span>
          </span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav className="nav">
          {tabs.slice(0, 7).map(([key, Icon]) => (
            <button
              key={key}
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
          {tabs.slice(7, 11).map(([key, Icon]) => (
            <button
              key={key}
              onClick={() => {
                setTab(key);
                setNavOpen(false);
              }}
              className={tab === key ? "active" : ""}
            >
              <Icon size={16} />
              <span>{t[key]}</span>
              {key === "bounties" && (
                <span className="ml-auto text-[10px]">↗</span>
              )}
            </button>
          ))}
          <div className="nav-label">SYSTEM</div>
          <button
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
            {connected ? "Semua sistem terhubung" : "Menghubungkan realtime"}
            <p>Self-hosted. Sepenuhnya milikmu.</p>
            <div className="flex justify-between mt-3 text-[9px] muted">
              <span>CORE ENGINE</span>
              <span style={{ color: "var(--cyan)" }}>
                {connected ? "ONLINE" : "CONNECTING"}
              </span>
            </div>
          </div>
          <div className="flex justify-between items-center pt-5 text-[10px] muted">
            <span>
              Dokumentasi <ExternalLink size={10} className="inline ml-1" />
            </span>
            <button
              aria-label="Keluar"
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
            aria-label="Buka menu"
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
              {Number(stats.running) > 0 ? "Agent bekerja" : "Agent siap"}
            </span>
            <span className="keycap">SELF-HOSTED</span>
            <button
              className="icon-btn theme"
              aria-label={theme === "dark" ? "Mode terang" : "Mode gelap"}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button
              className="icon-btn theme"
              aria-label="Notifikasi"
              onClick={() => setTab("live")}
            >
              <Bell size={15} />
            </button>
            <div className="avatar">PA</div>
          </div>
        </header>
        <div className="content">
          <div className="page-title">
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
                {tab === "overview"
                  ? "Semua agent, aktivitas, dan bounty. Satu ruang kendali."
                  : t.tagline}
              </p>
            </div>
            <div className="title-actions">
              <button
                className="btn icon-only"
                aria-label="Refresh"
                title="Refresh"
                onClick={() => void action(refresh, "Data diperbarui")}
              >
                <RefreshCw size={12} /> <span className="label">Refresh</span>
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  setTab("chat");
                  setSession("");
                }}
              >
                <Plus size={13} /> Task baru
              </button>
            </div>
          </div>
          {error && <div className="error">{error}</div>}
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
            >
              {tab === "overview" && (
                <>
                  <div className="stats">
                    {[
                      [
                        "Total events",
                        stats.events ?? 0,
                        Activity,
                        "Aktivitas tercatat",
                      ],
                      [
                        "Token terpakai",
                        stats.tokens ?? 0,
                        Zap,
                        "Seluruh provider",
                      ],
                      [
                        "Estimasi biaya",
                        stats.cost ?? 0,
                        DollarSign,
                        "USD · berdasarkan konfigurasi",
                      ],
                      [
                        "Tool executions",
                        stats.tools ?? 0,
                        Terminal,
                        "Eksekusi & hasil tool",
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
                        <motion.div
                          key={String(label)}
                          initial={{ opacity: 0, y: 15 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.055 }}
                          whileHover={{ y: -3 }}
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
                        </motion.div>
                      );
                    })}
                  </div>
                  <div className="row">
                    <section className="panel">
                      <div className="panel-header">
                        <h2>
                          <Activity size={14} /> Penggunaan token{" "}
                          <span className="badge ml-2">REALTIME</span>
                        </h2>
                        <div className="chart-legend">
                          <span>
                            <i className="legend-dot" />
                            Tokens
                          </span>
                          <span>
                            60 menit{" "}
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
                          <Network size={14} /> Arsitektur live
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
                          <Radio size={14} /> Aktivitas terbaru{" "}
                          <span className="badge ml-2">LIVE</span>
                        </h2>
                        <button
                          className="text-[10px] text-[var(--text-2)] flex gap-2 items-center"
                          onClick={() => setTab("live")}
                        >
                          Lihat semua <ArrowUpRight size={12} />
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
                          Kelola <ArrowUpRight size={12} className="inline" />
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
                            <Plus size={12} /> Tambah provider
                          </button>
                        </div>
                      )}
                      <div className="px-5 py-4 flex justify-between text-[9px] font-mono text-[var(--text-dim)]">
                        <span>PRIORITY-BASED FAILOVER</span>
                        <Shield size={12} className="text-[var(--cyan)]" />
                      </div>
                    </section>
                  </div>
                  <div className="panel px-5 py-4 flex flex-wrap gap-5 items-center justify-between">
                    <div className="flex gap-3 items-center">
                      <span className="stat-icon">
                        <Trophy size={16} />
                      </span>
                      <div>
                        <p className="text-xs">
                          Bounty berikutnya, hasil berikutnya.
                        </p>
                        <p className="text-[10px] text-[var(--text-dim)] mt-1">
                          Dari brief make.fun sampai paket submit, dalam satu
                          alur.
                        </p>
                      </div>
                    </div>
                    <button className="btn" onClick={() => setTab("bounties")}>
                      Buka bounty board <ArrowRight size={12} />
                    </button>
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
                      aria-label="Cari event"
                      placeholder="Cari event..."
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
                      Pencarian mencakup seluruh riwayat event di server.
                      {totalEvents !== null ? ` ${totalEvents} event cocok.` : ""}
                    </p>
                  )}
                  {pending > 0 && pageNo > 1 && (
                    <button
                      className="btn new-events ml-5 mr-5 mt-4"
                      onClick={() => void resetPages(pageSize, query)}
                    >
                      <Bell size={12} /> {pending} event baru — kembali ke
                      halaman 1
                    </button>
                  )}
                  <Feed all rows={pageCache[pageNo] ?? []} />
                  <div className="pager">
                    <button
                      className="btn"
                      disabled={pageNo === 1 || pageBusy}
                      onClick={() => void loadPage(pageNo - 1)}
                    >
                      <ChevronLeft size={13} /> Sebelumnya
                    </button>
                    <span className="pager-info">
                      Halaman {pageNo}
                      {totalEvents !== null
                        ? ` dari ${Math.max(1, Math.ceil(totalEvents / pageSize))}`
                        : hasMore
                          ? " · masih ada event lama"
                          : ""}
                    </span>
                    <button
                      className="btn"
                      disabled={!hasMore || pageBusy}
                      onClick={() => void loadPage(pageNo + 1)}
                    >
                      Berikutnya <ChevronRight size={13} />
                    </button>
                    <label className="pager-size">
                      <span>Per halaman</span>
                      <select
                        aria-label="Jumlah event per halaman"
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
                        if (!session) {
                          setError("Pilih atau buat session dulu di Chat.");
                          return;
                        }
                        void action(
                          () =>
                            api("schedules", {
                              cron: schedule.cron,
                              prompt: schedule.prompt,
                              session_id: session,
                            }),
                          "Jadwal dibuat",
                        ).then(() => setSchedule({ ...schedule, prompt: "" }));
                      }}
                    >
                      <select
                        aria-label="Session jadwal"
                        value={session}
                        onChange={(e) => setSession(e.target.value)}
                      >
                        <option value="">Pilih session</option>
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
                        aria-label="Prompt jadwal"
                        placeholder="Prompt yang dijalankan otomatis"
                        value={schedule.prompt}
                        onChange={(e) =>
                          setSchedule({ ...schedule, prompt: e.target.value })
                        }
                        required
                      />
                      <button className="btn primary" disabled={busy}>
                        <Plus size={12} /> Tambah jadwal
                      </button>
                    </form>
                    {items.map((s) => (
                      <div className="list-card" key={String(s.id)}>
                        <div>
                          <h3>
                            <Clock size={12} className="inline mr-2" />
                            {String(s.cron)}
                            <span className="badge ml-2">
                              {s.enabled ? "aktif" : "off"}
                            </span>
                          </h3>
                          <p className="muted text-xs mt-2">
                            {String(s.prompt)}
                          </p>
                          <p className="text-[10px] muted mt-1">
                            Session {String(s.session_id)} · terakhir{" "}
                            {Number(s.last_run)
                              ? fmtDate(Number(s.last_run), zone)
                              : "belum pernah"}
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
                                "Jadwal diperbarui",
                              )
                            }
                          >
                            {s.enabled ? "Nonaktifkan" : "Aktifkan"}
                          </button>
                          <button
                            className="btn danger"
                            aria-label="Hapus jadwal"
                            onClick={() =>
                              void action(async () => {
                                await api(
                                  `schedules/${s.id}`,
                                  undefined,
                                  "DELETE",
                                );
                                setItems(items.filter((i) => i.id !== s.id));
                              }, "Jadwal dihapus")
                            }
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {!items.length && (
                      <div className="empty">
                        Belum ada jadwal. Maintenance otomatis berjalan lewat
                        runner @boxd/run.
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
                      onChange={(id) => {
                        setSession(id);
                        setStream("");
                        setStick(true);
                      }}
                    />
                    <div className="seg" role="tablist" aria-label="Mode tampilan">
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
                    <span className="chat-provider" title="Provider aktif">
                      <Layers size={11} /> {activeProvider}
                    </span>
                    <div className="chat-actions">
                      <button
                        className="icon-btn"
                        aria-label="Salin transkrip"
                        title="Salin transkrip"
                        disabled={!transcript}
                        onClick={() => void copy(transcript, "Transkrip disalin")}
                      >
                        <Copy size={13} />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label="Unduh transkrip"
                        title="Unduh transkrip (.md)"
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
                              if (r?.status !== "idle") notify("Task dihentikan");
                              setStream("");
                            }, null)
                          }
                        >
                          <Square size={12} /> Stop
                        </button>
                      )}
                    </div>
                  </div>
                  {bountySteps.length > 0 && (
                    <div className="bounty-steps">
                      <span className="bounty-steps-title">
                        <ListChecks size={12} /> Progres bounty
                      </span>
                      {bountySteps.map((s) => (
                        <span
                          key={s.key}
                          className={`step ${s.status === "done" ? "done" : s.status === "error" ? "bad" : "run"}`}
                        >
                          {s.status === "done" ? (
                            <Check size={10} />
                          ) : s.status === "error" ? (
                            <X size={10} />
                          ) : (
                            <RefreshCw size={10} className="spin" />
                          )}
                          {s.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="chat-shell">
                    <div
                      className={`chat-history ${view === "console" ? "console" : ""}`}
                      ref={historyRef}
                      onScroll={onScroll}
                      aria-live="polite"
                    >
                      {!session && (
                        <div className="empty">
                          <Bot size={32} />
                          <p>Brief masuk. Agent bergerak.</p>
                          <p className="mt-2 text-[10px]">
                            Tulis task atau tempel brief bounty untuk memulai.
                          </p>
                        </div>
                      )}
                      {session && !timeline.length && !stream && (
                        <div className="empty">
                          <MessageSquare size={26} />
                          <p>Belum ada percakapan di sesi ini.</p>
                        </div>
                      )}
                      {view === "chat"
                        ? timeline.map((i) => {
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
                                    {String(d.role ?? "agent")}
                                  </span>
                                  <Rich text={text} />
                                </div>
                              );
                            }
                            if (i.type === "tool")
                              return (
                                <ActionBlock
                                  key={i.key}
                                  e={i.e}
                                  onOpen={() => setView("console")}
                                />
                              );
                            if (i.type === "switch")
                              return (
                                <div className="notice-row" key={i.key}>
                                  <RefreshCw size={11} /> Provider berpindah:{" "}
                                  {String(
                                    d.reason ??
                                      `${String(d.fromName ?? d.from ?? "")} → ${String(d.toName ?? d.to ?? "")}`,
                                  )}
                                </div>
                              );
                            if (i.type === "error")
                              return (
                                <div className="notice-row bad" key={i.key}>
                                  <Shield size={11} />{" "}
                                  {String(d.error ?? "Terjadi kesalahan")}
                                </div>
                              );
                            if (i.type === "task")
                              return (
                                <div
                                  className={`notice-row task ${String(d.status ?? "")}`}
                                  key={i.key}
                                >
                                  <Activity size={11} /> Task{" "}
                                  {String(d.status ?? "")}
                                  {d.cost !== undefined &&
                                    ` · $${Number(d.cost).toFixed(4)}`}
                                  {d.error ? ` · ${String(d.error)}` : ""}
                                </div>
                              );
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
                      {stream && (
                        <div className="bubble streaming">
                          <span className="bubble-role">streaming</span>
                          <pre className="stream-text">{stream}</pre>
                        </div>
                      )}
                    </div>
                    {!stick && (
                      <button
                        className="chat-jump"
                        onClick={jump}
                        aria-label="Ke pesan terbaru"
                      >
                        <ArrowDown size={13} /> Terbaru
                      </button>
                    )}
                  </div>
                  {approvals
                    .filter((a) => a.session_id === session)
                    .map((a) => (
                      <div key={String(a.id)} className="bubble approval mb-4">
                        <p>Approval: {String(a.tool)}</p>
                        <pre className="text-xs my-3">{String(a.args)}</pre>
                        <button
                          className="btn primary mr-2"
                          onClick={() =>
                            void action(() =>
                              api(`approvals/${a.id}`, { approved: true }),
                            )
                          }
                        >
                          <Check size={13} /> Setuju
                        </button>
                        <button
                          className="btn danger"
                          onClick={() =>
                            void action(() =>
                              api(`approvals/${a.id}`, { approved: false }),
                            )
                          }
                        >
                          <X size={13} /> Tolak
                        </button>
                      </div>
                    ))}
                  <form
                    className="console-bar"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void send();
                    }}
                  >
                    <textarea
                      aria-label="Task"
                      placeholder="Apa yang ingin kamu bangun hari ini?"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                    />
                    <button
                      className="btn primary h-11"
                      disabled={busy || !prompt.trim()}
                    >
                      <Send size={14} />
                      {t.send}
                    </button>
                  </form>
                </section>
              )}
              {tab === "providers" && (
                <section className="panel generic">
                  <div className="toolbar">
                    <button
                      className="btn primary"
                      onClick={() => setShowForm(!showForm)}
                    >
                      <Plus size={13} /> Tambah provider
                    </button>
                    <span className="muted text-xs self-center">
                      Key terenkripsi AES-256-GCM · auto failover aktif
                    </span>
                  </div>
                  {showForm && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void action(async () => {
                          await api("providers", form);
                          setShowForm(false);
                          setForm({ ...form, api_key: "" });
                        });
                      }}
                    >
                      <div className="form-grid">
                        {(Object.keys(form) as (keyof typeof form)[]).map(
                          (k) => (
                            <input
                              key={k}
                              aria-label={k}
                              placeholder={k}
                              type={k === "api_key" ? "password" : "text"}
                              value={form[k]}
                              onChange={(e) =>
                                setForm({ ...form, [k]: e.target.value })
                              }
                              required={k !== "api_key"}
                            />
                          ),
                        )}
                      </div>
                      <button className="btn primary" disabled={busy}>
                        Simpan provider
                      </button>
                    </form>
                  )}
                  {providers.map((p) => (
                    <div className="list-card" key={String(p.id)}>
                      <div>
                        <h3>
                          {String(p.name)}{" "}
                          <span className="badge ml-2">
                            {p.enabled ? "aktif" : "off"}
                          </span>
                        </h3>
                        <p className="text-xs muted mt-2">
                          {String(p.model)} · {String(p.api_key)} ·{" "}
                          {Math.round(Number(p.latency))}ms
                        </p>
                        <p className="text-[10px] muted mt-2">
                          Success{" "}
                          {Number(p.attempts)
                            ? Math.round(
                                (Number(p.successes) / Number(p.attempts)) *
                                  100,
                              )
                            : 0}
                          % · priority {String(p.priority)}
                        </p>
                      </div>
                      <div className="flex gap-2 items-center">
                        <button
                          className="btn"
                          aria-label="Aktifkan atau matikan provider"
                          onClick={() =>
                            void action(
                              () =>
                                api(
                                  `providers/${p.id}`,
                                  {
                                    enabled: !p.enabled,
                                  },
                                  "PATCH",
                                ),
                              p.enabled
                                ? "Provider dimatikan"
                                : "Provider aktif",
                            )
                          }
                        >
                          {p.enabled ? "Off" : "On"}
                        </button>
                        <input
                          aria-label="Prioritas provider"
                          className="!w-16 !py-2 text-center"
                          type="number"
                          value={Number(p.priority ?? 0)}
                          onChange={(e) =>
                            setProviders((prev) =>
                              prev.map((x) =>
                                x.id === p.id
                                  ? { ...x, priority: e.target.value }
                                  : x,
                              ),
                            )
                          }
                          onBlur={(e) =>
                            void action(
                              () =>
                                api(
                                  `providers/${p.id}`,
                                  { priority: Number(e.target.value) || 0 },
                                  "PATCH",
                                ),
                              "Prioritas disimpan",
                            )
                          }
                        />
                        <button
                          className="btn"
                          onClick={() =>
                            void action(
                              () => api(`providers/${p.id}/test`, {}),
                              "Koneksi berhasil",
                            )
                          }
                        >
                          <Play size={12} /> Test
                        </button>
                        <button
                          className="btn danger"
                          aria-label="Hapus provider"
                          onClick={() =>
                            void action(() =>
                              api(`providers/${p.id}`, undefined, "DELETE"),
                            )
                          }
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {!providers.length && (
                    <div className="empty">
                      Belum ada provider. Tambahkan endpoint OpenAI-compatible
                      atau Anthropic.
                    </div>
                  )}
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
                            setSession(String(s.id));
                            setTab("chat");
                          }}
                        >
                          Buka <ArrowRight size={12} />
                        </button>
                        <button
                          className="btn danger"
                          aria-label="Hapus sesi"
                          disabled={busy}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Hapus sesi "${String(s.title)}"? Riwayat chat, memori, jadwal, dan workspace-nya ikut terhapus permanen.`,
                              )
                            )
                              return;
                            void action(async () => {
                              await api(
                                `sessions/${s.id}`,
                                undefined,
                                "DELETE",
                              );
                              if (session === String(s.id)) {
                                setSession("");
                                setStream("");
                              }
                            }, "Sesi dihapus");
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
                  <div className="toolbar">
                    <select
                      aria-label="Session untuk file"
                      value={session}
                      onChange={(e) => {
                        setSession(e.target.value);
                        setFilePath(".");
                      }}
                    >
                      <option value="">Pilih session</option>
                      {sessions.map((s) => (
                        <option key={String(s.id)} value={String(s.id)}>
                          {String(s.title)}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label="Path workspace"
                      value={filePath}
                      onChange={(e) => setFilePath(e.target.value)}
                      placeholder="."
                    />
                    <button
                      className="btn"
                      disabled={!session}
                      onClick={() =>
                        void loadFiles().catch((e) => setError(String(e)))
                      }
                    >
                      <RefreshCw size={12} /> Muat
                    </button>
                    <label className="btn cursor-pointer">
                      <ArrowDownToLine size={12} /> Unggah
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f || !session) return;
                          const fd = new FormData();
                          fd.append("file", f);
                          void action(async () => {
                            const r = await fetch(
                              `/api/sessions/${session}/upload`,
                              {
                                method: "POST",
                                credentials: "include",
                                body: fd,
                              },
                            );
                            const d = (await r.json().catch(() => ({}))) as Row;
                            if (!r.ok)
                              throw new Error(
                                String(d.error ?? "Upload gagal"),
                              );
                            await loadFiles();
                          }, "File terunggah");
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                  {!session ? (
                    <div className="empty">
                      Pilih session untuk melihat workspace-nya.
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
                          <button
                            className="btn"
                            onClick={() => {
                              const next =
                                filePath === "."
                                  ? f.name
                                  : `${filePath}/${f.name}`;
                              setFilePath(next);
                              void loadFiles(next).catch((e) =>
                                setError(String(e)),
                              );
                            }}
                          >
                            Buka
                          </button>
                        </div>
                      ))}
                      {!files.length && <div className="empty">{t.empty}</div>}
                      {editing && (
                        <>
                          <p className="muted text-xs mt-4">
                            Mengedit <b>{editing}</b>
                          </p>
                          <textarea
                            className="font-mono !min-h-72"
                            aria-label="Isi file"
                            value={fileContent}
                            onChange={(e) => setFileContent(e.target.value)}
                          />
                          <button
                            className="btn primary mt-3"
                            onClick={() => {
                              if (!session) return;
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
                                  `/api/sessions/${session}/upload`,
                                  {
                                    method: "POST",
                                    credentials: "include",
                                    body: fd,
                                  },
                                );
                                if (!r.ok) throw new Error("Simpan gagal");
                                await loadFiles();
                              }, "File tersimpan");
                            }}
                          >
                            Simpan file
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
                          "---\nname: skill-baru\ndescription: Instruksi untuk task khusus\ntriggers: [build]\ntools: [bash, write_file]\n---\n\n# Instruksi\n\nBangun hasil nyata dan verifikasi dengan test.",
                        )
                      }
                    >
                      <Plus size={12} /> Skill baru
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
                        aria-label="Editor skill Markdown"
                        value={markdown}
                        onChange={(e) => setMarkdown(e.target.value)}
                      />
                      <button
                        className="btn primary mt-3"
                        onClick={() =>
                          void action(() => api("skills", { markdown }))
                        }
                      >
                        Validasi & simpan
                      </button>
                    </>
                  )}
                </section>
              )}
              {tab === "memory" && (
                <section className="panel generic">
                  <div className="toolbar">
                    <input
                      aria-label="Cari memori"
                      placeholder="Cari memori dengan FTS5..."
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
                      <ArrowDownToLine size={12} /> Ekspor
                    </button>
                  </div>
                  {items.map((m) => (
                    <div className="list-card" key={String(m.id)}>
                      <div>
                        <span className="badge">{String(m.kind)}</span>
                        <h3 className="mt-3">{String(m.key)}</h3>
                        <p className="text-xs muted mt-2 whitespace-pre-wrap">
                          {String(m.content)}
                        </p>
                      </div>
                      <button
                        className="btn danger"
                        aria-label="Hapus memori"
                        onClick={() =>
                          void action(async () => {
                            await api(`memory/${m.id}`, undefined, "DELETE");
                            setItems(items.filter((i) => i.id !== m.id));
                          }, "Memori dihapus")
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  {!items.length && (
                    <div className="empty">
                      Memori akan terisi saat agent menyelesaikan task.
                    </div>
                  )}
                </section>
              )}
              {tab === "bounties" && (
                <section className="panel generic">
                  <div className="toolbar">
                    <input
                      className="flex-1"
                      aria-label="URL atau brief bounty"
                      placeholder="Tempel URL atau brief bounty make.fun..."
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                    />
                    <button
                      className="btn primary"
                      onClick={() => {
                        setTab("chat");
                        void send(
                          `Kerjakan bounty make.fun ini sampai paket submit: ${prompt}. Gunakan tools makefun dan uji deliverable nyata.`,
                        );
                      }}
                      disabled={!prompt.trim()}
                    >
                      <Play size={12} /> Kerjakan otomatis
                    </button>
                  </div>
                  <div className="kanban">
                    {[
                      "baru",
                      "dikerjakan",
                      "dites",
                      "siap submit",
                      "submitted",
                    ].map((status) => (
                      <div key={status} className="kanban-col">
                        <h3>
                          <span className="status-dot !w-1 !h-1" />
                          {status.toUpperCase()}{" "}
                          <span className="float-right">
                            {items.filter((b) => b.status === status).length}
                          </span>
                        </h3>
                        {items
                          .filter((b) => b.status === status)
                          .map((b) => (
                            <div key={String(b.id)} className="bounty-card">
                              <Trophy
                                size={13}
                                className="text-[var(--violet-2)] mb-3"
                              />
                              <p>{String(b.title)}</p>
                              <p className="muted text-[9px] mt-3">
                                {String(b.deadline || "Tanpa deadline")}
                              </p>
                              <button
                                className="btn mt-3 !text-[9px]"
                                onClick={() => {
                                  setSession(String(b.session_id));
                                  setTab("chat");
                                }}
                              >
                                Lihat progres <ArrowRight size={10} />
                              </button>
                            </div>
                          ))}
                      </div>
                    ))}
                  </div>
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
                                tool.enabled ? "Tool dimatikan" : "Tool aktif",
                              )
                            }
                          >
                            {tool.enabled ? "Disable" : "Enable"}
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="empty">Katalog tool dimuat dari core.</div>
                  )}
                </section>
              )}
              {tab === "settings" && (
                <section className="panel generic">
                  <h2 className="mb-4">Preferensi ruang kendali</h2>
                  <div className="list-card">
                    <span>Bahasa</span>
                    <select
                      aria-label="Bahasa"
                      value={lang}
                      onChange={(e) => setLang(e.target.value as "id" | "en")}
                    >
                      <option value="id">Bahasa Indonesia</option>
                      <option value="en">English</option>
                    </select>
                  </div>
                  <div className="list-card tz-card">
                    <span>Zona waktu</span>
                    <div className="tz-control">
                      <select
                        aria-label="Zona waktu"
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
                    <span>Sandbox</span>
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
                            makefun_base_url:
                              settings.makefun_base_url || undefined,
                            makefun_credentials:
                              settings.makefun_credentials || undefined,
                            max_steps: Number(settings.max_steps) || undefined,
                            timezone: settings.timezone || DEFAULT_TIMEZONE,
                          }),
                        "Settings disimpan",
                      );
                    }}
                  >
                    <div className="list-card">
                      <span>make.fun base URL</span>
                      <input
                        aria-label="make.fun base URL"
                        placeholder="https://make.fun"
                        value={settings.makefun_base_url}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            makefun_base_url: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="list-card">
                      <span>Kredensial make.fun</span>
                      <input
                        aria-label="Kredensial make.fun"
                        type="password"
                        placeholder={
                          settingsInfo.makefun_credentials
                            ? "Sudah tersimpan"
                            : "Cookie atau API token"
                        }
                        value={settings.makefun_credentials}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            makefun_credentials: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="list-card">
                      <span>Maks step per task</span>
                      <input
                        aria-label="Maks step"
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
                      Simpan settings
                    </button>
                  </form>
                  <h2 className="mt-6 mb-4">Backup</h2>
                  <div className="list-card">
                    <span>Snapshot database</span>
                    <button
                      className="btn"
                      onClick={() =>
                        void action(
                          () => api("backup", {}),
                          "Backup dibuat di folder data",
                        )
                      }
                    >
                      <ArrowDownToLine size={12} /> Backup sekarang
                    </button>
                  </div>
                  <p className="muted text-xs leading-6">
                    Token admin, Telegram, master key, dan resource sandbox
                    dikonfigurasi lewat environment VPS. Gunakan CLI pansaos
                    untuk backup dan restore.
                  </p>
                </section>
              )}
            </motion.div>
          </AnimatePresence>
          <footer className="footer">
            <div className="footer-brand">
              <div className="footer-logo">
                <span className="footer-mark">
                  <Zap size={12} />
                </span>
                <span>
                  PANSAOS <span className="light">/</span> AGENT OS UNTUK BOUNTY
                  HUNTER
                </span>
              </div>
              <p className="footer-tagline">
                Satu dashboard untuk menjalankan agent, memantau task, dan
                mengelola sesi bounty.
              </p>
            </div>
            <nav className="footer-links" aria-label="Tautan footer">
              <a
                href="https://github.com/jhodypedia/PansaOS"
                target="_blank"
                rel="noreferrer"
              >
                <Github size={12} /> Repositori
              </a>
              <a
                href="https://github.com/jhodypedia/PansaOS/issues"
                target="_blank"
                rel="noreferrer"
              >
                <Shield size={12} /> Laporkan isu
              </a>
              <a
                href="https://github.com/jhodypedia/PansaOS#readme"
                target="_blank"
                rel="noreferrer"
              >
                <BookOpen size={12} /> Dokumentasi
              </a>
              <a
                href="https://github.com/jhodypedia/PansaOS/releases"
                target="_blank"
                rel="noreferrer"
              >
                <FileText size={12} /> Rilis
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
