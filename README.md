# PansaOS

**Agent OS untuk bounty hunter.** Monorepo TypeScript untuk menjalankan agent lewat Telegram dan dashboard web dengan event realtime. Dashboard menggunakan Next.js 16.4.6, React 19.3.1, dan Turbopack. Fokus alur make.fun: brief → rencana → implementasi → test → paket submit.

```text
Telegram (grammY) ─┐
                  ├─ Fastify API / ws ─ Agent loop ─ Provider manager
Next.js dashboard ┘                        │          ├ OpenAI-compatible streaming
                                          │          └ Anthropic native
                                    Tool registry
                                    ├ Docker sandbox per eksekusi/session
                                    ├ Workspace file tools
                                    ├ Web / Playwright
                                    ├ Skill Markdown
                                    └ SQLite WAL + FTS5 + events + memory
Internet ─ Caddy HTTPS ─ /api, /ws → core; lainnya → dashboard
```

## Status implementasi

Core agent, streaming, provider failover, circuit breaker, AES-GCM, memori FTS5, approval dua kanal, tools, enam skill, dashboard, Docker dan installer tersedia. Dashboard memakai cookie session httpOnly (token sekali pakai dari `/dashboard` di Telegram), dan bot Telegram berjalan dalam mode webhook bila `PUBLIC_URL` HTTPS. Fitur yang belum selesai: drag-and-drop urutan provider, embedding, transkripsi voice, login akun make.fun melalui browser persisten, dan restore dari dashboard. Jangan menganggap versi ini sudah melewati audit production. Checklist verifikasi di bawah memisahkan test lokal dari integrasi yang memerlukan token dan VPS.

## Persyaratan

- Node.js 20.9+; disarankan Node 22 LTS, npm, Python dan compiler untuk better-sqlite3 bila binary prebuilt tidak tersedia.
- VPS Linux 2 vCPU, RAM 2–4 GB; Docker Engine dan Compose plugin.
- IP publik, domain nip.io/sslip.io atau domain sendiri, port 80 dan 443 terbuka.
- Token bot dari BotFather dan ID Telegram admin. Provider LLM ditambahkan sesudah login.
- Docker socket di core memberi core hak pengelolaan container host. Hanya admin tepercaya boleh memasang plugin atau mengubah core.

## Deploy satu perintah

```bash
./setup.sh
```

Installer meminta domain, token Telegram dan ADMIN_IDS, membuat key enkripsi 32 byte serta token dashboard, membangun sandbox, dan menjalankan Compose. Simpan token yang dicetak. `.env` dilindungi mode 600 dan dikecualikan dari image. Untuk mengaktifkan network bagi npm/git di sandbox, ubah `SANDBOX_NETWORK=true`, kemudian `docker compose up -d`.

`HOST_WORKSPACE_DIR` wajib menunjuk path absolut direktori `workspace/` pada host Docker. Installer mengisinya otomatis. Tanpa Docker, aplikasi menolak shell kecuali `ALLOW_UNSANDBOXED=true` diberikan secara eksplisit. Mode tersebut hanya untuk mesin pengembangan yang terisolasi.

Caddy meminta sertifikat otomatis. DNS domain harus mengarah ke IP VPS; jangan memasang proxy lain pada port 80/443. Lingkungan boxd menggunakan HTTPS proxy bawaan dan bisa mengarahkan port 8000 ke reverse proxy aplikasi tanpa sertifikat Caddy tambahan.

## Jalankan lokal

```bash
npm install
cp .env.example .env
```

Atur `.env` untuk lokal:

```dotenv
NODE_ENV=development
PUBLIC_URL=http://localhost:3000
MASTER_KEY=<hasil openssl rand -hex 32>
DASH_TOKEN=<token acak minimal 24 karakter>
DATA_DIR=../../data
WORKSPACE_DIR=../../workspace
HOST_WORKSPACE_DIR=/path/absolut/PansaOS/workspace
SKILLS_DIR=../../skills
PLUGINS_DIR=../../plugins
SOUL_PATH=../../SOUL.md
```

