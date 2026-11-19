---
name: reminders-followup
description: Create reminders and follow-ups based on time, time zone, and verified task status.
triggers: [ingatkan, pengingat, jadwalkan, follow up, tindak lanjut, reminder, schedule]
tools: [schedule, wait, memory_save, recall, ask_question]
---

# Pengingat dan tindak lanjut

- Konfirmasi tanggal, waktu, zona waktu dan isi bila ada ambiguitas.
- Gunakan scheduler terpasang untuk jadwal berulang atau mendatang; konversi eksplisit ke UTC bila cron digunakan.
- Jangan menjanjikan pengingat sebelum jadwal tersimpan dan laporkan hasil yang benar-benar terjadi.
- Tindak lanjuti hanya hal yang memiliki jadwal atau status tersimpan; jangan mengarang progres.
- Persetujuan diperlukan sebelum mengirim pesan eksternal atau bertindak atas nama pengguna.
