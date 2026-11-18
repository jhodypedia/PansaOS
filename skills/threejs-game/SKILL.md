---
name: threejs-game
description: Build playable responsive 3D games with measured game feel, smooth animation, full controls and gameplay evidence; bangun game 3D responsif yang dapat dimainkan, beranimasi halus, berkontrol lengkap serta memiliki bukti gameplay.
triggers: [three.js, threejs, game, 3d, permainan, buatkan game, gameplay, webgl, animasi game]
tools: [read_file, read_skill, write_file, edit_file, bash, browser, run_node, lint_test]
---

# Three.js game

Domain: gameplay, rendering 3D dan game feel. Baca coding-agent untuk kualitas software, bahasa deliverable, aksesibilitas dan motion umum; baca makefun-bounty bila game adalah entry kompetisi.

## Langkah kerja

1. Ekstrak tujuan permainan, win/lose conditions, platform, input, batas aset dan rubrik brief. Pilih mekanik inti yang dapat diselesaikan penuh; dokumentasikan kontrol sebelum implementasi.
2. Bangun state eksplisit menu → play → game-over, pause/resume bila relevan, skor, restart tanpa refresh dan instruksi terlihat. Restart harus mereset timer, input, entity, skor dan difficulty; jangan menggandakan listener atau render loop.
3. Gunakan requestAnimationFrame dengan delta time dalam detik, clamp delta setelah tab kembali, dan fixed timestep/accumulator untuk physics yang membutuhkan determinisme. Pisahkan input, update simulation, collision dan render. Pause saat visibility berubah agar pemain tidak kalah karena tab tersembunyi.
4. Implementasikan keyboard serta pointer/touch dengan tombol cukup besar. Tangani keyup, pointercancel, blur, multi-touch dan pencegahan scroll hanya pada area game. Jangan membuat gameplay bergantung pada hover. Tampilkan instruksi keyboard dan sentuh dalam English.
5. Atur renderer, camera aspect/projection dan ukuran canvas saat resize; cap devicePixelRatio sesuai anggaran performa. Uji portrait/landscape dan HUD yang tidak tertutup kontrol atau notch. Sediakan pesan gagal WebGL yang dapat ditindaklanjuti.
6. Gunakan procedural geometry/material bila aset tidak tersedia. Bangun identitas visual melalui warna, pencahayaan, komposisi, feedback hit/score, partikel terbatas, easing dan transisi state. Screen shake singkat dan ringan; matikan shake/flash/partikel dekoratif pada reduced motion. Jangan mengganti keterbacaan gameplay dengan efek.
7. Tetapkan anggaran scene sesuai perangkat: mulai dengan draw calls rendah, instancing untuk objek berulang, reuse geometry/material, object pooling untuk partikel, batas entity dan shadow. Pantau renderer.info, frame time dan memori saat beberapa kali restart. Dispose geometry, material, texture, render target serta listener/rAF saat unmount.
8. Uji game nyata: mulai, bergerak, collision, skor bertambah sesuai aturan, menang/kalah, restart berulang, touch dan resize. Jalankan build dan test state/simulation yang relevan. Jika browser tidak tersedia, catat gameplay belum diverifikasi; jangan menyebut screenshot atau frame rate yang tidak diukur.
9. Sertakan README Inggris berisi instalasi, run/build/test, keyboard/touch controls, gameplay rules, aset/lisensi, hasil uji dan batasan. Simpan screenshot menu, gameplay, game-over serta mobile bila browser tersedia dan laporkan ke owner dalam Indonesia.

## Standar kualitas dan larangan

- Loop playable harus lengkap; tidak cukup scene yang hanya berputar atau tombol Start tanpa state.
- Jangan mengunduh aset tanpa lisensi/izin, membocorkan secret, atau membuat skor/pengujian palsu.
- Verifikasi frame pacing pada perangkat/viewport yang disebut sebelum mengklaim 60fps. Hormati batas biaya GPU dan hentikan loop ketika tidak terlihat.

## Contoh bukti yang baik

`evidence/gameplay.md`: “Start → collect item → score 1 → collide → Game over → Restart resets score to 0”, disertai viewport, kontrol yang dipakai, screenshot nyata, command build dan exit code. Laporan owner: “Alur bermain dan restart sudah diuji; kontrol sentuh belum diuji pada perangkat fisik.”