```bash
docker build -t pansaos-sandbox:local -f docker/Dockerfile.sandbox .
npm run dev
```

Dashboard di localhost:3000; core di localhost:3001. Pada lokal gunakan reverse proxy untuk `/ws` ke core agar realtime WebSocket tersedia pada origin dashboard. Polling statistik tetap berjalan setiap 15 detik. Login memakai token installer atau tautan sekali pakai dari `/dashboard` di Telegram; keduanya menukar cookie session httpOnly 24 jam, jadi token tidak disimpan di browser. Untuk pemeriksaan:

```bash
npm run typecheck
npm test
npm run build
```

## Provider

Dashboard → Providers → Tambah provider. Base URL harus mencakup prefix API sebelum `/chat/completions`, contohnya `https://api.openai.com/v1` atau `https://openrouter.ai/api/v1`. API key disimpan AES-256-GCM menggunakan MASTER_KEY; respons API hanya menampilkan suffix key. Jangan mengganti MASTER_KEY sebelum mengekspor/mengganti seluruh key provider.

Adapter Anthropic memakai base URL `https://api.anthropic.com/v1`, `adapter: anthropic`. API POST `/api/providers` menerima name, base_url, api_key, model, adapter, priority, enabled, capabilities, cost_per_1k dan rate_limit. Native Anthropic saat ini mengirim hasil setelah respons utuh; OpenAI-compatible memakai SSE streaming.

Failover meneruskan riwayat yang sama ke provider berikutnya. Kesalahan transient dicoba ulang sekali. Dua kegagalan berurutan membuka circuit dengan cooldown 2/4/8 menit sampai maksimum 30 menit. Respons kosong, refusal singkat, repetisi dan tool JSON tidak valid ditolak quality gate. Angka biaya merupakan estimasi dari harga yang dikonfigurasi, bukan tagihan provider. Metadata usage dipakai bila tersedia; fallback menggunakan estimasi karakter.

## Telegram

Hanya ADMIN_IDS yang diterima. Pesan selain admin diabaikan.

| Perintah | Fungsi |
|---|---|
| `/start`, `/help` | Panduan bot |
| `/new`, `/stop`, `/status` | Kelola session dan hentikan task |
| `/model ID` | Pin model dengan fallback |
| `/providers` | Daftar provider dan ID |
| `/addprovider` | Wizard preset OpenAI/OpenRouter/Groq/Gemini/Ollama/Custom |
| `/addprovider nama\|base_url\|api_key\|model` | Tambah cepat, hapus pesan key, tes koneksi |
| `/delprovider ID` | Hapus provider |
| `/toggle ID` | Toggle provider |
| `/prio ID ANGKA` | Ubah prioritas; angka lebih kecil lebih dulu |
| `/test ID` | Tes koneksi dan latency |
| `/skills` | Daftar skill; kirim dokumen SKILL.md untuk memasang |
| `/memory kata`, `/forget ID` | Cari dan hapus memori |
| `/bounty URL atau brief`, `/bounties` | Jalankan dan pantau bounty |
| `/tasks`, `/logs` | Status task dan log terbaru |
| `/schedule CRON\|TASK` | Buat jadwal UTC dengan approval |
| `/dashboard` | Link login sekali pakai, kedaluwarsa 5 menit |
| `/autoapprove on\|off` | Kebijakan approval session |

Bot menerima teks, dokumen, foto dan voice sebagai file workspace. Voice disimpan tanpa transkripsi. Streaming teks diedit paling cepat tiap 1,1 detik. `/stop` tidak menunggu LLM selesai karena task berjalan terpisah dari handler update. Approval tersedia lewat inline keyboard dan API/dashboard.

