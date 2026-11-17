"use client";
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
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
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Command,
  Cpu,
  DollarSign,
  ExternalLink,
  FileText,
  Gauge,
  Github,
  Globe,
  Layers,
  LayoutDashboard,
  LogOut,
  MemoryStick,
  MessageSquare,
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
    [lang, setLang] = useState<"id" | "en">("id");
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
    [prompt, setPrompt] = useState(""),
    [stream, setStream] = useState(""),
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
    }),
    [settingsInfo, setSettingsInfo] = useState<Row>({}),
    [schedule, setSchedule] = useState({ cron: "0 9 * * *", prompt: "" }),
    [form, setForm] = useState({
      name: "",
      base_url: "https://api.openai.com/v1",
      api_key: "",
      model: "",
    });
  const api = useCallback(
    async (url: string, body?: unknown, method?: string) => {
      const response = await fetch(`/api/${url}`, {
        method: method ?? (body ? "POST" : "GET"),
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
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
    const timer = setInterval(() => {
      refresh().catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
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
        const payload = e.data as Row;
        if (e.type === "token" && e.session_id === session)
          setStream((prev) => prev + String(payload.text ?? ""));
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
    if (tab !== "settings" || !logged) return;
    void api("settings")
      .then((r) => {
        const s = r as Row;
        setSettingsInfo(s);
        setSettings((prev) => ({
          ...prev,
          makefun_base_url: String(s.makefun_base_url ?? ""),
          max_steps: Number(s.max_steps ?? 25),
        }));
      })
      .catch((e) => setError(String(e)));
  }, [tab, logged, api]);
  const action = async (fn: () => Promise<unknown>, message = "Tersimpan") => {
    setBusy(true);
    setError("");
    try {
      await fn();
      notify(message);
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
  const data = (e: Row): Row =>
    typeof e.data === "string"
      ? (JSON.parse(e.data) as Row)
      : ((e.data as Row) ?? {});
  const activity = events.filter((e) => e.type !== "token").slice(0, 8);
  const chart = Array.from({ length: 12 }, (_, i) => {
    const minutes = 55 - i * 5,
      time = Date.now() - minutes * 60000;
    const usage = events.filter(
      (e) =>
        e.type === "usage" &&
        new Date(String(e.created_at)).getTime() >= time &&
        new Date(String(e.created_at)).getTime() < time + 300000,
    );
    return {
      time: new Date(time).toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      tokens: usage.reduce((sum, e) => sum + Number(data(e).tokens ?? 0), 0),
      cost: usage.reduce((sum, e) => sum + Number(data(e).cost ?? 0), 0),
    };
  });
  const Feed = ({ all = false }: { all?: boolean }) => (
    <div className={all ? "" : "feed"}>
      <AnimatePresence initial={false}>
        {(all
          ? events.filter(
              (e) =>
                e.type !== "token" &&
                (!query ||
                  JSON.stringify(e)
                    .toLowerCase()
                    .includes(query.toLowerCase())),
            )
          : activity
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
                  data(e).content ??
                    data(e).output ??
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
            <span className="feed-time">
              {new Date(String(e.created_at)).toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
      {!(all ? events : activity).length && (
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
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={() => setTab("overview")}>
          <span className="brand-icon">
            <Command size={22} />
          </span>
          <span className="brand-text">
            Pansa<em>OS</em>
            <span className="text-[8px] tracking-normal text-[#55566d] ml-2">
              v1.0
            </span>
          </span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav className="nav">
          {tabs.slice(0, 7).map(([key, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
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
              onClick={() => setTab(key)}
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
            onClick={() => setTab("settings")}
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
            <div className="flex justify-between mt-3 text-[9px] text-[#64677d]">
              <span>CORE ENGINE</span>
              <span className="text-[#00e5c3]">
                {connected ? "ONLINE" : "CONNECTING"}
              </span>
            </div>
          </div>
          <div className="flex justify-between items-center pt-5 text-[10px] text-[#64677d]">
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
          <div className="breadcrumb">
            Workspace <ChevronRight size={11} className="inline ml-3" />
            <span>{t[tab]}</span>
          </div>
          <div className="top-actions">
            <span>
              <span className="status-dot" />
              {Number(stats.running) > 0 ? "Agent bekerja" : "Agent siap"}
            </span>
            <span className="keycap">SELF-HOSTED</span>
            <button aria-label="Notifikasi" onClick={() => setTab("live")}>
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
                <span className="text-[#7c5cff]">.</span>
              </h1>
              <p>
                {tab === "overview"
                  ? "Semua agent, aktivitas, dan bounty. Satu ruang kendali."
                  : t.tagline}
              </p>
            </div>
            <div className="title-actions">
              <button
                className="btn"
                onClick={() => void action(refresh, "Data diperbarui")}
              >
                <RefreshCw size={12} /> Refresh
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
                                  stopColor="#7c5cff"
                                  stopOpacity={0.3}
                                />
                                <stop
                                  offset="100%"
                                  stopColor="#7c5cff"
                                  stopOpacity={0}
                                />
                              </linearGradient>
                            </defs>
                            <CartesianGrid
                              stroke="#ffffff06"
                              vertical={false}
                            />
                            <XAxis
                              dataKey="time"
                              tick={{ fill: "#575c72", fontSize: 9 }}
                              tickLine={false}
                              axisLine={false}
                              interval={2}
                            />
                            <YAxis
                              tick={{ fill: "#575c72", fontSize: 9 }}
                              tickLine={false}
                              axisLine={false}
                            />
                            <Tooltip
                              contentStyle={{
                                background: "#161324",
                                border: "1px solid #7c5cff33",
                                borderRadius: 8,
                                fontSize: 11,
                              }}
                            />
                            <Area
                              dataKey="tokens"
                              type="monotone"
                              stroke="#9879ff"
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
                      <div className="diagram">
                        <div className="connector">
                          <motion.i
                            className="packet"
                            animate={{
                              left: ["0%", "100%"],
                              opacity: [0, 1, 0],
                            }}
                            transition={{ duration: 3, repeat: Infinity }}
                          />
                        </div>
                        {[
                          [Send, "Telegram"],
                          [Command, "Pansa Core"],
                          [Layers, "Provider"],
                          [Wrench, "Tools"],
                        ].map(([Icon, label]) => {
                          const I = Icon as typeof Activity;
                          return (
                            <div className="node" key={String(label)}>
                              <motion.div
                                className="node-icon"
                                animate={
                                  label === "Pansa Core" &&
                                  Number(stats.running) > 0
                                    ? {
                                        boxShadow: [
                                          "0 0 5px #00e5c320",
                                          "0 0 30px #00e5c340",
                                          "0 0 5px #00e5c320",
                                        ],
                                      }
                                    : undefined
                                }
                                transition={{ repeat: Infinity, duration: 2 }}
                              >
                                <I size={label === "Pansa Core" ? 25 : 19} />
                              </motion.div>
                              <span>{String(label)}</span>
                            </div>
                          );
                        })}
                        <span className="diagram-label">
                          Telegram → Core → Provider → Tools
                        </span>
                      </div>
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
                          className="text-[10px] text-[#9690b2] flex gap-2 items-center"
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
                          className="text-[10px] text-[#9690b2]"
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
                                  <span className="text-[8px] text-[#a58dff] ml-2">
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
                              <p className="text-[9px] text-[#656a7e] mt-2 font-mono">
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
                      <div className="px-5 py-4 flex justify-between text-[9px] font-mono text-[#62677c]">
                        <span>PRIORITY-BASED FAILOVER</span>
                        <Shield size={12} className="text-[#00e5c3]" />
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
                        <p className="text-[10px] text-[#676b80] mt-1">
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
                      onChange={(e) => setQuery(e.target.value)}
                      className="!py-2 !text-xs"
                    />
                  </div>
                  <Feed all />
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
                              ? new Date(Number(s.last_run)).toLocaleString(
                                  "id-ID",
                                )
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
                <section className="panel generic">
                  <div className="toolbar">
                    <select
                      aria-label="Session"
                      value={session}
                      onChange={(e) => {
                        setSession(e.target.value);
                        setStream("");
                      }}
                    >
                      <option value="">Session baru</option>
                      {sessions.map((s) => (
                        <option key={String(s.id)} value={String(s.id)}>
                          {String(s.title)}
                        </option>
                      ))}
                    </select>
                    {session && (
                      <button
                        className="btn danger"
                        onClick={() =>
                          void action(
                            () => api(`sessions/${session}/stop`, {}),
                            "Stop dikirim",
                          )
                        }
                      >
                        <Square size={12} /> Stop
                      </button>
                    )}
                  </div>
                  <div className="chat-history">
                    {events
                      .filter(
                        (e) => e.session_id === session && e.type === "message",
                      )
                      .reverse()
                      .map((e) => (
                        <div
                          key={String(e.id)}
                          className={`bubble ${data(e).role}`}
                        >
                          <span className="text-[9px] uppercase text-[#a58dff]">
                            {String(data(e).role)}
                          </span>
                          <p>{String(data(e).content ?? "Tool call")}</p>
                        </div>
                      ))}
                    {stream && (
                      <div className="bubble">
                        <span className="text-[#00e5c3] text-xs">
                          ● Streaming
                        </span>
                        <p>{stream}</p>
                      </div>
                    )}
                    {!session && (
                      <div className="empty">
                        <Bot size={32} />
                        <p>Brief masuk. Agent bergerak.</p>
                        <p className="mt-2 text-[10px]">
                          Tulis task atau tempel brief bounty untuk memulai.
                        </p>
                      </div>
                    )}
                  </div>
                  {approvals
                    .filter((a) => a.session_id === session)
                    .map((a) => (
                      <div key={String(a.id)} className="bubble mb-4">
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
                      <button
                        className="btn"
                        onClick={() => {
                          setSession(String(s.id));
                          setTab("chat");
                        }}
                      >
                        Buka <ArrowRight size={12} />
                      </button>
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
                          })
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
                                className="text-[#aa92ff] mb-3"
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
            <span>
              PANSAOS <span className="light">/</span> AGENT OS UNTUK BOUNTY
              HUNTER
            </span>
            <span>
              <span className="status-dot !w-1 !h-1" />{" "}
              {connected ? "LIVE" : "CONNECTING"}{" "}
              <span className="mx-2">·</span> v1.0.0
            </span>
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
            <Check size={14} className="inline text-[#00e5c3] mr-2" />
            {notice}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
