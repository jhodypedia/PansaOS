---
name: bug-report
description: Produce reproducible bug reports with defensible impact, proof and retest; tulis laporan bug yang dapat direproduksi, berdampak terukur, disertai PoC dan uji ulang.
triggers: [bug report, laporan bug, laporkan bug, vulnerability, kerentanan, reproduce, poc, security finding]
tools: [read_file, write_file, browser, bash, web_fetch, http_request]
---

# Bug report

Domain: validasi dan dokumentasi bug. Untuk memperbaiki implementasi baca coding-agent; untuk memeriksa sumber/known issue baca deep-research. Ikuti SOUL.md untuk bahasa owner dan artefak bounty.

## Langkah kerja

1. Identifikasi target, versi/commit, lingkungan, pemilik, ruang lingkup dan izin pengujian. Gunakan data uji milik sendiri serta aksi minimal yang membuktikan masalah. Jika izin atau target ambigu, klarifikasi sebelum tindakan yang bergantung padanya.
2. Catat hipotesis dan expected behavior berdasarkan spesifikasi atau perilaku konsisten. Cari issue tracker/changelog/advisory yang tersedia dan known issues resmi. Bandingkan akar masalah, versi terdampak, kondisi eksploitasi dan dampak; judul mirip saja tidak membuktikan duplikat.
3. Buat langkah reproduksi minimal dari kondisi bersih: prasyarat, akun/role, input, request atau klik, output. Ulangi setidaknya sekali dan catat frekuensi; bedakan deterministik, intermiten dan belum terkonfirmasi.
4. Simpan PoC minimal yang dapat dijalankan untuk setiap klaim berdampak. Rekam request/response, log dengan timestamp, screenshot atau video yang diperlukan. Buktikan batas akses atau data yang benar-benar terpengaruh; jangan mengekstrapolasi satu contoh menjadi seluruh pengguna.
5. Tulis judul konkret (trigger + akibat), environment, prerequisites, numbered reproduction steps, expected/actual, impact, evidence, scope, severity rationale dan limitations. Severity berdasar exploitability, hak akses, interaksi, kerahasiaan/integritas/ketersediaan; sebut vektor dan asumsi jika memakai CVSS, jangan mengarang skor.
6. Redaksi key, token, cookie, data pribadi dan informasi pihak lain dari semua artefak; pertahankan struktur yang diperlukan untuk reproduksi. Hindari menyimpan dump data bila subset sintetis cukup.
7. Rekomendasikan perbaikan pada akar masalah dan regression test. Tentukan retest: ulangi PoC pada versi patch, pastikan ditolak/ditangani benar serta jalur normal tetap berjalan. Tanpa akses patch, tandai retest belum dilakukan.
8. Tinjau kredibilitas: reproduksi + bukti + dampak teramati = temuan terkonfirmasi; dugaan tanpa PoC = hipotesis. Known issue/duplikat dicatat beserta URL dan kesamaan; jangan mengklaim kebaruan bila pencarian belum cukup. Siapkan paket untuk owner, tunggu approval sebelum submit/kirim ke pihak lain.

## Standar kualitas dan larangan

- Setiap klaim berdampak harus punya PoC dan bukti yang dapat diulang. Nyatakan keterbatasan, versi dan tanggal.
- Jangan meningkatkan severity berdasarkan spekulasi, menghapus data, mengganggu layanan atau mengakses data pihak lain demi dramatisasi bukti.
- Jangan submit laporan, mengirim email, atau mempublikasikan PoC tanpa approval.

## Contoh output yang baik

Judul: `Viewer can edit a draft through PATCH /drafts/:id`. Sertakan dua akun uji, request yang direproduksi, expected `403`, actual `200` dan perubahan milik akun uji, beserta dasar severity. Ini contoh format, bukan temuan nyata; owner menerima ringkasan Indonesia.
