# Pixel Game Asset Studio

> **Local 2D Pixel Art Game Asset Studio: External AI Agent Workflow & Local Inspector**  
> AI Coding Agent $\to$ Assets Storage $\to$ Studio Live Viewport $\to$ Before/After Slider $\to$ Version History Rollback.

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13.0-brightgreen.svg)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero%20(Pure%20Native)-blue.svg)](package.json)
[![Tests](https://img.shields.io/badge/Tests-185%20Passed%20(100%25)-success.svg)](tests/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

**Pixel Game Asset Studio** adalah studio lokal (*Local-First*) untuk menginspeksi, membandingkan, menguji, dan mengelola aset game 2D pixel art hasil pembuatan **AI coding agent** pengguna di IDE atau terminal/CLI (Godot, Unity, Defold, Phaser, RPG Maker).

### 💡 Paradigma Utama: Pemisahan Tugas AI Agent vs Studio
1. **AI Agent (di IDE / Terminal / CLI)**:
   - Menerima instruksi pengguna dalam bahasa alami.
   - Menggunakan model AI yang dipilih pengguna pada lingkungannya.
   - Menggunakan referensi gambar jika disediakan.
   - Menghasilkan gambar dan menyimpannya langsung ke direktori aset disk (`assets/generated/<slug>/v1/`) bersama `metadata.json`.
2. **Pixel Game Asset Studio (di Browser Lokal)**:
   - Berfungsi sebagai **Local Inspector & Viewer** (bukan formulir prompt AI).
   - Membaca dan menyinkronkan file dari disk ke SQLite secara instan tanpa memerlukan API key eksternal.
   - Menyediakan Canvas Viewport presisi integer 1x-32x, pixel grid, alpha checkerboard, perbandingan Before/After, inspeksi metadata teknis, dan version history.

---

## ⚡ Panduan Cepat (Quickstart)

Untuk panduan kilat dalam 60 detik, silakan baca:  
👉 **[QUICKSTART.md](QUICKSTART.md)**

### Menjalankan Studio dalam 2 Perintah:
```powershell
# 1. Jalankan diagnostik sistem (Doctor Check)
npm run doctor

# 2. Jalankan Studio Web Server lokal
npm run dev
```
Buka browser di: **`http://127.0.0.1:5178`**

---

## 🤖 Integrasi AI Agent Skills

Studio mengikuti pola integrasi agent berbasis skill (terinspirasi dari arsitektur CLI agent). Panduan lengkap agent tersedia pada file **[AGENTS.md](AGENTS.md)**.

Skill yang tersedia di `.agents/skills/` dan `agents/skills/`:
- **`pixel-art-generation`**: Instruksi agent untuk membuat aset piksel art baru berdasarkan prompt dan menyimpan ke `assets/generated/<slug>/v1/processed.png` beserta `metadata.json`.
- **`pixel-art-revise`**: Instruksi agent untuk membuat variasi atau revisi non-destruktif ke `v2/`, `v3/`, tanpa menimpa versi sebelumnya.
- **`asset-review`**: Verifikasi integritas header PNG 24-byte, dimensi, palet warna, dan kelengkapan metadata.
- **`asset-history`**: Pelacakan riwayat versi dan silsilah revisi aset.
- **`asset-validation-export`**: Validasi pra-ekspor dan pengemasan aset untuk engine game.
- **`sprite-animation`**: Penataan frame animasi dan anchor point.
- **`tileset-generation`**: Autotiling bitmask 16-tile dan 47-tile untuk tileset lingkungan.

---

## 🎯 Fitur Studio Web (Local Inspector)

### 1. Asset Details & Technical Inspection Panel
- Menampilkan spesifikasi teknis lengkap: resolusi piksel asli, palet warna Lospec, format bit-depth, ukuran file, path relatif di disk, prompt sumber, model/tool pembuat, dan seed jika tercatat.
- Dilengkapi tombol salin path relatif yang aman untuk langsung dimasukkan ke skrip game engine.

### 2. Canvas Viewport Interaktif
- **Skala Integer Presisi (1x s/d 32x)**: Rendering CSS `image-rendering: pixelated` menjaga ketajaman piksel murni tanpa blur anti-aliasing.
- **Pan & Navigation**: Drag kanvas bebas dengan mouse atau trackpad.
- **Pixel Grid Overlay**: Garis kisi piksel 1px otomatis muncul saat zoom $\ge 4x$ untuk inspeksi grid yang presisi.
- **Papan Catur Transparansi**: Menampilkan kontras latar belakang transparan murni (*alpha channel*).

### 3. Before / After Comparison Slider
- **Split-Screen Slider Interaktif**: Membandingkan gambar input/referensi dengan hasil piksel art jika kedua file tersedia.
- **Kejujuran Data**: Jika hanya satu gambar yang tersedia pada versi tersebut, slider disembunyikan secara otomatis untuk menjaga integritas data tanpa memalsukan gambar pembanding.

### 4. Non-Destructive Version History & Rollback
- **Immutable Snapshots**: Setiap revisi disimpan dalam subfolder terpisah (`v1`, `v2`, dst.) dan terindeks di SQLite.
- **One-Click Rollback**: Tombol *Set Active* memungkinkan pengembang mengembalikan versi aktif aset kapan saja.
- **Fork / Revise**: Menyalin prompt versi lama ke clipboard untuk diiterasikan kembali dengan AI agent di IDE.

### 5. Filesystem Scanner & Zero Duplication
- **Scanner Otomatis & Manual**: Tombol *Rescan Assets* di browser atau perintah CLI `npm run scan` mendeteksi aset baru di folder disk tanpa membuat duplikasi di database.
- **Fast 24-Byte Header Parser**: Membaca dimensi gambar langsung dari chunk IHDR PNG tanpa memuat seluruh file ke RAM, memastikan kepatuhan terhadap batasan RAM 4 GB.

### 6. Safe Deletion & Crash Recovery Journal
- Penghapusan aset dilengkapi database cascading dan penghapusan folder fisik yang aman (*strict path jail*).
- Crash recovery journal melindungi dari kegagalan file lock di Windows.

---

## 🛠️ Perintah CLI & Skrip Tersedia

| Perintah | Deskripsi |
| :--- | :--- |
| `npm run dev` | Menjalankan server lokal Studio Web (`http://127.0.0.1:5178`) |
| `npm run scan` | Memindai `assets/generated/` dan menyinkronkan aset AI agent ke SQLite |
| `npm run doctor` | Memeriksa ketersediaan runtime Node.js, SQLite, folder storage, dan path jail |
| `npm test` | Menjalankan seluruh test suite otomatis (185 unit & integration tests) |
| `npm run test:unit` | Menjalankan pengujian unit (schema, scanner, quantizer, decoder, router) |
| `npm run test:integration` | Menjalankan pengujian integrasi (HTTP server, API scan, storage recovery) |
| `npm run test:manual:fal` | Menjalankan harness uji manual cloud Fal.ai jika `FAL_KEY` dikonfigurasi |
| `node scripts/benchmark-post-processing.js` | Mengukur latensi pipeline CPU dan konsumsi memori heap/RSS |

---

## 📁 Struktur Direktori Repositori

```text
pixel-generator/
├── .agents/skills/                  # Agent Skills (pixel-art-generation, revise, review, export)
├── agents/skills/                   # Mirror kompatibilitas Agent Skills
├── AGENTS.md                        # Panduan lengkap alur kerja AI Agent
├── QUICKSTART.md                    # Panduan instalasi dan penggunaan kilat
├── assets/
│   ├── generated/                   # Direktori penyimpanan hasil AI agent (<slug>/v1/)
│   ├── references/                  # Direktori gambar referensi pengguna
│   └── exports/                     # Direktori paket ekspor game engine
├── studio/
│   ├── cli/                         # CLI Studio (cmd-doctor, cmd-dev, cmd-scan)
│   ├── client/                      # Web Studio Frontend (HTML5, Vanilla CSS3, ES Modules)
│   │   ├── index.html               # Single-page local inspector & canvas viewport
│   │   ├── css/                     # Styling (main.css, studio.css, library.css)
│   │   └── js/                      # Modul frontend (viewport, slider, timeline, details)
│   └── server/                      # Backend Server (Node.js Native ESM)
│       ├── index.js                 # Native HTTP Server, static router, streamer
│       ├── config.js                # Loader konfigurasi
│       ├── db/                      # SQLite database, schema DDL, safe-deletion
│       ├── queue/                   # Job queue, store, asset coordinator
│       ├── storage/                 # Storage manager, path jail, asset scanner
│       ├── providers/               # Abstraksi provider (Mock & Fal.ai)
│       ├── post-processing/         # Pure-JS PNG decoder, cutout, framer, quantizer
│       └── routes/                  # API routes (config, projects, assets, scan, stream)
└── tests/
    ├── unit/                        # 13 test suite unit (174 tests)
    └── integration/                 # 6 test suite integrasi (11 tests)
```

---

## 📄 Lisensi
Didistribusikan di bawah lisensi MIT. Lihat file `LICENSE` untuk informasi lebih lanjut.
