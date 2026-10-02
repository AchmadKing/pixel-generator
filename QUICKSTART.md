# Quickstart Guide: Pixel Game Asset Studio

Panduan ringkas untuk langsung menginstal, menjalankan, dan menggunakan **Pixel Game Asset Studio** setelah melakukan `git clone` atau `git pull` dari repositori ini.

---

## ⚡ Quickstart dalam 60 Detik (Tanpa Install Dependensi Eksternal)

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
Cukup jalankan satu perintah berikut:
```powershell
npm run dev
# atau: node studio/cli/studio.js dev
```

Output terminal:
```text
======================================================================
  🚀 STUDIO WEB RUNNING AT: http://127.0.0.1:5178
  📁 Storage: assets
  🎨 Active Provider: Mock Procedural Pixel Generator [100% OFFLINE READY]
  🛑 Press Ctrl+C to stop server cleanly.
======================================================================
```

### 4. Buka Antarmuka Web di Browser
Akses URL berikut pada peramban web modern Anda (Chrome, Edge, Firefox, Brave):
👉 **`http://127.0.0.1:5178`**

---

## 🎮 Cara Menggunakan Studio Web

Setelah membuka `http://127.0.0.1:5178`, Anda dapat langsung membuat dan mengedit aset piksel art:

### 1. Membuat Aset Baru (Generate Asset)
1. Pada panel kanan (**Workbench**), masukkan **Prompt** (contoh: `"fantasy health potion bottle with glowing red liquid"`).
2. Pilih **Category** (`Items`, `Characters`, `Environment`, `VFX`, `UI`).
3. Pilih **Resolution** (`16x16`, `24x24`, `32x32`, `48x48`, `64x64`).
4. Pilih **Color Palette** (`Endesga 32`, `PICO-8`, `GameBoy 4`, `NES 54`).
5. (Opsional) Tekan tombol 🎲 untuk mengacak **Seed**.
6. Klik **⚡ Generate Asset**.
7. Perhatikan **Progress HUD** real-time di bagian bawah kanvas:
   `Queued` $\to$ `Submitting` $\to$ `Generating` $\to$ `Post-Processing` $\to$ `Completed`.

### 2. Menginspeksi Aset di Canvas Viewport
- **Zoom**: Gunakan tombol `+`, `−`, scroll mouse wheel, tombol `1:1`, atau `Fit`.
- **Pan (Geser)**: Klik kiri dan tahan pada area kanvas lalu geser mouse.
- **Pixel Grid**: Tekan tombol `#` di toolbar atas untuk mengaktifkan/menonaktifkan grid garis piksel.
- **Checkerboard**: Menampilkan transparansi murni (alpha channel) di belakang piksel.

### 3. Komparasi Before / After
Gunakan tombol di toolbar atas:
- **Split View**: Geser pegangan bundar di tengah gambar ke kiri atau kanan untuk membandingkan output mentah AI (`raw.png`) dengan hasil piksel art yang sudah di-cutout dan di-quantize (`processed.png`).
- **Final Output**: Menampilkan hasil akhir piksel art saja.
- **Raw Input**: Menampilkan gambar mentah saja.
- **Side-by-Side**: Menampilkan gambar mentah dan hasil akhir secara berdampingan.

### 4. Non-Destructive Version History & Rollback
1. Klik tab **History** di panel kanan untuk melihat seluruh snapshot versi (`v1`, `v2`, dst.) dari aset yang dipilih.
2. Setiap versi mencatat parameter prompt, seed, palet, resolusi, dan waktu pembuatan.
3. Klik **Fork / Revise** pada versi mana saja untuk memuat ulang parameternya ke form generasi untuk membuat variasi baru.
4. Klik **Set Active** untuk mengubah versi aktif tanpa menghapus atau merusak versi lainnya (*non-destructive rollback*).

### 5. Galeri Aset & Penghapusan Aman
- Klik tombol **Asset Library** di header atas untuk membuka/menutup panel galeri aset di sebelah kiri.
- Gunakan filter kategori (`Items`, `Characters`, dll.) untuk menyaring aset.
- Klik **Delete Asset** pada tab History untuk menghapus aset secara aman melalui dialog konfirmasi. Sistem membersihkan record database dan direktori fisik di disk.

---

## 🌐 Mode Operasional: Offline vs Cloud AI

| Fitur | Mode Mock (Bawaan) | Mode Fal.ai (Cloud AI) |
| :--- | :--- | :--- |
| **Koneksi Internet** | Tidak butuh (100% Offline) | Butuh koneksi internet |
| **API Key / Biaya** | Gratis ($0.00 / Zero Cost) | Memerlukan saldo Fal.ai |
| **Model** | Generator Prosedural Deterministik | Flux LoRA PixelArt Cloud Model |
| **Tujuan** | Pengembangan, pengujian UI/UX, benchmark | Produksi aset menggunakan model generative AI |

### Cara Mengaktifkan Fal.ai Cloud Provider:
1. Buat file `.env` di root direktori (atau salin dari `.env.example`):
   ```powershell
   Copy-Item .env.example .env
   ```
2. Isi nilai `FAL_KEY` dengan API Key dari [fal.ai](https://fal.ai):
   ```env
   FAL_KEY=key_anda_disini
   PORT=5178
   HOST=127.0.0.1
   ```
3. Restart server: `npm run dev`. Studio akan otomatis mendeteksi kunci dan beralih ke Fal.ai Cloud Provider.

---

## 🧪 Pengujian Otomatis (Test Suite)

Repositori ini dilengkapi rangkaian pengujian otomatis lengkap (**172 Automated Tests**):

```powershell
# Jalankan seluruh test suite (Unit & Integration)
npm test

# Jalankan hanya unit tests
npm run test:unit

# Jalankan hanya integration tests
npm run test:integration

# Jalankan benchmark efisiensi post-processing & penggunaan RAM
node scripts/benchmark-post-processing.js
```

---

## ❓ FAQ & Troubleshooting

### 1. Error: `Port 5178 is already in use by another process`
Jika port 5178 sedang dipakai oleh aplikasi lain, Anda dapat menentukan port lain via environment variable:
```powershell
# Di PowerShell:
$env:PORT="5180"; npm run dev

# Di CMD (Command Prompt):
set PORT=5180 && npm run dev
```

### 2. Error: `Node.js version >= 22.13.0 is required`
Periksa versi Node.js Anda dengan `node -v`. Jika masih di bawah `v22.13.0`, modul native SQLite (`node:sqlite`) belum didukung secara stabil. Silakan pasang Node.js versi terbaru (v22 LTS atau v24 LTS).

### 3. Di mana file gambar hasil generasi disimpan?
Semua file disimpan secara lokal di dalam folder:
- Gambar mentah: `assets/generated/<asset_id>/<version_id>/raw.png`
- Gambar piksel art: `assets/generated/<asset_id>/<version_id>/processed.png`
- Basis data SQLite: `assets/studio.db`