Mode pengiriman update ditentukan `TELEGRAM_MODE`: `auto` (default) memakai webhook bila `PUBLIC_URL` HTTPS dan long polling bila tidak; `webhook` memaksa webhook; `polling` memaksa long polling. Webhook dipasang otomatis ke `${PUBLIC_URL}/telegram/webhook` dengan header `X-Telegram-Bot-Api-Secret-Token` berisi `WEBHOOK_SECRET`, atau nilai turunan MASTER_KEY bila kosong. Caddy meneruskan path tersebut ke core tanpa auth dashboard.

## Tools, plugin dan keamanan

Katalog meliputi shell, file, glob/grep, ZIP, web fetch/search/HTTP/download, browser, Node/Python/git/npm/test, memori, skill, Telegram, notifikasi, spawn_task, schedule, wait, dan lima tool make.fun. Semua memiliki skema Zod yang diterjemahkan menjadi schema tool calling.

Plugin tepercaya diletakkan di `plugins/` dan mengekspor default object `Tool` dari `apps/core/src/tools.ts`. Plugin `.js` bekerja pada production; `.ts` membutuhkan runtime loader TypeScript (development memakai tsx). File plugin dimuat ulang saat berubah. Plugin memiliki akses proses core dan hanya boleh dipasang admin.

File API memakai realpath guard untuk traversal dan symlink. Shell berjalan dalam container dengan cap-drop ALL, read-only root filesystem, tmpfs, batas CPU/RAM/PID dan batas waktu. Workspace adalah satu-satunya bind mount sandbox. Network default off. Web URL privat dan metadata ditolak, termasuk redirect. Pemeriksaan DNS saat ini belum mem-pin IP ke socket; gunakan firewall egress untuk defense tambahan terhadap DNS rebinding pada deployment publik.

Approval dipicu oleh tool berisiko, command hapus rekursif, browser interaktif, dan metode HTTP yang mengubah data. Auto-approve per session melewati permintaan approval. Kebijakan shell berbasis pola bukan detektor sempurna untuk semua transaksi; jangan memberikan kredensial finansial ke workspace.

Auth memakai hash bcrypt untuk token admin, cookie session httpOnly/SameSite=Strict dan WS origin+cookie. Bearer master token didukung untuk CLI maintenance. Login dibatasi lima percobaan per menit. Semua request mutasi menghasilkan audit event. Output tool dipotong dengan penanda eksplisit.

## Skill dan memori

Skill berada di `skills/<name>/SKILL.md`, dengan frontmatter name, description, triggers, tools dan enabled opsional. Relevansi memasukkan metadata saja; read_skill memuat instruksi penuh. Daftar skill dibaca dari filesystem sehingga perubahan langsung terlihat. Enam skill bawaan: makefun-bounty, coding-agent, deep-research, threejs-game, web-scraping, bug-report.

Riwayat session adalah short-term memory. Saat konteks besar, agent meringkas bagian lama dan menyimpan ringkasan. Fakta/note serta episode task masuk tabel memory dan FTS5; edit/hapus menjaga indeks lewat trigger. Memory dashboard mendukung pencarian dan ekspor, API mendukung edit serta impor.

## Alur bounty make.fun

1. Kirim `/bounty <URL>` atau tempel brief di dashboard.
2. Agent mengambil konten halaman nyata, membuat checklist dan rencana.
3. Agent mengimplementasikan file dengan tool coding di workspace session.
4. makefun_verify menjalankan command test dan menyimpan bukti setiap kriteria. Hanya exit=0 serta semua kriteria passed yang mencapai dites.
5. makefun_submit_pack membuat SUBMISSION.md dan submission.zip, mengecualikan node_modules, .git dan .env. Paket dapat dikirim lewat telegram_send setelah approval.
6. Submission ke make.fun memerlukan tindakan/approval user; tidak ada endpoint submit yang ditebak.

Halaman yang memerlukan login dapat diganti dengan brief yang ditempel. Setting base URL dan kredensial terenkripsi tersedia di API settings; pengisian login otomatis belum dihubungkan.

