# Quickstart Guide: Pixel Game Asset Studio

Panduan ringkas untuk langsung menginstal, menjalankan, dan menggunakan **Pixel Game Asset Studio** setelah melakukan `git clone` atau `git pull` dari repositori ini.

---

## ⚡ Arsitektur Alur Kerja (AI Agent + Local Studio)

> **Prinsip Utama:** AI Coding Agent membuat aset di IDE/Terminal; Studio membaca, menginspeksi, dan mengelola hasilnya.

```text
PENGGUNA (IDE / Terminal)
   │
   ├── AI Coding Agent (Claude, Gemini, Antigravity, Cursor, Copilot)
   ├── Prompt teks & referensi gambar (opsional)
   ├── Agent Skills (.agents/skills/)
   ▼
FOLDER ASET LOKAL (assets/generated/<slug>/v1/)
   ├── processed.png (atau image.png)
   ├── metadata.json
   ├── reference.png / raw.png (opsional)
   ▼
PIXEL GAME ASSET STUDIO (http://127.0.0.1:5178)
   ├── Rescan Assets (Deteksi otomatis folder disk)
   ├── Canvas Viewport (Zoom 1x-32x, Pan, Pixel Grid, Checkerboard)
   ├── Asset Details (Inspeksi teknis, format, dimensi, metadata prompt)
   ├── Before / After Comparison (Ketika raw/referensi tersedia)
   └── Version History Timeline (Non-destructive rollback)
```

---

## 🚀 Quickstart dalam 60 Detik

Proyek ini dibangun murni menggunakan **Node.js Native** (Zero External npm Packages). Tidak diperlukan proses build, bundling, atau instalasi paket eksternal yang lambat.

