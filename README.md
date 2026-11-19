# PansaOS

PansaOS adalah asisten pribadi serbaguna untuk percakapan sehari-hari, tanya-jawab, riset web, menulis dan merangkum, catatan, memori pengguna, pengingat, otomasi, serta pekerjaan teknis dan coding di proyek pilihan Anda. Kemampuan coding adalah salah satu kemampuan agent; bukan keseluruhan produknya.

Satu core dipakai oleh CLI `pansa`, Telegram, dan dashboard web. Riwayat tersimpan di session yang sama saat dipilih, sedangkan profil dan memori tahan lama berlaku global lintas kanal. CLI bekerja pada proyek di `cwd`; data internal, database, profil, state shell, dan checkpoint berada di `PANSA_HOME` (default `~/.pansa`).

## Instalasi global di Linux VPS

Persyaratan: Node.js >=20.9 (disarankan Node 22 LTS), npm, compiler/build tools untuk `better-sqlite3` bila prebuilt binary tidak tersedia. Docker opsional untuk mode isolasi.

```bash
git clone https://github.com/jhodypedia/PansaOS.git
cd PansaOS
./install.sh
```

Installer memasang aplikasi ke `/opt/pansaos` (atau `~/.local/share/pansaos` tanpa hak tulis sistem), membangun core dan dashboard, memasang perintah global `pansa`, serta membuat `~/.pansa/.env` dengan `MASTER_KEY` dan `DASH_TOKEN` acak tanpa menimpa konfigurasi yang sudah ada. File env diberi mode `600`. Jika `~/.local/bin` belum ada di `PATH`, tambahkan direktori tersebut.

Jalankan mode server VPS dengan `sudo ./install.sh --service` setelah pemasangan, atau gunakan `pansa serve`. Opsi service membuat dan mengaktifkan `pansa.service` dengan restart otomatis. Atur `PUBLIC_URL`, `BOT_TOKEN`, dan `ADMIN_IDS` di `~/.pansa/.env` bila memakai Telegram dan dashboard publik; lindungi akses web dengan reverse proxy TLS serta firewall.

## Mulai menggunakan

### CLI

```bash
cd ~/proyek-saya
pansa                 # chat REPL pada direktori proyek ini
pansa --continue      # lanjutkan session terakhir
pansa run "Jelaskan struktur proyek ini"
  pansa run "Tambahkan validasi input dan jalankan test" --yes
pansa run "Rencanakan migrasi" --plan
pansa doctor
pansa provider add
```

Tool file dan shell menggunakan direktori proyek aktif. Persetujuan tampil untuk operasi tulis, tool shell, git/npm, pengunduhan yang menimpa file, permintaan HTTP mutatif, serta command destruktif. `--yes` mengaktifkan kebijakan auto-approval untuk session `run`; gunakan hanya pada tugas yang Anda percayai.

Perintah REPL: `/new`, `/continue SESSION_ID`, `/model`, `/providers`, `/memory`, `/doctor`, `/stop`, `/exit`. Untuk input API key, `pansa provider add` memakai input terminal tanpa echo dan provider disimpan terenkripsi.

### Telegram

Isi `BOT_TOKEN` dari BotFather dan `ADMIN_IDS` (ID numerik dipisahkan koma), lalu jalankan `pansa serve`. Bot hanya menerima admin. Pesan teks digunakan untuk tanya-jawab dan tugas; lampiran dokumen/foto diteruskan ke agent untuk analisis. Gunakan `/memory kata`, `/forget kata`, atau pesan `lupakan <fakta>`. Buat pengingat dengan `/schedule CRON|TASK` (UTC). `/doctor` memeriksa provider melalui ID provider asli; `/dashboard` memberi link login sekali pakai.

Jangan kirim password atau API key di chat biasa. Tambahkan provider melalui wizard aman di CLI atau dashboard. Pengiriman pesan, posting, pembelian, atau tindakan eksternal atas nama pengguna memerlukan persetujuan eksplisit.

### Dashboard