## Jadwal dan backup

`automations/maintenance.run.ts` memakai `@boxd/run`: tick scheduler tiap menit dan backup SQLite pukul 02:00 UTC. run membuat jadwal terlihat di console, menangani lifecycle, dan membangunkan VM boxd saat jadwal tiba.

```bash
run automations/maintenance.run.ts
run jobs
```

Core API harus dapat dicapai dari job. Default localhost:3001; sesuaikan `PANSA_CORE_URL` bila menggunakan reverse proxy/domain. Pada VPS non-boxd, panggil authenticated `POST /api/scheduler/tick` tiap menit dan `POST /api/backup` setiap hari lewat scheduler eksternal pilihanmu. Installer belum memasang scheduler eksternal otomatis.

```bash
./pansaos backup
./pansaos restore backups/pansaos-YYYYMMDD-HHMMSS.sqlite
./pansaos logs
```

Backup memakai SQLite online backup API/CLI sehingga WAL konsisten. Simpan juga MASTER_KEY, .env, workspace dan skills dalam penyimpanan terpisah. Restore menghentikan core, memeriksa integritas file, membuat backup sebelum perubahan dan membersihkan WAL lama. Jangan menjalankan restore saat masih ada task aktif.

## Troubleshooting

- `MASTER_KEY harus hex 32 byte`: jalankan `openssl rand -hex 32`, jangan masukkan placeholder dari contoh.
- `Semua provider gagal`: tes endpoint/model/key dan cek cooldown serta rate limit provider.
- Sandbox gagal mount: pastikan HOST_WORKSPACE_DIR adalah path host, image sandbox sudah dibangun dan socket Docker tersedia.
- HTTPS gagal: cek DNS, port 80/443, firewall, log Caddy, serta rate limit CA.
- Dashboard WS reconnecting: route `/ws` harus diteruskan ke core dan PUBLIC_URL harus sama dengan origin browser. WebSocket hanya menerima cookie `pansa_session`; login ulang lewat halaman login atau tautan `/dashboard` bila sesi kedaluwarsa.
- Telegram tidak merespons setelah deploy HTTPS: mode `auto` memasang webhook ke `/telegram/webhook`; pastikan Caddy meneruskan path itu ke core dan tidak ada reverse proxy lain yang memblokir POST. Paksa `TELEGRAM_MODE=polling` sementara untuk diagnosis.
- Build native better-sqlite3 lambat: gunakan Node 22 LTS atau image Docker; pastikan Python dan build-essential terpasang.
- Telegram key tidak terhapus: periksa izin bot untuk menghapus pesan dan gunakan chat privat.

## Checklist verifikasi deployment

- [ ] `npm run typecheck`, `npm test`, `npm run build` lulus.
- [ ] Login dashboard menukar token menjadi cookie httpOnly; `/api/auth/session` mengembalikan 200 dan logout mengembalikan 401.
- [ ] `/start` di Telegram dibalas hanya untuk admin.
- [ ] Tambahkan dua provider melalui wizard; pesan key terhapus dan tes latency berhasil.
- [ ] Simulasikan provider prioritas pertama gagal; event switch tampil dan konteks tetap utuh.
- [ ] Buka HTTPS domain nip.io dan pastikan event realtime tersambung.
- [ ] Kirim task dengan command lama, tekan stop, pastikan container dan request berhenti.
- [ ] Uji approval setuju/tolak dari Telegram dan dashboard.
- [ ] Kirim bounty nyata, cek hasil build/test dan unduh ZIP yang memuat README.
- [ ] Jalankan backup, uji restore di instance terpisah, lalu cek memori/session masih ada.

Token Telegram, key LLM, URL bounty nyata dan DNS VPS diperlukan untuk menyelesaikan checklist integrasi; test lokal tidak membuktikan akses akun eksternal.
