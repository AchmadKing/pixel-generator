# Pixel Game Asset Studio

> **Local 2D Pixel Art Generator & Studio Workbench**  
> Prompt $\to$ Non-Destructive Post-Processing $\to$ Live Canvas Viewport $\to$ Before/After Slider $\to$ Version History Rollback.

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13.0-brightgreen.svg)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero%20(Pure%20Native)-blue.svg)](package.json)
[![Tests](https://img.shields.io/badge/Tests-172%20Passed%20(100%25)-success.svg)](tests/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

**Pixel Game Asset Studio** adalah aplikasi berbasis web lokal (*Local-First*) untuk menghasilkan, mengedit, dan mengelola aset game 2D piksel art siap pakai untuk game engine modern (Godot, Unity, Defold, Phaser, RPG Maker).

Aplikasi ini menggabungkan model generasi AI dengan **pipeline post-processing deterministik lokal murni (Pure JS)** untuk menghasilkan piksel art sejati: penghapusan latar belakang solid (*4-corner chroma cutout*), framing dan pemusatan otomatis, serta kuantisasi warna ke palet retro klasik (*Endesga 32, PICO-8, GameBoy, NES*).

---

## ⚡ Panduan Cepat (Quickstart)

Untuk panduan instalasi kilat dalam 60 detik, silakan baca:  
👉 **[QUICKSTART.md](QUICKSTART.md)**

### Menjalankan dalam 2 Perintah:
```powershell
# 1. Jalankan diagnostik sistem (Doctor Check)
npm run doctor

# 2. Jalankan Studio Web Server lokal
npm run dev
```
Buka browser Anda di: **`http://127.0.0.1:5178`**

---

## 🎯 Fitur Utama

### 1. Studio Web Workbench (Vanilla HTML5 / CSS3 / ES Modules)
- **Zero External Dependencies**: Tidak memerlukan Vite, Webpack, React, atau build step. Langsung dimuat instan pada browser modern.
- **Desain Dark Modern Retro**: Menggunakan font stack sistem lokal (100% offline ready), panel glassmorphism halus, dan aksen neon cyan.
- **RAM 4 GB Friendly**: Dioptimalkan secara khusus untuk hemat penggunaan memori (peak heap $< 10$ MB) dan lancar pada CPU standar.

### 2. Canvas Viewport Interaktif
- **Skala Integer Presisi (1x s/d 32x)**: Rendering CSS `image-rendering: pixelated` menjaga ketajaman piksel murni tanpa blur anti-aliasing.
- **Pan & Navigation**: Drag kanvas bebas dengan mouse atau trackpad.
- **Pixel Grid Overlay**: Garis kisi piksel 1px otomatis muncul saat zoom $\ge 4x$ untuk inspeksi grid yang presisi.
- **Papan Catur Transparansi**: Menampilkan kontras latar belakang transparan murni (*alpha channel*).

### 3. Before / After Comparison Slider
- **Split-Screen Slider Interaktif**: Tarik pembatas di tengah gambar untuk membandingkan output mentah AI (`raw.png`) vs hasil post-processing piksel art (`processed.png`).
- **Skala & Koordinat Tersinkronisasi**: Menjamin tidak ada pergeseran piksel saat membandingkan sebelum dan sesudah.
- **Mode Tampilan Lengkap**: Mendukung mode *Split View*, *Final Output*, *Raw Input*, dan *Side-by-Side*.

### 4. Non-Destructive Version History & Rollback
- **Immutable Snapshots**: Setiap generasi versi baru disimpan secara permanen di disk dan SQLite tanpa menimpa versi sebelumnya.
- **One-Click Rollback**: Tombol *Set Active* memungkinkan pengembang mengembalikan versi aktif aset kapan saja tanpa kehilangan riwayat snapshot lainnya.
- **Fork / Revise**: Menyalin prompt, seed, palet, dan dimensi versi lama ke formulir untuk iterasi variasi baru.

### 5. Multi-Provider Generation Engine
- **Mock Provider (100% Offline Ready)**: Generator prosedural deterministik berbasis PRNG SplitMix32. Gratis, tidak butuh koneksi internet atau API key.
- **Fal.ai Cloud Queue Provider (Flux LoRA)**: Terintegrasi dengan cloud queue Fal.ai untuk generasi berkualitas tinggi. Dilengkapi perlindungan tagihan ganda (*anti-duplicate billing*) dan validasi keamanan SSRF.

### 6. Failure-Safe Storage & Asset Deletion
- **SQLite ACID Metadata**: Penyimpanan metadata terstruktur menggunakan modul native `node:sqlite` dengan WAL mode dan integrity triggers.
- **Crash Recovery Journal**: Tabel persisten `asset_deletion_journal` memastikan penghapusan aset yang terinterupsi atau mengalami file lock di Windows dapat dipulihkan secara otomatis saat startup.
- **In-Flight Concurrency Guard**: Mencegah race condition antara job yang sedang berjalan dan penghapusan aset (`ERR_ASSET_BUSY`).

---

## 🛠️ Perintah CLI & Skrip Tersedia

| Perintah | Deskripsi |
| :--- | :--- |
| `npm run dev` | Menjalankan server lokal Studio Web (`http://127.0.0.1:5178`) |
| `npm run doctor` | Memeriksa ketersediaan runtime Node.js, SQLite, folder storage, dan path jail |
| `npm test` | Menjalankan seluruh test suite otomatis (172 unit & integration tests) |
| `npm run test:unit` | Menjalankan pengujian unit (schema, quantizer, decoder, router, orchestrator) |
| `npm run test:integration` | Menjalankan pengujian integrasi (HTTP server, provider queue, storage recovery) |
| `npm run test:manual:fal` | Menjalankan harness uji manual cloud Fal.ai (memerlukan `FAL_KEY`) |
| `node scripts/benchmark-post-processing.js` | Mengukur latensi pipeline CPU dan konsumsi memori heap/RSS |

---

## 📁 Struktur Direktori Repositori

```text
pixel-generator/
├── studio/
│   ├── client/                      # Web Studio Frontend (Vanilla HTML/CSS/JS)
│   │   ├── index.html               # Halaman tunggal Studio Web SPA
│   │   ├── css/                     # Styling (main.css, studio.css, library.css)
│   │   └── js/                      # Modul frontend (viewport, slider, timeline, form)
│   ├── server/                      # Backend Server (Node.js Native ESM)
│   │   ├── index.js                 # Native HTTP Server, static router, streamer
│   │   ├── config.js                # Loader konfigurasi & runtime version guard
│   │   ├── db/                      # SQLite database, schema DDL, safe-deletion
│   │   ├── queue/                   # Job queue, store, asset coordinator
│   │   ├── storage/                 # Storage manager, path jail, deletion orchestrator
│   │   ├── providers/               # Abstraksi provider (Mock & Fal.ai)
│   │   ├── post-processing/         # Pure-JS PNG decoder, cutout, framer, quantizer
│   │   └── routes/                  # Route handlers (config, projects, assets, jobs, stream)
│   └── cli/                         # Perintah CLI (studio.js, cmd-dev.js, cmd-doctor.js)
├── assets/                          # Folder penyimpanan data lokal
│   ├── studio.db                    # Basis data SQLite utama (WAL mode)
│   ├── generated/                   # Direktori output gambar (raw.png & processed.png)
│   ├── projects/                    # Metadata project game
│   └── exports/                     # Paket ekspor
├── tests/                           # Rangkaian pengujian otomatis (172 tests)
│   ├── unit/                        # Pengujian unit modul
│   └── integration/                 # Pengujian integrasi end-to-end
├── scripts/                         # Script benchmark dan harness pengujian
├── rules/                           # Standar estetika dan aturan piksel art
├── QUICKSTART.md                    # Panduan instalasi dan penggunaan cepat
├── package.json                     # Metadata proyek & script npm
└── README.md                        # Dokumentasi utama proyek
```

---

## 🔒 Keamanan & Perlindungan Sistem

1. **Strict Localhost Loopback**: Server terikat ke `127.0.0.1` secara default untuk mencegah akses tidak sah dari jaringan lokal.
2. **DNS Rebinding & CSRF Protection**: Header `Host` dan `Origin` divalidasi ketat pada request mutatif (`POST`, `PUT`, `DELETE`).
3. **Multi-Layer Path Jail**: Mencegah serangan path traversal (`../`, `%2e%2e`, null bytes) melalui validasi alfanumerik regex dan pemeriksaan canonical containment via `fs.realpathSync.native`.
4. **Zero Path Leaks**: Respons API tidak mengekspos lokasi file fisik internal komputer, melainkan menyajikan URL streaming biner terisolasi.

---

## 📄 Lisensi

Proyek ini dirilis di bawah lisensi [MIT](LICENSE).
