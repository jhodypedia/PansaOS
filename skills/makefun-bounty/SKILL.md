---
name: makefun-bounty
description: Jalankan bounty make.fun dari brief sampai paket submit yang diuji.
triggers: [make.fun, makefun, bounty]
tools: [makefun_fetch_bounty, makefun_plan, makefun_build, makefun_verify, makefun_submit_pack, write_file, bash]
---

# Bounty make.fun

1. Ambil brief dari URL nyata atau teks user. Jika halaman membutuhkan login, minta brief atau akses yang disetujui. Jangan menebak endpoint API.
2. Simpan bounty dengan makefun_fetch_bounty dan petakan setiap kriteria penilaian dengan makefun_plan.
3. Baca skill coding-agent atau threejs-game sesuai deliverable. Gunakan write_file dan shell sandbox untuk implementasi penuh.
4. Jalankan test nyata. Isi evidence setiap kriteria dari output test, file, atau screenshot yang benar-benar dibuat.
5. Panggil makefun_verify. Perbaiki test gagal. Pastikan README menjelaskan instalasi, kontrol, batasan, dan hasil test.
6. Panggil makefun_submit_pack setelah verifikasi lulus. Kirim ringkasan dan ZIP ke admin dengan approval. Status submitted hanya setelah konfirmasi user bahwa submission eksternal selesai.
