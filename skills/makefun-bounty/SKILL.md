---
name: makefun-bounty
description: Complete make.fun competitions with criterion evidence and verified submission packs; selesaikan kompetisi make.fun, buktikan kriteria dan verifikasi paket submit.
triggers: [make.fun, makefun, bounty, kompetisi, hadiah, competition, submission, paket submit, grade-local]
tools: [makefun_fetch_bounty, makefun_plan, makefun_build, makefun_verify, makefun_submit_pack, read_file, read_skill, web_fetch, write_file, bash, browser, run_node, run_python, lint_test]
---

# Bounty make.fun

## Aturan koneksi akun (WAJIB, sebelum langkah apa pun)

- Periksa dulu apakah akun make.fun SUDAH terhubung: gunakan kredensial tersimpan (mis. `~/.makefun/credentials`) untuk `GET /api/agents/me` atau perintah status CLI yang setara. Pemeriksaan ini gratis dan tidak mengubah apa pun.
- Bila sudah terhubung: **jangan** jalankan `makefun login`, **jangan** kirim approval/connect link, **jangan** minta owner login ulang. Langsung kerjakan bounty dengan akun itu — tanpa pengecualian, termasuk "sekadar memastikan".
- Bila belum terhubung (401 / kredensial kosong / respons kosong): barulah jalankan `makefun login`, kirim approval link ke owner, dan tunggu persetujuan.
- Bila prompt menyebut handle berbeda dari akun yang terhubung: berhenti dan tanya owner sebelum pindah akun (pindah akun = identitas berbeda, memengaruhi kepemilikan submission dan hadiah).
- Jangan pernah hardcode handle akun dan jangan cetak API key utuh.

## Bahasa dan cakupan

Produk bounty (kode, komentar, test, README, commit bila diminta, teks UI dan submission) memakai Inggris; laporan/progres/approval kepada owner memakai Indonesia sesuai SOUL.md. Domain skill ini adalah kompetisi dan evidence; rujuk coding-agent/threejs-game untuk implementasi, deep-research untuk riset, bug-report untuk temuan, web-scraping untuk ekstraksi.

## Alur enam langkah

1. **Ambil brief nyata.** Baca URL/teks owner serta kit resmi, RULES.txt, competition.yaml, README, baseline dan versi grader. Catat deadline/timezone, eligibility, format artefak, dependency/runtime, lisensi, larangan, scoring weights, tie-break dan ketentuan submission. Bila akses tertutup, minta brief atau akses yang disetujui; jangan menebak endpoint/API. Baseline adalah pembanding, bukan jaminan kepatuhan atau kemenangan.
2. **Petakan dan rencanakan.** Simpan bounty dengan makefun_fetch_bounty dan buat makefun_plan. Bentuk matriks setiap kriteria → implementasi/file → test/command → evidence → status. Pisahkan syarat diskualifikasi dari poin kualitas. Targetkan TOP reward: prioritaskan kriteria berbobot tertinggi, edge cases, polish dan pembeda terukur dibanding baseline, setelah semua syarat wajib terpenuhi. Jangan menjanjikan ranking atau mengakali grader.
3. **Implementasikan penuh.** Baca skill domain melalui read_skill. Gunakan makefun_build untuk menandai pekerjaan sesuai kontrak tool, lalu write_file/bash di workspace session untuk implementasi nyata. Tool build tidak otomatis menghasilkan kode; periksa hasilnya. Selesaikan gameplay/UX/integrasi dan failure paths sesuai brief. Jangan mengubah RULES, grader atau baseline evaluasi untuk memperoleh skor palsu.
4. **Uji dan kumpulkan bukti.** Jalankan test nyata sesuai stack dan isi evidence untuk SETIAP kriteria dengan output/file/screenshot yang dibuat. Bila kit menyediakan grade-local, jalankan minimal dua kali: pass awal untuk gap, kemudian pass akhir setelah perbaikan dari kondisi bersih. Catat command, exit code, versi grader, skor/checks dan diff hasil; ulangi meski pass awal sudah lulus. Bila grade-local tidak tersedia/terblokir, laporkan dua pass belum terpenuhi dan jangan mengarang skor. Skor lokal bukan jaminan hasil server.
5. **Verify dan audit.** Panggil makefun_verify dengan command test nyata, perbaiki kegagalan dan cek matriks coverage. Pastikan README Inggris menjelaskan setup, konfigurasi aman, run/test/build, kontrol, desain, batasan dan hasil verifikasi. Audit isi paket, path, ukuran, dependensi, lisensi, secret, asset yang hilang dan reproducibility dari workspace bersih. Jangan menyebut lulus bila tool hanya menyimpan status tanpa menjalankan pemeriksaan yang diperlukan.
6. **Paket dan handoff.** Panggil makefun_submit_pack setelah verifikasi lulus. Periksa ZIP dan isinya, siapkan judul/deskripsi submission Inggris serta ringkasan Indonesia dengan evidence dan blocker. Kirim ZIP/ringkasan ke admin dengan approval. Status submitted hanya setelah konfirmasi owner bahwa submission eksternal selesai atau receipt nyata dari aksi yang disetujui; local package bukan submission. Jangan commit, submit, membayar entry fee atau melakukan transaksi tanpa instruksi/approval owner.

## Standar kualitas dan larangan

- Seluruh kriteria wajib punya evidence yang dapat diulang; nyatakan kriteria belum diuji dan risiko grading yang masih terbuka.
- Kejar reward melalui kualitas dan kepatuhan aturan, bukan klaim tanpa bukti, plagiarisme atau perubahan evaluator.
- Jangan cetak secret, mengubah identitas akun diam-diam, atau menyebut paket terkirim ketika baru dibuat lokal.

## Contoh handoff yang baik

“Implementasi selesai; matriks kriteria ada di `evidence/criteria.md`. Dua pass grader beserta output tersimpan. Paket lokal: `submission.zip`; submission eksternal menunggu approval.” Sertakan skor, path dan exit code hanya bila benar-benar dihasilkan. Judul submission dapat memakai pola `Orbit Runner — Touch-ready 3D Arcade Game` bila sesuai deliverable nyata.