Dashboard tersedia di port `3000` saat `pansa serve`; core API dan WebSocket di port `3001`. Login menggunakan `DASH_TOKEN` dari `~/.pansa/.env` atau token sekali pakai Telegram. Dashboard berisi percakapan realtime, sesi, provider, tools, skills, Memory, jadwal, dan Settings. Memory mendukung pencarian, edit, hapus, impor, ekspor, dan pengeditan `USER.md`; Settings memuat editor `SOUL.md`/`USER.md`, mode eksekusi, dan direktori proyek.

## Profil, memori, dan persona

- `~/.pansa/USER.md`: nama, panggilan, zona waktu, bahasa, preferensi, orang penting, proyek, dan tujuan.
- `~/.pansa/MEMORY.md`: memori tahan lama terkurasi. Fakta, preferensi, keputusan, komitmen, dan hubungan diindeks ke SQLite FTS5 dan dimuat relevan ke prompt.
- `~/.pansa/SOUL.md`: nama agent, gaya bicara, bahasa default, privasi dan persona. File dapat diedit pengguna.
- `~/.pansa/skills/` dan `~/.pansa/plugins/`: salinan skill bawaan yang dapat dikelola pengguna dan plugin lokal.
- Riwayat chat dan episode tetap terpisah dari fakta global; episode percakapan tidak bocor antar-session. Memori profil/fakta lintas sesi dan kanal.
- Agent menyediakan `memory_save`, `memory_forget`, dan `memory_explain`. Penghapusan memverifikasi baris SQLite/FTS dan berkas terkurasi.

Database memakai SQLite WAL dan migrasi aditif; indeks FTS5 dijaga trigger saat edit/hapus. Backup tersimpan di `~/.pansa/data` dan tick harian berjalan pada pukul 02:00 UTC.

## Skills dan ekstensi

Skills adalah Markdown di `skills/<nama>/SKILL.md`; buat folder/file baru untuk menambah panduan tanpa mengubah core. Skills bawaan meliputi riset mendalam, rangkuman dan penulisan, pengelolaan catatan/pengetahuan, pengingat dan tindak lanjut, coding, penjelajahan web, laporan bug, serta pemecahan masalah. Server MCP dan plugin memperluas katalog tools. MCP HTTP/SSE dapat digunakan dalam mode host; MCP stdio yang diisolasi menggunakan Docker.

## Mode eksekusi

`EXEC_MODE=host` adalah default. Tool file dan shell bekerja langsung pada `WORKSPACE_DIR` (CLI mengatur cwd pemanggilan; untuk server atur direktori proyek di `.env`). `cd` bertahan antar-panggilan shell dalam session. State agent tetap berada di `PANSA_HOME/state`.

`EXEC_MODE=docker` menjalankan tools dalam container sandbox. Instal Docker Engine dan siapkan image sandbox terlebih dahulu. Compose/Caddy dan konfigurasi deployment container tetap tersedia sebagai opsi terpisah; Docker tidak diperlukan untuk instalasi host.

## Konfigurasi

Contoh variabel lingkungan:

```dotenv
PANSA_HOME=/home/user/.pansa
MASTER_KEY=<64 karakter hex>
DASH_TOKEN=<token acak>
EXEC_MODE=host
WORKSPACE_DIR=/home/user/proyek
PORT=3001
DASHBOARD_PORT=3000
PUBLIC_URL=https://agent.example.com
BOT_TOKEN=
ADMIN_IDS=
SCHEDULER_MODE=internal
```

Kunci provider dienkripsi AES-256-GCM dengan `MASTER_KEY` dan dimasking pada API. Jangan mengganti master key tanpa terlebih dahulu mengganti provider key yang tersimpan.

## Pengembangan dan verifikasi

```bash
npm install
npm run typecheck
npm test
npm run build
```

Core menggunakan Fastify, grammY, SQLite WAL/FTS5, agent loop dan tool registry. Dashboard menggunakan Next.js. Pengamanan meliputi `safePath`, pemeriksaan URL dan `safeFetch` anti-SSRF, SQL berparameter, cookie httpOnly, perbandingan token constant-time, enkripsi key, serta approval aksi berisiko.

Untuk pengembangan lokal, isi variabel wajib pada `.env` (lihat `.env.example`), jalankan `npm run dev`, lalu buka dashboard pada `http://localhost:3000`. Saat bot/provider tidak dikonfigurasi, integrasi kanal/provider eksternal tentu belum tersedia.