### 1. Prasyarat Sistem
- **Node.js**: Versi **`>= 22.13.0`** (Wajib untuk modul native `node:sqlite`). Disarankan **Node.js 24 LTS**.
  ```powershell
  node --version
  ```
  *Jika versi Node Anda di bawah 22.13.0, silakan perbarui dari [nodejs.org](https://nodejs.org).*
- **OS**: Windows 10/11 (64-bit), macOS, atau Linux.
- **Hardware**: Berjalan lancar pada CPU standar dan RAM 4 GB (RAM 4 GB Friendly).

### 2. Jalankan Diagnostik Sistem (Doctor Check)
Pastikan database SQLite, permission direktori, dan runtime Node.js sudah siap:
```powershell
npm run doctor
```
Output yang diharapkan:
```text
>>> DOCTOR STATUS: ALL HEALTH CHECKS PASSED (SYSTEM READY) <<<
```

### 3. Jalankan Studio Web Server
Jalankan perintah berikut:
```powershell
npm run dev
# atau: node studio/cli/studio.js dev
```

Output terminal:
```text
======================================================================
  🚀 STUDIO WEB RUNNING AT: http://127.0.0.1:5178
  📁 Storage: assets/generated
  🎨 Mode: External AI Agent Workflow + Local Inspector
  🛑 Press Ctrl+C to stop server cleanly.
======================================================================
```

### 4. Buka Antarmuka Web di Browser
Akses URL berikut pada peramban web modern Anda (Chrome, Edge, Firefox, Brave):  
👉 **`http://127.0.0.1:5178`**

---

## 🎨 Cara Membuat Aset Menggunakan AI Agent

Pembuatan aset **tidak** dilakukan melalui formulir di browser, melainkan langsung melalui **AI coding agent** yang Anda gunakan di IDE atau terminal:

### Langkah 1: Berikan Instruksi ke AI Agent
Di jendela chat agent Anda (Antigravity, Cursor, Copilot, dll.), mintalah pembuatan aset:
> *"Tolong buatkan aset pixel art 32x32 pedang api (flame-sword) dengan palet endesga-32."*

### Langkah 2: Agent Menghasilkan dan Menyimpan File
Agent akan memanfaatkan image-generation tool yang tersedia di lingkungannya dan menyimpan hasil ke:
```text
assets/generated/flame-sword/v1/
  ├── processed.png
  └── metadata.json
```

### Langkah 3: Inspeksi di Studio
1. Buka browser di `http://127.0.0.1:5178`.
2. Klik tombol **Rescan Assets** di header atas (atau jalankan `npm run scan` di terminal).
3. Aset baru akan langsung muncul di panel galeri sebelah kiri!
4. Klik aset tersebut untuk melihat preview kanvas, detail spesifikasi teknis, dan metadata prompt sumber.

---

## 🔍 Fitur Inspeksi & Pengelolaan di Studio

### 1. Canvas Viewport Interaktif
- **Zoom Presisi (1x s/d 32x)**: Gunakan tombol `+`, `−`, scroll mouse wheel, tombol `1:1`, atau `Fit`.
- **Pan (Geser)**: Klik kiri dan tahan pada area kanvas lalu geser mouse.
- **Pixel Grid**: Tekan tombol `#` di toolbar atas untuk mengaktifkan grid garis piksel.
- **Alpha Checkerboard**: Menampilkan transparansi murni (alpha channel) di belakang piksel.

### 2. Asset Details & Inspeksi Metadata
- Panel kanan menampilkan nama aset, kategori, resolusi asli, palet warna yang digunakan, path relatif file di disk, prompt sumber, dan model/tool pembuat.
- Tombol **Copy** untuk menyalin path file relatif untuk kebutuhan game engine.
- Tombol **Download PNG** untuk mengunduh file secara langsung.

### 3. Komparasi Before / After
Jika aset memiliki gambar raw atau referensi asli (`raw.png` atau `reference.png` di samping `processed.png`):
- **Split View**: Geser pegangan pembatas di tengah kanvas untuk membandingkan input vs hasil akhir.
- **Final Output**: Menampilkan hasil akhir piksel art saja.
- **Raw Input**: Menampilkan input mentah/referensi saja.
- **Side-by-Side**: Menampilkan kedua gambar secara berdampingan.
*(Catatan: Jika hanya satu gambar yang tersedia, slider disembunyikan secara elegan untuk menjaga keaslian data).*

### 4. Non-Destructive Version History & Rollback
1. Klik tab **History** di panel kanan untuk melihat seluruh snapshot versi (`v1`, `v2`, dst.).
2. Setiap versi mencatat riwayat prompt, catatan revisi, dan waktu pembuatan.
3. Klik **Fork / Revise** untuk menyalin prompt revisi ke clipboard untuk diinstruksikan kembali ke AI agent.
4. Klik **Set Active** untuk beralih versi aktif tanpa menghapus versi lama (*non-destructive rollback*).

### 5. Galeri Aset & Penghapusan Aman
- Klik tombol **Asset Library** di header atas untuk membuka/menutup galeri aset.
- Gunakan filter kategori (`Items`, `Characters`, `Environment`, `VFX`, `UI`).
- Klik **Delete Asset** pada tab History untuk menghapus aset secara aman melalui database cascading and filesystem cleanup.

---

## 🛠️ Perintah CLI & Skrip

| Perintah | Deskripsi |
| :--- | :--- |
| `npm run dev` | Menjalankan server lokal Studio Web (`http://127.0.0.1:5178`) |
| `npm run scan` | Memindai `assets/generated/` dan menyinkronkan aset AI agent ke SQLite |
| `npm run doctor` | Memeriksa ketersediaan runtime Node.js, SQLite, direktori storage, dan path jail |
| `npm test` | Menjalankan seluruh test suite otomatis (185 unit & integration tests) |
| `npm run test:unit` | Menjalankan pengujian unit (schema, scanner, quantizer, decoder, path jail) |
| `npm run test:integration` | Menjalankan pengujian integrasi (HTTP server, API scan, storage recovery) |
