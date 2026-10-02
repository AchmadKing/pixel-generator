# Pixel Game Asset Studio

Generator aset game 2D berbasis pixel art yang dirancang untuk menghasilkan sprite, animasi frame, tileset, dan ikon yang siap pakai di game engine (Godot, Unity, Defold, Phaser, dll).

---

## 1. Persyaratan Sistem & Runtime

- **Node.js**: Versi **`>= 22.13.0`** (Wajib untuk ketersediaan modul native `node:sqlite` tanpa flag eksperimental). Direkomendasikan Node.js 24 LTS.
- **Sistem Operasi**: Windows 10/11 64-bit, macOS, atau Linux.
- **Kebutuhan Hardware**: Berjalan lancar pada CPU Celeron/Pentium dan RAM 4 GB (zero external C++ binary compilation).

---

## 2. Mode Operasional: Mock (Offline) vs Fal.ai (Cloud AI)

Aplikasi dirancang **Local-First & Provider-Agnostic**:
1. **Mode Offline / Mock (Bawaan)**:
   - Beroperasi 100% lokal tanpa koneksi internet dan tanpa biaya API.
   - Menggunakan generator prosedural deterministik untuk pengujian workflow, preview, manipulasi palet, dan ekspor.
   - Ditandai dengan badge visual: `[OFFLINE / MOCK MODE]`.
2. **Mode Cloud AI (Fal.ai Flux LoRA)**:
   - Menggunakan model AI generatif Flux PixelArt LoRA.
   - Cukup tambahkan `FAL_KEY=your_key_here` pada file `.env` lokal Anda.
   - Panggilan API dilindungi dari penagihan ganda (*anti-duplicate billing*) dengan pemisahan timeout per-request (15s) vs total job (120s).

---

## 3. Panduan Penggunaan di Windows (PowerShell / CMD)

### Jalankan Diagnostik Lingkungan (Health Check)
Pastikan lingkungan runtime, direktori aset, dan database SQLite terverifikasi:
```powershell
npm run doctor
# atau
node studio/cli/studio.js doctor
```

### Jalankan Server Foundation Studio
```powershell
npm run dev
# atau
node studio/cli/studio.js dev
```

### Jalankan Rangkaian Acceptance Test
```powershell
npm test
```

---

## 4. Struktur Proyek

```
pixel-game-asset-studio/
├── rules/                    # Standar & aturan generasi pixel art
├── agents/skills/            # Definisi kemampuan coding agent
├── assets/                   # Penyimpanan biner lokal & database SQLite
│   ├── projects/             # Metadata project game
│   ├── generated/            # Aset raw.png dan processed.png
│   ├── exports/              # Paket ekspor ZIP
│   └── references/           # Gambar referensi input pengguna
├── studio/
│   ├── server/               # Backend Node.js native ESM
│   │   ├── config.js         # Runtime guard & konfigurasi
│   │   ├── db/               # SQLite connection, DDL, & safe-deletion
│   │   ├── storage/          # Storage manager, path jail, & reconciler
│   │   └── queue/            # Job queue & recovery
│   └── cli/                  # CLI doctor & dev commands
└── tests/                    # Unit & Integration Acceptance Tests
```
