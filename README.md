# Arsip Digital (Tata)

Sistem manajemen arsip digital berbasis web — kelola folder, unggah berkas, sinkronisasi cloud, multi-bahasa, dan autentikasi pengguna.

**Demo / Hosting:** Firebase project `tata-arsip-digital`  
**Stack:** HTML · CSS · JavaScript (vanilla) · Firebase (Auth, Firestore, Storage)

---

## Struktur project

```
.
├── index.html              # Halaman utama (UI)
├── css/
│   └── style.css           # Semua gaya tampilan
├── js/
│   ├── firebase-config.js  # Konfigurasi & init Firebase
│   └── app.js              # Logika aplikasi (auth, data, UI, i18n, routing)
├── assets/
│   ├── logo.png            # Logo aplikasi (sidebar & favicon)
│   └── logo.jpg            # Logo alternatif
├── firebase.json           # Konfigurasi Firebase Hosting
├── .firebaserc             # Project ID default
└── README.md               # Dokumentasi ini
```

---

## Fitur

| Fitur | Keterangan |
|--------|------------|
| **Login / Register** | Email + password via Firebase Authentication |
| **Email verifikasi** | Link verifikasi dikirim setelah daftar / login jika belum verified |
| **Reset password** | Kirim link reset ke email |
| **Contact admin** | Pesan disimpan ke koleksi Firestore `contact_messages` |
| **Dashboard** | Rak folder (card), statistik, chart dokumen per bulan, status dokumen |
| **Kelola folder** | Tambah, edit, hapus folder (dengan warna & ikon) |
| **Arsip (file)** | Unggah, preview, edit, pindah folder, hapus ke sampah, pulihkan |
| **Sampah** | Soft-delete + hapus permanen |
| **Pencarian** | Cari di nama file & folder |
| **Filter & sort** | Filter per folder, urut tanggal/nama |
| **Multi-bahasa** | Indonesia, English, Melayu, 日本語, العربية |
| **Routing hash** | URL `#/dashboard`, `#/all`, `#/folders`, `#/trash`, `#/folder/...` — tombol Back browser mengikuti urutan halaman |
| **Penyimpanan lokal** | IndexedDB (blob file) + `localStorage` (metadata) |
| **Cloud sync** | Metadata ke Firestore; file ke Firebase Storage |
| **Notifikasi in-app** | Panel lonceng |
| **Sync Drive (ringan)** | Snapshot + unduh backup JSON (OAuth Drive penuh opsional) |

---

## Backend (Firebase)

Aplikasi ini **frontend-only**; backend memakai layanan Firebase:

### 1. Authentication
- Email/Password
- `sendEmailVerification` setelah register
- `sendPasswordResetEmail` dari modal “Forgot password”
- Persistensi: LOCAL (Remember me) atau SESSION

### 2. Firestore
- `users/{uid}` — profil ringkas (name, email, createdAt)
- `users/{uid}/app/data` — metadata aplikasi (folders, files, trash, notifications)
- `contact_messages` — pesan dari form Contact Admin

### 3. Storage
- Path file pengguna (upload blob arsip)
- Digunakan untuk restore URL preview (gambar/PDF) dari cloud

### 4. Hosting
- Static hosting untuk `index.html`, CSS, JS, assets
- Rewrite semua path → `index.html` (SPA)

> **Catatan keamanan:** API key di `js/firebase-config.js` bersifat client-side (normal untuk Firebase Web). Batasi domain di Firebase Console → Authentication / App Check, dan atur **Security Rules** Firestore & Storage agar hanya user terautentikasi yang akses datanya sendiri.

Contoh aturan Firestore (ringkas):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /contact_messages/{id} {
      allow create: if request.auth != null;
      allow read: if false; // hanya admin lewat Console / backend
    }
  }
}
```

---

## Cara menjalankan lokal

1. Clone / unduh repo ini.
2. Karena ada modul Firebase & path relatif, **jangan** hanya double-click `index.html` (protokol `file://` sering bermasalah).
3. Jalankan server statis sederhana, contoh:

```bash
# Python
cd folder-project
python -m http.server 8080

# atau Node
npx serve .
```

4. Buka `http://localhost:8080` di browser.

Pastikan file `assets/logo.png` ikut ter-serve agar logo tidak hilang.

---

## Deploy ke Firebase Hosting

### Persyaratan
- Akun Google + project Firebase (default di repo: `tata-arsip-digital`)
- Node.js + Firebase CLI

```bash
npm install -g firebase-tools
firebase login
cd folder-project
firebase deploy --only hosting
```

URL default: `https://tata-arsip-digital.web.app`

### Custom domain / nama pendek
- Project ID **tidak bisa diubah**. Untuk URL pendek (`tata.web.app`), buat project baru dengan ID yang tersedia, lalu update `.firebaserc` + `js/firebase-config.js`.
- Atau pasang **Custom Domain** di Firebase Console → Hosting.

### Deploy dari HP (Termux)

```bash
pkg install nodejs-lts unzip
npm install -g firebase-tools
# extract project, lalu:
cd path/ke/project
firebase login
firebase deploy --only hosting
```

---

## Konfigurasi Firebase di kode

Edit `js/firebase-config.js` jika pindah project:

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
  measurementId: "..."
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const dbFirestore = firebase.firestore();
const storage = firebase.storage();
```

Nilai ini diambil dari Firebase Console → Project settings → Your apps → Web app.

---

## Alur penggunaan (ringkas)

1. **Register** → email verifikasi dikirim → (opsional) klik link di inbox/Spam.
2. **Login** → masuk dashboard.
3. Buat **folder**, **unggah arsip**, atur filter/sort.
4. File terhapus masuk **Sampah** (bisa dipulihkan atau dihapus permanen).
5. Ganti bahasa lewat ikon globe (ID / EN / MS / JA / AR).
6. Data metadata disinkronkan ke Firestore; file besar ke Storage + cache lokal IndexedDB.

---

## Routing (URL hash)

| Hash | Tampilan |
|------|----------|
| `#/dashboard` | Dashboard + rak folder |
| `#/all` | Semua arsip |
| `#/folders` | Kelola folder |
| `#/trash` | Sampah |
| `#/folder/Nama%20Folder` | Isi folder tertentu |

Tombol **Back / Forward** browser mengikuti riwayat halaman di dalam app.

---

## Teknologi

- **UI:** HTML5, CSS3 (Grid/Flex), Font Awesome 6, Google Fonts (Inter)
- **Logic:** JavaScript ES6+ (tanpa framework)
- **Auth & DB:** Firebase compat SDK 10.14
- **Lokal:** `localStorage`, IndexedDB
- **i18n:** objek terjemahan di `app.js` (`i18n` + `applyLang()`)

---

## Lisensi & kredit

© 2026 Arsip Digital (Tata).  
Silakan fork dan sesuaikan untuk kebutuhan internal. Pastikan mematuhi [Firebase Terms](https://firebase.google.com/terms) dan aturan privasi data pengguna Anda.
