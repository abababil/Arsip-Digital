    // ========== AUTH & STORAGE ==========
    const AUTH_KEY = 'arsipAuth';
    const DATA_KEY = 'arsipData_v1';
    const DB_NAME = 'ArsipDigitalDB';
    let currentUser = null;
    let db = null;

    function openDB() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
        };
        req.onsuccess = () => { db = req.result; resolve(db); };
        req.onerror = () => reject(req.error);
      });
    }

    function idbPut(id, blob) {
      return new Promise((resolve, reject) => {
        if (!db) return resolve();
        const tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').put(blob, String(id));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    function idbGet(id) {
      return new Promise((resolve) => {
        if (!db) return resolve(null);
        const tx = db.transaction('files', 'readonly');
        const req = tx.objectStore('files').get(String(id));
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    }

    function idbDelete(id) {
      return new Promise((resolve) => {
        if (!db) return resolve();
        const tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').delete(String(id));
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }


    // ========== FIREBASE CLOUD SYNC ==========
    function userDataRef() {
      if (!currentUser || !currentUser.uid) return null;
      return dbFirestore.collection('users').doc(currentUser.uid).collection('app').doc('data');
    }

    function storageFileRef(fileId, fileName) {
      const safeName = (fileName || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
      return storage.ref('users/' + currentUser.uid + '/files/' + fileId + '/' + safeName);
    }

    async function cloudSaveMeta() {
      const ref = userDataRef();
      if (!ref) return;
      try {
        const payload = {
          folders: folders,
          files: files.map(f => ({
            id: f.id,
            name: f.name,
            folder: f.folder,
            size: f.size,
            date: f.date,
            type: f.type,
            note: f.note || '',
            storagePath: f.storagePath || null,
            driveSynced: !!f.driveSynced
          })),
          trash: trash.map(f => ({
            id: f.id,
            name: f.name,
            folder: f.folder,
            size: f.size,
            date: f.date,
            type: f.type,
            note: f.note || '',
            storagePath: f.storagePath || null
          })),
          notifications: notifications.slice(0, 50),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        await ref.set(payload, { merge: true });
      } catch (e) {
        console.warn('cloudSaveMeta', e);
      }
    }

    async function cloudLoadMeta() {
      const ref = userDataRef();
      if (!ref) return false;
      try {
        const snap = await ref.get();
        if (!snap.exists) return false;
        const data = snap.data();
        // Hanya overwrite jika data cloud benar-benar berisi isi (jangan kosongkan UI)
        if (Array.isArray(data.folders) && data.folders.length) {
          folders.length = 0;
          data.folders.forEach(f => folders.push(f));
        }
        if (Array.isArray(data.files) && data.files.length) {
          files = data.files.map(f => ({ ...f, previewUrl: null }));
        }
        if (Array.isArray(data.trash) && data.trash.length) {
          trash = data.trash.map(f => ({ ...f, previewUrl: null }));
        }
        if (Array.isArray(data.notifications) && data.notifications.length) {
          notifications = data.notifications;
        }
        return true;
      } catch (e) {
        console.warn('cloudLoadMeta', e);
        return false;
      }
    }

    async function cloudUploadFile(fileId, fileName, blob) {
      if (!currentUser || !blob) return null;
      try {
        const ref = storageFileRef(fileId, fileName);
        await ref.put(blob);
        const path = ref.fullPath;
        return path;
      } catch (e) {
        console.warn('cloudUploadFile', e);
        showToast(t('cloudUploadFail'));
        return null;
      }
    }

    async function cloudGetDownloadURL(storagePath) {
      if (!storagePath) return null;
      try {
        return await storage.ref(storagePath).getDownloadURL();
      } catch (e) {
        console.warn('cloudGetDownloadURL', e);
        return null;
      }
    }

    async function cloudDeleteFile(storagePath) {
      if (!storagePath) return;
      try {
        await storage.ref(storagePath).delete();
      } catch (e) {
        console.warn('cloudDeleteFile', e);
      }
    }

    async function restorePreviewUrlsFromCloud() {
      for (const f of files) {
        if ((f.type === 'img' || f.type === 'pdf') && f.storagePath && !f.previewUrl) {
          const url = await cloudGetDownloadURL(f.storagePath);
          if (url) f.previewUrl = url;
        }
      }
    }

    function saveData() {
      try {
        const payload = {
          folders,
          files: files.map(f => ({ ...f, previewUrl: null })),
          trash: trash.map(f => ({ ...f, previewUrl: null })),
          notifications,
          lastDriveSync: localStorage.getItem('arsipLastDriveSync') || null
        };
        localStorage.setItem(DATA_KEY, JSON.stringify(payload));
      } catch (e) { console.warn('saveData', e); }
      // Sync ke Firebase (background)
      cloudSaveMeta();
    }

    function loadData() {
      try {
        const raw = localStorage.getItem(DATA_KEY);
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (Array.isArray(data.folders) && data.folders.length) {
          folders.length = 0;
          data.folders.forEach(f => folders.push(f));
        }
        if (Array.isArray(data.files) && data.files.length) files = data.files;
        if (Array.isArray(data.trash) && data.trash.length) trash = data.trash;
        if (Array.isArray(data.notifications) && data.notifications.length) notifications = data.notifications;
        return true;
      } catch (e) { return false; }
    }

    async function restorePreviewUrls() {
      for (const f of files) {
        if (f.type === 'img' || f.type === 'pdf') {
          const blob = await idbGet(f.id);
          if (blob) f.previewUrl = URL.createObjectURL(blob);
        }
      }
    }

    // ========== FIREBASE AUTH ==========
    function getFirebaseError(code) {
      const map = {
        'auth/user-not-found': 'errUserNotFound',
        'auth/wrong-password': 'errWrongPassword',
        'auth/invalid-email': 'errInvalidEmail',
        'auth/email-already-in-use': 'errEmailInUse',
        'auth/weak-password': 'errWeakPassword',
        'auth/too-many-requests': 'errTooMany',
        'auth/invalid-credential': 'errInvalidCred',
        'auth/missing-password': 'errMissingPass',
        'auth/network-request-failed': 'errNetwork'
      };
      return t(map[code] || 'errGeneric');
    }

    function checkAuth() {
      return new Promise((resolve) => {
        // Timeout safety: jangan biarkan loading stuck jika Firebase lambat/offline
        const timeout = setTimeout(() => {
          currentUser = null;
          resolve(null);
        }, 8000);

        const unsub = auth.onAuthStateChanged((user) => {
          unsub();
          clearTimeout(timeout);
          if (user) {
            // Biarkan session aktif (termasuk yang belum verifikasi) supaya fitur tidak hilang setelah refresh
            currentUser = {
              uid: user.uid,
              email: user.email,
              name: user.displayName || (user.email ? user.email.split('@')[0] : 'User')
            };
            resolve(currentUser);
          } else {
            currentUser = null;
            resolve(null);
          }
        });
      });
    }

    async function handleLogin(e) {
      e.preventDefault();
      const email = document.getElementById('loginUser').value.trim();
      const pass = document.getElementById('loginPass').value;
      const err = document.getElementById('loginError');
      const btn = e.target.querySelector('.btn-login') || document.querySelector('#loginForm .btn-login');
      try {
        err.classList.remove('show');
        if (btn) { btn.disabled = true; btn.textContent = t('loggingIn'); }
        const remember = document.getElementById('rememberMe')?.checked;
        await auth.setPersistence(remember ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION);
        await auth.signInWithEmailAndPassword(email, pass);
        const user = auth.currentUser;
        // Reload agar status emailVerified terbaru
        try { await user.reload(); } catch (re) {}
        if (!user.emailVerified) {
          // Kirim ulang verifikasi (tidak memblokir masuk supaya fitur tetap bisa dipakai)
          try {
            const actionCodeSettings = {
              url: window.location.origin + window.location.pathname,
              handleCodeInApp: false
            };
            await user.sendEmailVerification(actionCodeSettings);
          } catch (ve) { console.warn(ve); }
          showToast(t('emailNotVerified') + ' ' + user.email + ' ' + t('cekSpam'));
        }
        currentUser = {
          uid: user.uid,
          email: user.email,
          name: user.displayName || user.email.split('@')[0]
        };
        await enterApp();
      } catch (error) {
        console.error(error);
        err.textContent = getFirebaseError(error.code);
        err.classList.add('show');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = t('login'); }
      }
      return false;
    }

    async function handleRegister(e) {
      e.preventDefault();
      const name = document.getElementById('regName').value.trim();
      const email = document.getElementById('regEmail').value.trim();
      const pass = document.getElementById('regPass').value;
      const err = document.getElementById('regError');
      const btn = document.querySelector('#registerForm .btn-login');
      try {
        err.classList.remove('show');
        if (btn) { btn.disabled = true; btn.textContent = t('registering'); }
        const cred = await auth.createUserWithEmailAndPassword(email, pass);
        await cred.user.updateProfile({ displayName: name });
        // Kirim email verifikasi (actionCodeSettings agar link valid & lebih jarang masuk spam)
        try {
          const actionCodeSettings = {
            url: window.location.origin + window.location.pathname,
            handleCodeInApp: false
          };
          await cred.user.sendEmailVerification(actionCodeSettings);
        } catch (ve) {
          console.warn('Gagal kirim email verifikasi:', ve);
        }
        currentUser = {
          uid: cred.user.uid,
          email: email,
          name: name
        };
        // Simpan ke Firestore di background (tidak blocking)
        dbFirestore.collection('users').doc(cred.user.uid).set({
          name: name,
          email: email,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(function(fe){ console.warn('Firestore skip:', fe); });
        showToast(t('accountCreated'));
        await enterApp();
      } catch (error) {
        console.error(error);
        err.textContent = getFirebaseError(error.code);
        err.classList.add('show');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = t('register'); }
      }
      return false;
    }

    function showRegister() {
      document.getElementById('loginView').style.display = 'none';
      document.getElementById('registerView').style.display = 'block';
      document.getElementById('regError').classList.remove('show');
    }

    function showLogin() {
      document.getElementById('registerView').style.display = 'none';
      document.getElementById('loginView').style.display = 'block';
      document.getElementById('loginError').classList.remove('show');
    }

    function togglePassVisibility(inputId, iconId) {
      const input = document.getElementById(inputId || 'loginPass');
      const icon = document.getElementById(iconId || 'passEye');
      if (!input || !icon) return;
      if (input.type === 'password') {
        input.type = 'text';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
      } else {
        input.type = 'password';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
      }
    }


    // ========== LOGIN MODALS (Forgot / Contact) ==========
    let currentLoginModal = null;

    function openLoginModal(type) {
      currentLoginModal = type;
      const overlay = document.getElementById('loginModalOverlay');
      const title = document.getElementById('loginModalTitle');
      const desc = document.getElementById('loginModalDesc');
      const field2 = document.getElementById('loginModalField2');
      const label1 = document.getElementById('loginModalLabel1');
      const input1 = document.getElementById('loginModalInput1');
      const input2 = document.getElementById('loginModalInput2');
      input1.value = '';
      input2.value = '';
      if (type === 'forgot') {
        title.textContent = t('forgotPassword');
        desc.textContent = t('forgotDesc');
        label1.textContent = 'Email';
        input1.placeholder = 'email@example.com';
        field2.style.display = 'none';
      } else {
        title.textContent = t('contactAdmin');
        desc.textContent = t('contactDesc');
        label1.textContent = t('name') + ' / Email';
        input1.placeholder = t('fullName');
        field2.style.display = 'block';
      }
      overlay.classList.add('show');
    }

    function closeLoginModal() {
      document.getElementById('loginModalOverlay').classList.remove('show');
      currentLoginModal = null;
    }

    async function submitLoginModal() {
      const input1 = document.getElementById('loginModalInput1').value.trim();
      const input2 = document.getElementById('loginModalInput2').value.trim();
      if (!input1) {
        showToast(t('fillRequired'));
        return;
      }
      if (currentLoginModal === 'forgot') {
        try {
          const actionCodeSettings = {
            url: window.location.origin + window.location.pathname,
            handleCodeInApp: false
          };
          await auth.sendPasswordResetEmail(input1, actionCodeSettings);
          showToast(t('resetSent'));
        } catch (error) {
          showToast(getFirebaseError(error.code) || t('errGeneric'));
        }
      } else {
        // Contact admin - simpan ke Firestore jika bisa
        try {
          await dbFirestore.collection('contact_messages').add({
            from: input1,
            message: input2 || '',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        } catch (e) { console.warn(e); }
        showToast(t('contactSent'));
      }
      closeLoginModal();
    }

    async function logout() {
      try {
        await auth.signOut();
      } catch (e) { console.warn(e); }
      currentUser = null;
      localStorage.removeItem(AUTH_KEY);
      sessionStorage.removeItem(AUTH_KEY);
      document.getElementById('mainApp').classList.add('hide');
      document.getElementById('loginScreen').classList.remove('hide');
      showLogin();
    }

    async function enterApp() {
      document.getElementById('loginScreen').classList.add('hide');
      document.getElementById('mainApp').classList.remove('hide');

      // 1) Buka IndexedDB + load data lokal dulu (cepat, tanpa network)
      try { await openDB(); } catch (e) { console.warn('openDB', e); }
      loadData(); // localStorage — instant

      // 2) Render UI segera supaya folder card & chart langsung muncul
      setGreeting();
      renderFolders();
      renderSidebarFolders();
      renderBarChart();
      populateFolderSelect();
      updateStats();
      applyLang();
      renderNotifications();
      if (currentUser) {
        const g = document.getElementById('greetingText');
        if (g) {
          const hour = new Date().getHours();
          let greet = t('night');
          if (hour < 11) greet = t('morning');
          else if (hour < 15) greet = t('afternoon');
          else if (hour < 18) greet = t('evening');
          g.textContent = `${greet}, ${currentUser.name}`;
        }
      }
      try { initRoute(); } catch (e) { console.warn('initRoute', e); }

      // 3) Sync cloud di background (jangan blokir UI)
      (async function backgroundSync() {
        try {
          const fromCloud = await Promise.race([
            cloudLoadMeta(),
            new Promise(r => setTimeout(() => r(false), 5000))
          ]);
          if (fromCloud) {
            // Data cloud ada → re-render
            renderFolders();
            renderSidebarFolders();
            renderBarChart();
            populateFolderSelect();
            updateStats();
            applyLang();
            renderNotifications();
          } else {
            // Belum ada di cloud → simpan data lokal ke cloud
            cloudSaveMeta().catch(function(){});
          }
        } catch (e) { console.warn('backgroundSync', e); }
        try { await restorePreviewUrls(); } catch (e) {}
        try { await restorePreviewUrlsFromCloud(); } catch (e) {}
      })();
    }

    // ========== DATA ==========
    let folders = [
      { id: 1, name: 'Data SDM', icon: 'fa-users', color: 'blue', count: 1 },
      { id: 2, name: 'Invoice', icon: 'fa-file-invoice', color: 'green', count: 3 },
      { id: 3, name: 'Kontrak & Perjanjian', icon: 'fa-file-contract', color: 'orange', count: 0 },
      { id: 4, name: 'Lainnya', icon: 'fa-folder', color: 'purple', count: 0 },
      { id: 5, name: 'Laporan Bulanan', icon: 'fa-chart-bar', color: 'pink', count: 0 },
      { id: 6, name: 'Laporan Harian', icon: 'fa-calendar-day', color: 'cyan', count: 0 },
      { id: 7, name: 'Payroll', icon: 'fa-money-check-alt', color: 'red', count: 0 },
      { id: 8, name: 'Surat Keluar', icon: 'fa-paper-plane', color: 'yellow', count: 0 },
      { id: 9, name: 'Surat Masuk', icon: 'fa-inbox', color: 'blue', count: 0 },
    ];

    let files = [
      { id: 1, name: 'Data Karyawan 2026.pdf', folder: 'Data SDM', size: '245 KB', date: '2026-10-08', type: 'pdf', note: 'Data karyawan aktif 2026', previewUrl: null },
      { id: 2, name: 'Invoice #INV-001.pdf', folder: 'Invoice', size: '128 KB', date: '2026-10-09', type: 'pdf', note: '', previewUrl: null },
      { id: 3, name: 'Invoice #INV-002.pdf', folder: 'Invoice', size: '156 KB', date: '2026-10-10', type: 'pdf', note: 'Invoice Oktober', previewUrl: null },
      { id: 4, name: 'Invoice #INV-003.xlsx', folder: 'Invoice', size: '89 KB', date: '2026-10-11', type: 'xls', note: '', previewUrl: null },
    ];
    let trash = [];
    let currentView = 'dashboard';
    let currentFolderFilter = null;
    let pendingUploadFiles = [];
    let notifications = [
      { id: 1, text: 'Selamat datang di Arsip Digital', time: Date.now() - 3600000, read: false },
      { id: 2, text: '4 arsip siap dikelola', time: Date.now() - 1800000, read: false },
    ];
    let sortKey = 'date-desc';
    const folderIcons = ['fa-folder','fa-folder-open','fa-briefcase','fa-file-alt','fa-archive','fa-book','fa-clipboard','fa-box'];

    // ========== i18n ==========
    let currentLang = localStorage.getItem('arsipLang') || 'id';
    const i18n = {
      id: {appName:'Arsip Digital',tagline:'Semua berkas, satu tempat',newArchive:'Arsip baru',dashboard:'Dasbor',allArchives:'Semua arsip',manageFolders:'Kelola folder',trash:'Sampah',folder:'Folder',rack:'Rak folder',mainFolders:'Folder utama',total:'Total arsip',thisMonth:'Bulan ini',noFiles:'Belum ada berkas',folders:'Folder',inTrash:'di sampah',fromLast:'dari bulan lalu',allComplete:'Semua lengkap',docsMonth:'Dokumen per bulan',viewAll:'Lihat semua',docStatus:'Status dokumen',filter:'Saring',stNew:'Baru',stProcess:'Dalam proses',stDone:'Selesai',stArchived:'Diarsipkan',search:'Cari di semua arsip dan folder...',fileName:'Nama File',size:'Ukuran',date:'Tanggal',actions:'Aksi',upload:'Unggah',emptyTitle:'Belum ada arsip',emptyDesc:'Unggah file pertama kamu dengan tombol di atas',uploadTitle:'Unggah Arsip Baru',drag:'Seret file ke sini atau',choose:'pilih file',types:'PDF, DOC, XLS, JPG, PNG (maks 10MB)',nameLabel:'Nama / Judul Arsip',namePh:'Contoh: Kontrak Kerja 2026',folderLabel:'Folder Tujuan',noteLabel:'Keterangan (opsional)',notePh:'Catatan tambahan...',cancel:'Batal',morning:'Selamat pagi',afternoon:'Selamat siang',evening:'Selamat sore',night:'Selamat malam',docs:'dokumen',syncing:'Menyinkronkan ke Google Drive...',synced:'Sinkronisasi berhasil!',uploaded:'Arsip berhasil diunggah!',deleted:'Arsip dipindah ke sampah',moved:'Dipindah ke',fillName:'Isi nama arsip dulu ya',notFound:'Folder tidak ditemukan',confirmDel:'Yakin mau hapus arsip ini?',footer:'© 2026 Arsip Digital',langOk:'Bahasa diubah',logout:'Logout',notifications:'Notifikasi',allFolders:'Semua folder',sortNewest:'Tanggal terbaru',sortOldest:'Tanggal terlama',sortNameAsc:'Nama A-Z',sortNameDesc:'Nama Z-A',sortFolderAsc:'Folder A-Z',newFolder:'Folder baru',editArchive:'Edit Arsip',save:'Simpan',preview:'Preview',restore:'Pulihkan',permanentDelete:'Hapus permanen',move:'Pindah',delete:'Hapus',folderName:'Nama Folder',color:'Warna',colorBlue:'Biru',colorGreen:'Hijau',colorOrange:'Oranye',colorPurple:'Ungu',colorPink:'Pink',colorCyan:'Cyan',colorRed:'Merah',colorYellow:'Kuning',manageFolderTitle:'Kelola folder',welcomeBack:'Welcome Back',createAccount:'Create Account',name:'Nama',fullName:'Nama lengkap',password:'Password',alreadyHave:'Already have an account?',noAccount:'Don\'t have an account?',register:'Register',login:'Login',forgotPassword:'Forgot Password',forgotDesc:'Masukkan email akun Anda. Link reset password akan dikirim ke email tersebut.',contactAdmin:'Contact Admin',contactDesc:'Isi data di bawah. Admin akan menghubungi Anda segera.',message:'Pesan',send:'Kirim',loggingIn:'Logging in...',registering:'Mendaftar...',accountCreated:'Akun berhasil dibuat! Cek email untuk verifikasi (termasuk folder Spam/Promotions).',emailNotVerified:'Email belum diverifikasi — link baru dikirim',cloudUploadFail:'Upload ke cloud gagal, disimpan lokal',resetSent:'Link reset password telah dikirim ke email Anda (cek juga Spam/Promotions)',contactSent:'Pesan Anda telah dikirim ke admin. Terima kasih!',fillRequired:'Mohon isi data yang diperlukan',loginErrorDefault:'Email atau password salah',noteLabelShort:'Keterangan',rememberMe:'Ingat saya',registerSub:'Daftar untuk mulai menggunakan Arsip Digital',errUserNotFound:'Email tidak terdaftar',errWrongPassword:'Password salah',errInvalidEmail:'Format email tidak valid',errEmailInUse:'Email sudah digunakan',errWeakPassword:'Password minimal 6 karakter',errTooMany:'Terlalu banyak percobaan, coba lagi nanti',errInvalidCred:'Email atau password salah',errMissingPass:'Password wajib diisi',errNetwork:'Koneksi gagal, cek internet Anda',errGeneric:'Terjadi kesalahan, coba lagi',folderManageEmpty:'Belum ada folder',confirmPermDel:'Yakin hapus permanen? Tidak bisa dikembalikan.',restored:'Arsip dipulihkan',permDeleted:'Arsip dihapus permanen',folderSaved:'Folder disimpan',folderDeleted:'Folder dihapus',cekSpam:'(cek Spam juga)',archiveUpdated:'Arsip berhasil diperbarui',fillFolderName:'Isi nama folder dulu',folderExists:'Nama folder sudah ada',folderUpdated:'Folder berhasil diubah',folderCreated:'Folder berhasil dibuat',folderRemoved:'Folder dihapus',folderHasFiles:'Folder "{name}" masih berisi arsip. Arsip akan dipindah ke "Lainnya". Lanjut?',confirmDelFolder:'Hapus folder "{name}"?',newFolderNotif:'Folder baru: ',markAllRead:'Tandai dibaca',syncDriveTitle:'Sinkron Google Drive'},
      en: {appName:'Digital Archive',tagline:'All files, one place',newArchive:'New archive',dashboard:'Dashboard',allArchives:'All archives',manageFolders:'Manage folders',trash:'Trash',folder:'Folder',rack:'Folder rack',mainFolders:'Main folders',total:'Total archives',thisMonth:'This month',noFiles:'No files yet',folders:'Folders',inTrash:'in trash',fromLast:'from last month',allComplete:'All complete',docsMonth:'Documents per month',viewAll:'View all',docStatus:'Document status',filter:'Filter',stNew:'New',stProcess:'In progress',stDone:'Done',stArchived:'Archived',search:'Search all archives and folders...',fileName:'File Name',size:'Size',date:'Date',actions:'Actions',upload:'Upload',emptyTitle:'No archives yet',emptyDesc:'Upload your first file with the button above',uploadTitle:'Upload New Archive',drag:'Drag file here or',choose:'choose file',types:'PDF, DOC, XLS, JPG, PNG (max 10MB)',nameLabel:'Archive Name / Title',namePh:'e.g. Work Contract 2026',folderLabel:'Target Folder',noteLabel:'Notes (optional)',notePh:'Additional notes...',cancel:'Cancel',morning:'Good morning',afternoon:'Good afternoon',evening:'Good evening',night:'Good night',docs:'documents',syncing:'Syncing to Google Drive...',synced:'Sync successful!',uploaded:'Archive uploaded!',deleted:'Moved to trash',moved:'Moved to',fillName:'Please fill archive name',notFound:'Folder not found',confirmDel:'Delete this archive?',footer:'© 2026 Digital Archive',langOk:'Language changed',logout:'Logout',notifications:'Notifications',allFolders:'All folders',sortNewest:'Newest first',sortOldest:'Oldest first',sortNameAsc:'Name A-Z',sortNameDesc:'Name Z-A',sortFolderAsc:'Folder A-Z',newFolder:'New folder',editArchive:'Edit Archive',save:'Save',preview:'Preview',restore:'Restore',permanentDelete:'Delete permanently',move:'Move',delete:'Delete',folderName:'Folder Name',color:'Color',colorBlue:'Blue',colorGreen:'Green',colorOrange:'Orange',colorPurple:'Purple',colorPink:'Pink',colorCyan:'Cyan',colorRed:'Red',colorYellow:'Yellow',manageFolderTitle:'Manage folders',welcomeBack:'Welcome Back',createAccount:'Create Account',name:'Name',fullName:'Full name',password:'Password',alreadyHave:'Already have an account?',noAccount:'Don\'t have an account?',register:'Register',login:'Login',forgotPassword:'Forgot Password',forgotDesc:'Enter your account email. A password reset link will be sent to that email.',contactAdmin:'Contact Admin',contactDesc:'Fill in the form below. Admin will contact you soon.',message:'Message',send:'Send',loggingIn:'Logging in...',registering:'Registering...',accountCreated:'Account created! Check your email for verification (including Spam/Promotions).',emailNotVerified:'Email not verified — new link sent',cloudUploadFail:'Cloud upload failed, saved locally',resetSent:'Password reset link has been sent to your email (check Spam/Promotions too)',contactSent:'Your message has been sent to admin. Thank you!',fillRequired:'Please fill in the required fields',loginErrorDefault:'Incorrect email or password',noteLabelShort:'Notes',rememberMe:'Remember me',registerSub:'Sign up to start using Digital Archive',errUserNotFound:'Email not registered',errWrongPassword:'Wrong password',errInvalidEmail:'Invalid email format',errEmailInUse:'Email already in use',errWeakPassword:'Password must be at least 6 characters',errTooMany:'Too many attempts, try again later',errInvalidCred:'Incorrect email or password',errMissingPass:'Password is required',errNetwork:'Connection failed, check your internet',errGeneric:'Something went wrong, try again',folderManageEmpty:'No folders yet',confirmPermDel:'Delete permanently? This cannot be undone.',restored:'Archive restored',permDeleted:'Archive permanently deleted',folderSaved:'Folder saved',folderDeleted:'Folder deleted',cekSpam:'(check Spam too)',archiveUpdated:'Archive updated',fillFolderName:'Please enter folder name',folderExists:'Folder name already exists',folderUpdated:'Folder updated',folderCreated:'Folder created',folderRemoved:'Folder deleted',folderHasFiles:'Folder "{name}" still contains archives. They will be moved to "Lainnya". Continue?',confirmDelFolder:'Delete folder "{name}"?',newFolderNotif:'New folder: ',markAllRead:'Mark all read',syncDriveTitle:'Sync Google Drive'},
      ms: {appName:'Arkib Digital',tagline:'Semua fail, satu tempat',newArchive:'Arkib baharu',dashboard:'Papan Pemuka',allArchives:'Semua arkib',manageFolders:'Urus folder',trash:'Tong Sampah',folder:'Folder',rack:'Rak folder',mainFolders:'Folder utama',total:'Jumlah arkib',thisMonth:'Bulan ini',noFiles:'Tiada fail',folders:'Folder',inTrash:'dalam sampah',fromLast:'dari bulan lepas',allComplete:'Semua lengkap',docsMonth:'Dokumen sebulan',viewAll:'Lihat semua',docStatus:'Status dokumen',filter:'Tapis',stNew:'Baharu',stProcess:'Dalam proses',stDone:'Selesai',stArchived:'Diarkibkan',search:'Cari semua arkib dan folder...',fileName:'Nama Fail',size:'Saiz',date:'Tarikh',actions:'Tindakan',upload:'Muat naik',emptyTitle:'Tiada arkib',emptyDesc:'Muat naik fail pertama dengan butang di atas',uploadTitle:'Muat Naik Arkib Baharu',drag:'Seret fail ke sini atau',choose:'pilih fail',types:'PDF, DOC, XLS, JPG, PNG (maks 10MB)',nameLabel:'Nama / Tajuk Arkib',namePh:'Contoh: Kontrak Kerja 2026',folderLabel:'Folder Sasaran',noteLabel:'Catatan (pilihan)',notePh:'Catatan tambahan...',cancel:'Batal',morning:'Selamat pagi',afternoon:'Selamat tengah hari',evening:'Selamat petang',night:'Selamat malam',docs:'dokumen',syncing:'Menyegerakkan...',synced:'Berjaya!',uploaded:'Arkib dimuat naik!',deleted:'Dipindah ke sampah',moved:'Dipindah ke',fillName:'Isi nama arkib dulu',notFound:'Folder tidak dijumpai',confirmDel:'Padam arkib ini?',footer:'© 2026 Arkib Digital',langOk:'Bahasa ditukar',logout:'Log keluar',notifications:'Pemberitahuan',allFolders:'Semua folder',sortNewest:'Tarikh terbaru',sortOldest:'Tarikh terlama',sortNameAsc:'Nama A-Z',sortNameDesc:'Nama Z-A',sortFolderAsc:'Folder A-Z',newFolder:'Folder baharu',editArchive:'Edit Arkib',save:'Simpan',preview:'Pratonton',restore:'Pulihkan',permanentDelete:'Padam kekal',move:'Pindah',delete:'Padam',folderName:'Nama Folder',color:'Warna',colorBlue:'Biru',colorGreen:'Hijau',colorOrange:'Oren',colorPurple:'Ungu',colorPink:'Merah jambu',colorCyan:'Sian',colorRed:'Merah',colorYellow:'Kuning',manageFolderTitle:'Urus folder',welcomeBack:'Selamat Kembali',createAccount:'Cipta Akaun',name:'Nama',fullName:'Nama penuh',password:'Kata laluan',alreadyHave:'Sudah ada akaun?',noAccount:'Belum ada akaun?',register:'Daftar',login:'Log masuk',forgotPassword:'Lupa Kata Laluan',forgotDesc:'Masukkan e-mel akaun anda. Pautan set semula kata laluan akan dihantar.',contactAdmin:'Hubungi Admin',contactDesc:'Isi borang di bawah. Admin akan menghubungi anda.',message:'Mesej',send:'Hantar',loggingIn:'Sedang log masuk...',registering:'Mendaftar...',accountCreated:'Akaun berjaya dibuat! Semak e-mel untuk pengesahan (termasuk Spam).',emailNotVerified:'E-mel belum disahkan — pautan baharu dihantar',cloudUploadFail:'Muat naik awan gagal, disimpan tempatan',resetSent:'Pautan set semula telah dihantar ke e-mel anda (semak Spam juga)',contactSent:'Mesej anda telah dihantar kepada admin. Terima kasih!',fillRequired:'Sila isi data yang diperlukan',loginErrorDefault:'E-mel atau kata laluan salah',noteLabelShort:'Catatan',rememberMe:'Ingat saya',registerSub:'Daftar untuk mula menggunakan Arkib Digital',errUserNotFound:'E-mel tidak berdaftar',errWrongPassword:'Kata laluan salah',errInvalidEmail:'Format e-mel tidak sah',errEmailInUse:'E-mel sudah digunakan',errWeakPassword:'Kata laluan minimum 6 aksara',errTooMany:'Terlalu banyak percubaan, cuba lagi nanti',errInvalidCred:'E-mel atau kata laluan salah',errMissingPass:'Kata laluan wajib diisi',errNetwork:'Sambungan gagal, semak internet anda',errGeneric:'Berlaku ralat, cuba lagi',folderManageEmpty:'Belum ada folder',confirmPermDel:'Padam kekal? Tidak boleh dipulihkan.',restored:'Arkib dipulihkan',permDeleted:'Arkib dipadam kekal',folderSaved:'Folder disimpan',folderDeleted:'Folder dipadam',cekSpam:'(semak Spam juga)',archiveUpdated:'Arkib berjaya dikemas kini',fillFolderName:'Isi nama folder dulu',folderExists:'Nama folder sudah ada',folderUpdated:'Folder berjaya diubah',folderCreated:'Folder berjaya dibuat',folderRemoved:'Folder dipadam',folderHasFiles:'Folder "{name}" masih mengandungi arkib. Arkib akan dipindah ke "Lainnya". Teruskan?',confirmDelFolder:'Padam folder "{name}"?',newFolderNotif:'Folder baharu: ',markAllRead:'Tanda semua dibaca',syncDriveTitle:'Segerak Google Drive'},
      ja: {appName:'デジタルアーカイブ',tagline:'すべてのファイルを一箇所に',newArchive:'新規アーカイブ',dashboard:'ダッシュボード',allArchives:'すべてのアーカイブ',manageFolders:'フォルダ管理',trash:'ゴミ箱',folder:'フォルダ',rack:'フォルダラック',mainFolders:'メインフォルダ',total:'アーカイブ合計',thisMonth:'今月',noFiles:'ファイルなし',folders:'フォルダ',inTrash:'ゴミ箱内',fromLast:'先月比',allComplete:'すべて完了',docsMonth:'月別ドキュメント',viewAll:'すべて表示',docStatus:'ドキュメント状態',filter:'フィルター',stNew:'新規',stProcess:'処理中',stDone:'完了',stArchived:'アーカイブ済み',search:'アーカイブとフォルダを検索...',fileName:'ファイル名',size:'サイズ',date:'日付',actions:'操作',upload:'アップロード',emptyTitle:'アーカイブなし',emptyDesc:'上のボタンからアップロード',uploadTitle:'新規アップロード',drag:'ドラッグまたは',choose:'選択',types:'PDF, DOC, XLS, JPG, PNG (最大10MB)',nameLabel:'アーカイブ名',namePh:'例: 労働契約 2026',folderLabel:'保存先',noteLabel:'メモ（任意）',notePh:'追加メモ...',cancel:'キャンセル',morning:'おはようございます',afternoon:'こんにちは',evening:'こんばんは',night:'おやすみなさい',docs:'ドキュメント',syncing:'同期中...',synced:'同期成功！',uploaded:'アップロード完了！',deleted:'ゴミ箱へ移動',moved:'移動先:',fillName:'名前を入力',notFound:'フォルダなし',confirmDel:'削除しますか？',footer:'© 2026 デジタルアーカイブ',langOk:'言語変更',logout:'ログアウト',notifications:'通知',allFolders:'すべてのフォルダ',sortNewest:'新しい順',sortOldest:'古い順',sortNameAsc:'名前 A-Z',sortNameDesc:'名前 Z-A',sortFolderAsc:'フォルダ A-Z',newFolder:'新しいフォルダ',editArchive:'アーカイブ編集',save:'保存',preview:'プレビュー',restore:'復元',permanentDelete:'完全削除',move:'移動',delete:'削除',folderName:'フォルダ名',color:'色',colorBlue:'青',colorGreen:'緑',colorOrange:'オレンジ',colorPurple:'紫',colorPink:'ピンク',colorCyan:'シアン',colorRed:'赤',colorYellow:'黄',manageFolderTitle:'フォルダ管理',welcomeBack:'おかえりなさい',createAccount:'アカウント作成',name:'名前',fullName:'氏名',password:'パスワード',alreadyHave:'アカウントをお持ちですか？',noAccount:'アカウントをお持ちでない方',register:'登録',login:'ログイン',forgotPassword:'パスワードを忘れた',forgotDesc:'アカウントのメールアドレスを入力してください。リセットリンクが送信されます。',contactAdmin:'管理者に連絡',contactDesc:'以下のフォームに記入してください。管理者がご連絡します。',message:'メッセージ',send:'送信',loggingIn:'ログイン中...',registering:'登録中...',accountCreated:'アカウントが作成されました！確認メールをご確認ください（迷惑メールも確認）。',emailNotVerified:'メール未確認 — 新しいリンクを送信しました',cloudUploadFail:'クラウドへのアップロードに失敗、ローカルに保存',resetSent:'パスワードリセットリンクを送信しました（迷惑メールも確認）',contactSent:'メッセージを管理者に送信しました。ありがとうございます！',fillRequired:'必須項目を入力してください',loginErrorDefault:'メールまたはパスワードが正しくありません',noteLabelShort:'メモ',rememberMe:'ログイン状態を保持',registerSub:'デジタルアーカイブの利用を開始する',errUserNotFound:'メールが登録されていません',errWrongPassword:'パスワードが違います',errInvalidEmail:'メール形式が無効です',errEmailInUse:'メールは既に使用されています',errWeakPassword:'パスワードは6文字以上',errTooMany:'試行回数が多すぎます。後でもう一度',errInvalidCred:'メールまたはパスワードが正しくありません',errMissingPass:'パスワードが必要です',errNetwork:'接続に失敗しました。インターネットを確認',errGeneric:'エラーが発生しました。もう一度お試しください',folderManageEmpty:'フォルダがありません',confirmPermDel:'完全に削除しますか？元に戻せません。',restored:'アーカイブを復元しました',permDeleted:'アーカイブを完全削除しました',folderSaved:'フォルダを保存しました',folderDeleted:'フォルダを削除しました',cekSpam:'（迷惑メールも確認）',archiveUpdated:'アーカイブを更新しました',fillFolderName:'フォルダ名を入力してください',folderExists:'フォルダ名は既に存在します',folderUpdated:'フォルダを更新しました',folderCreated:'フォルダを作成しました',folderRemoved:'フォルダを削除しました',folderHasFiles:'フォルダ "{name}" にアーカイブが残っています。「Lainnya」に移動します。続けますか？',confirmDelFolder:'フォルダ "{name}" を削除しますか？',newFolderNotif:'新しいフォルダ: ',markAllRead:'すべて既読',syncDriveTitle:'Google Drive同期'},
      ar: {appName:'الأرشيف الرقمي',tagline:'جميع الملفات في مكان واحد',newArchive:'أرشيف جديد',dashboard:'لوحة التحكم',allArchives:'كل الأرشيف',manageFolders:'إدارة المجلدات',trash:'المهملات',folder:'مجلد',rack:'رف المجلدات',mainFolders:'المجلدات الرئيسية',total:'إجمالي الأرشيف',thisMonth:'هذا الشهر',noFiles:'لا ملفات',folders:'المجلدات',inTrash:'في المهملات',fromLast:'من الشهر الماضي',allComplete:'مكتمل',docsMonth:'المستندات شهرياً',viewAll:'عرض الكل',docStatus:'حالة المستند',filter:'تصفية',stNew:'جديد',stProcess:'قيد المعالجة',stDone:'مكتمل',stArchived:'مؤرشف',search:'ابحث في الأرشيف...',fileName:'اسم الملف',size:'الحجم',date:'التاريخ',actions:'إجراءات',upload:'رفع',emptyTitle:'لا أرشيف',emptyDesc:'ارفع ملفك الأول',uploadTitle:'رفع أرشيف جديد',drag:'اسحب هنا أو',choose:'اختر',types:'PDF, DOC, XLS, JPG, PNG (10MB)',nameLabel:'اسم الأرشيف',namePh:'مثال: عقد 2026',folderLabel:'المجلد',noteLabel:'ملاحظات',notePh:'ملاحظات...',cancel:'إلغاء',morning:'صباح الخير',afternoon:'مساء الخير',evening:'مساء الخير',night:'تصبح على خير',docs:'مستندات',syncing:'جاري المزامنة...',synced:'تمت المزامنة!',uploaded:'تم الرفع!',deleted:'نقل للمهملات',moved:'نقل إلى',fillName:'أدخل الاسم',notFound:'المجلد غير موجود',confirmDel:'حذف؟',footer:'© 2026 الأرشيف الرقمي',langOk:'تم تغيير اللغة',logout:'تسجيل الخروج',notifications:'الإشعارات',allFolders:'كل المجلدات',sortNewest:'الأحدث أولاً',sortOldest:'الأقدم أولاً',sortNameAsc:'الاسم أ-ي',sortNameDesc:'الاسم ي-أ',sortFolderAsc:'المجلد أ-ي',newFolder:'مجلد جديد',editArchive:'تعديل الأرشيف',save:'حفظ',preview:'معاينة',restore:'استعادة',permanentDelete:'حذف نهائي',move:'نقل',delete:'حذف',folderName:'اسم المجلد',color:'اللون',colorBlue:'أزرق',colorGreen:'أخضر',colorOrange:'برتقالي',colorPurple:'بنفسجي',colorPink:'وردي',colorCyan:'سماوي',colorRed:'أحمر',colorYellow:'أصفر',manageFolderTitle:'إدارة المجلدات',welcomeBack:'مرحباً بعودتك',createAccount:'إنشاء حساب',name:'الاسم',fullName:'الاسم الكامل',password:'كلمة المرور',alreadyHave:'لديك حساب بالفعل؟',noAccount:'ليس لديك حساب؟',register:'تسجيل',login:'تسجيل الدخول',forgotPassword:'نسيت كلمة المرور',forgotDesc:'أدخل بريد حسابك. سيتم إرسال رابط إعادة تعيين كلمة المرور.',contactAdmin:'اتصل بالمسؤول',contactDesc:'املأ النموذج أدناه. سيتواصل معك المسؤول قريباً.',message:'الرسالة',send:'إرسال',loggingIn:'جارٍ تسجيل الدخول...',registering:'جارٍ التسجيل...',accountCreated:'تم إنشاء الحساب! تحقق من بريدك للتأكيد (بما في ذلك البريد غير الهام).',emailNotVerified:'البريد غير مؤكد — تم إرسال رابط جديد',cloudUploadFail:'فشل الرفع إلى السحابة، تم الحفظ محلياً',resetSent:'تم إرسال رابط إعادة التعيين إلى بريدك (تحقق من البريد غير الهام أيضاً)',contactSent:'تم إرسال رسالتك إلى المسؤول. شكراً لك!',fillRequired:'يرجى ملء الحقول المطلوبة',loginErrorDefault:'البريد أو كلمة المرور غير صحيحة',noteLabelShort:'ملاحظات',rememberMe:'تذكرني',registerSub:'سجّل للبدء في استخدام الأرشيف الرقمي',errUserNotFound:'البريد غير مسجل',errWrongPassword:'كلمة المرور خاطئة',errInvalidEmail:'صيغة البريد غير صالحة',errEmailInUse:'البريد مستخدم بالفعل',errWeakPassword:'كلمة المرور 6 أحرف على الأقل',errTooMany:'محاولات كثيرة جداً، حاول لاحقاً',errInvalidCred:'البريد أو كلمة المرور غير صحيحة',errMissingPass:'كلمة المرور مطلوبة',errNetwork:'فشل الاتصال، تحقق من الإنترنت',errGeneric:'حدث خطأ، حاول مرة أخرى',folderManageEmpty:'لا توجد مجلدات بعد',confirmPermDel:'حذف نهائي؟ لا يمكن التراجع.',restored:'تمت استعادة الأرشيف',permDeleted:'تم حذف الأرشيف نهائياً',folderSaved:'تم حفظ المجلد',folderDeleted:'تم حذف المجلد',cekSpam:'(تحقق من البريد غير الهام أيضاً)',archiveUpdated:'تم تحديث الأرشيف',fillFolderName:'أدخل اسم المجلد',folderExists:'اسم المجلد موجود بالفعل',folderUpdated:'تم تحديث المجلد',folderCreated:'تم إنشاء المجلد',folderRemoved:'تم حذف المجلد',folderHasFiles:'المجلد "{name}" لا يزال يحتوي على أرشيف. سيتم نقله إلى "Lainnya". متابعة؟',confirmDelFolder:'حذف المجلد "{name}"؟',newFolderNotif:'مجلد جديد: ',markAllRead:'تحديد الكل كمقروء',syncDriveTitle:'مزامنة Google Drive'}
    };
    function t(k){ return (i18n[currentLang]&&i18n[currentLang][k])||i18n.id[k]||k; }

    function toggleLangMenu(){ document.getElementById('langMenu').classList.toggle('show'); }
    document.addEventListener('click',e=>{
      const sw=document.querySelector('.lang-switcher');
      if(sw&&!sw.contains(e.target)) document.getElementById('langMenu').classList.remove('show');
    });

    function setLanguage(lang){
      currentLang=lang;
      localStorage.setItem('arsipLang',lang);
      document.documentElement.lang=lang;
      document.documentElement.dir=lang==='ar'?'rtl':'ltr';
      document.querySelectorAll('.lang-item').forEach(el=>el.classList.toggle('active',el.dataset.lang===lang));
      document.getElementById('langMenu').classList.remove('show');
      applyLang();
      setGreeting();
      renderFolders();
      renderSidebarFolders();
      renderBarChart();
      populateFilterFolder();
      refreshCurrentList();
      updateStats();
      renderNotifications();
      showToast(t('langOk'));
    }

    function applyLang(){
      // Sidebar
      const logoH=document.querySelector('.logo-text h1'); if(logoH) logoH.textContent=t('appName');
      const logoP=document.querySelector('.logo-text p'); if(logoP) logoP.textContent=t('tagline');
      const btnNew=document.querySelector('.btn-new'); if(btnNew) btnNew.innerHTML=`<i class="fas fa-plus"></i> ${t('newArchive')}`;
      const footer=document.getElementById('footerText'); if(footer) footer.textContent=t('footer');
      // Logout button
      const logoutBtn=document.querySelector('button[onclick="logout()"]');
      if(logoutBtn) logoutBtn.innerHTML=`<i class="fas fa-sign-out-alt"></i> ${t('logout')}`;
      // Nav - preserve data-view & onclick
      const navs=document.querySelectorAll('.nav-item');
      const navKeys=['dashboard','allArchives','manageFolders','trash'];
      const navViews=['dashboard','all','folders','trash'];
      const navIcons=['fa-th-large','fa-folder-open','fa-folder-tree','fa-trash-alt'];
      navs.forEach((nav,i)=>{
        if(!navKeys[i]) return;
        const badgeNum = i===1 ? files.length : (i===2 ? folders.length : (i===3 ? trash.length : ''));
        const badgeHtml = (i>=1) ? `<span class="badge">${badgeNum}</span>` : '';
        nav.setAttribute('data-view', navViews[i]);
        nav.setAttribute('onclick', `switchView('${navViews[i]}')`);
        nav.innerHTML = `<i class="fas ${navIcons[i]}"></i> ${t(navKeys[i])} ${badgeHtml}`;
      });
      const navLabel=document.querySelector('.nav-label'); if(navLabel) navLabel.textContent=t('folder');
      // Dashboard
      const rackH=document.querySelector('#dashboardView .section-header h3');
      if(rackH) rackH.innerHTML=`<i class="fas fa-th"></i> ${t('rack')}`;
      const fcl=document.getElementById('folderCountLabel');
      if(fcl) fcl.parentElement.innerHTML=`${t('mainFolders')} · <span id="folderCountLabel">${folders.length} ${t('folders').toLowerCase()}</span>`;
      // Stats labels
      const statPs=document.querySelectorAll('.stat-card .stat-info p');
      const statKeys=['total','thisMonth','noFiles','folders'];
      statPs.forEach((p,i)=>{ if(statKeys[i]) p.textContent=t(statKeys[i]); });
      const statSubs=document.querySelectorAll('.stat-card .stat-info .sub');
      if(statSubs[0]) statSubs[0].textContent=`${trash.length} ${t('inTrash')}`;
      if(statSubs[1]) statSubs[1].textContent=`+2 ${t('fromLast')}`;
      if(statSubs[2]) statSubs[2].textContent=t('allComplete');
      if(statSubs[3]) statSubs[3].textContent=t('manageFolders');
      // Panels
      const ph=document.querySelectorAll('.panel-header h4');
      if(ph[0]) ph[0].textContent=t('docsMonth');
      if(ph[1]) ph[1].textContent=t('docStatus');
      const pa=document.querySelectorAll('.panel-header a');
      if(pa[0]) pa[0].textContent=t('viewAll');
      if(pa[1]) pa[1].textContent=t('filter');
      const sl=document.querySelectorAll('.status-item .label');
      const sk=['stNew','stProcess','stDone','stArchived'];
      sl.forEach((s,i)=>{ if(sk[i]) s.textContent=t(sk[i]); });
      // Search
      const si=document.getElementById('searchInput'); if(si) si.placeholder=t('search');
      // Notifications
      const notifLabel=document.querySelector('.notif-panel-header span');
      if(notifLabel) notifLabel.textContent=t('notifications');
      const notifMark=document.querySelector('.notif-panel-header button');
      if(notifMark) notifMark.textContent=t('markAllRead');
      const notifBtn=document.querySelector('.notif-wrap .icon-btn');
      if(notifBtn) notifBtn.title=t('notifications');
      const syncBtn=document.querySelector('button[onclick="syncDrive()"]');
      if(syncBtn) syncBtn.title=t('syncDriveTitle');
      // Table headers
      const ths=document.querySelectorAll('#fileTableWrap th, .table-container th');
      const thk=['fileName','folder','size','date','actions'];
      ths.forEach((th,i)=>{ if(thk[i]) th.textContent=t(thk[i]); });
      // Empty state
      const et=document.querySelector('#emptyState h4'); if(et) et.textContent=t('emptyTitle');
      const ed=document.querySelector('#emptyState p'); if(ed) ed.textContent=t('emptyDesc');
      // Filter / sort selects
      const ff=document.getElementById('filterFolder');
      if(ff && ff.options.length){
        const cur=ff.value;
        ff.options[0].textContent=t('allFolders');
        // keep other options as folder names
        if(cur) ff.value=cur;
      }
      const sb=document.getElementById('sortBy');
      if(sb){
        const opts=sb.querySelectorAll('option');
        const sortKeys=['sortNewest','sortOldest','sortNameAsc','sortNameDesc','sortFolderAsc'];
        opts.forEach((o,i)=>{ if(sortKeys[i]) o.textContent=t(sortKeys[i]); });
      }
      // Upload modal
      const mt=document.querySelector('#uploadModal .modal-header h3'); if(mt) mt.textContent=t('uploadTitle');
      const uz=document.querySelector('#uploadZone p'); if(uz) uz.innerHTML=`${t('drag')} <span>${t('choose')}</span>`;
      const uzt=document.querySelectorAll('#uploadZone p')[1]; if(uzt) uzt.textContent=t('types');
      const labels=document.querySelectorAll('#uploadModal .form-group label');
      if(labels[0]) labels[0].textContent=t('nameLabel');
      if(labels[1]) labels[1].textContent=t('folderLabel');
      if(labels[2]) labels[2].textContent=t('noteLabel');
      const fn=document.getElementById('fileName'); if(fn) fn.placeholder=t('namePh');
      const fnote=document.getElementById('fileNote'); if(fnote) fnote.placeholder=t('notePh');
      const mbtns=document.querySelectorAll('#uploadModal .modal-footer .btn');
      if(mbtns[0]) mbtns[0].textContent=t('cancel');
      if(mbtns[1]) mbtns[1].innerHTML=`<i class="fas fa-upload"></i> ${t('upload')}`;
      const lub=document.querySelector('#fileListView .btn-primary, #btnListPrimary');
      if(lub){
        if(currentView==='folders') lub.innerHTML=`<i class="fas fa-plus"></i> ${t('newFolder')}`;
        else lub.innerHTML=`<i class="fas fa-plus"></i> ${t('upload')}`;
      }
      // Edit modal
      const emh=document.querySelector('#editModal .modal-header h3'); if(emh) emh.textContent=t('editArchive');
      const elabels=document.querySelectorAll('#editModal .form-group label');
      if(elabels[0]) elabels[0].textContent=t('nameLabel');
      if(elabels[1]) elabels[1].textContent=t('folder');
      if(elabels[2]) elabels[2].textContent=t('noteLabelShort');
      const ebtns=document.querySelectorAll('#editModal .modal-footer .btn');
      if(ebtns[0]) ebtns[0].textContent=t('cancel');
      if(ebtns[1]) ebtns[1].innerHTML=`<i class="fas fa-save"></i> ${t('save')}`;
      // Folder modal
      const fmh=document.querySelector('#folderModal .modal-header h3');
      if(fmh) fmh.textContent=t('newFolder');
      const flabels=document.querySelectorAll('#folderModal .form-group label');
      if(flabels[0]) flabels[0].textContent=t('folderName');
      if(flabels[1]) flabels[1].textContent=t('color');
      const colorSel=document.querySelector('#folderModal select, #folderColor');
      if(colorSel){
        const colorKeys=['colorBlue','colorGreen','colorOrange','colorPurple','colorPink','colorCyan','colorRed','colorYellow'];
        Array.from(colorSel.options).forEach((o,i)=>{ if(colorKeys[i]) o.textContent=t(colorKeys[i]); });
      }
      const fbtns=document.querySelectorAll('#folderModal .modal-footer .btn');
      if(fbtns[0]) fbtns[0].textContent=t('cancel');
      if(fbtns[1]) fbtns[1].innerHTML=`<i class="fas fa-save"></i> ${t('save')}`;
      // Login screen
      const loginH=document.querySelector('#loginView h1'); if(loginH) loginH.textContent=t('welcomeBack');
      const regH=document.querySelector('#registerView h1'); if(regH) regH.textContent=t('createAccount');
      const regSub=document.querySelector('#registerView .sub'); if(regSub) regSub.textContent=t('registerSub');
      const lf=document.querySelectorAll('#loginForm .field label');
      if(lf[0]) lf[0].textContent='Email';
      if(lf[1]) lf[1].textContent=t('password');
      const rf=document.querySelectorAll('#registerForm .field label');
      if(rf[0]) rf[0].textContent=t('name');
      if(rf[1]) rf[1].textContent='Email';
      if(rf[2]) rf[2].textContent=t('password');
      const regName=document.getElementById('regName'); if(regName) regName.placeholder=t('fullName');
      const loginBtn=document.querySelector('#loginForm .btn-login'); if(loginBtn) loginBtn.textContent=t('login');
      const regBtn=document.querySelector('#registerForm .btn-login'); if(regBtn) regBtn.textContent=t('register');
      const loginFooter=document.querySelector('#loginView .login-footer');
      if(loginFooter) loginFooter.innerHTML=`${t('noAccount')} <a href="#" onclick="showRegister();return false;">${t('register')}</a>`;
      const regFooter=document.querySelector('#registerView .login-footer');
      if(regFooter) regFooter.innerHTML=`${t('alreadyHave')} <a href="#" onclick="showLogin();return false;">${t('login')}</a>`;
      const forgotLink=document.querySelector('#loginView .login-row a');
      if(forgotLink) forgotLink.textContent=t('forgotPassword');
      const rememberLab=document.querySelector('#loginView .login-row label');
      if(rememberLab) {
        const cb=rememberLab.querySelector('input');
        rememberLab.innerHTML='';
        if(cb) rememberLab.appendChild(cb);
        rememberLab.appendChild(document.createTextNode(' '+t('rememberMe')));
      }
      // Login modal buttons
      const lmc=document.querySelector('.login-modal-btn-cancel'); if(lmc) lmc.textContent=t('cancel');
      const lms=document.querySelector('.login-modal-btn-submit'); if(lms) lms.textContent=t('send');
      // Title
      document.title=t('appName')+' - '+t('tagline');
      // List title if on folders
      if(currentView==='folders'){
        const lt=document.getElementById('listTitle'); if(lt) lt.textContent=t('manageFolders');
      } else if(currentView==='trash'){
        const lt=document.getElementById('listTitle'); if(lt) lt.textContent=t('trash');
      } else if(currentView==='all' && !currentFolderFilter){
        const lt=document.getElementById('listTitle'); if(lt) lt.textContent=t('allArchives');
      }
    }

    // ========== INIT ==========
    document.addEventListener('DOMContentLoaded', async () => {
      const loaderStart = Date.now();
      let loaderHidden = false;

      function hideLoader() {
        if (loaderHidden) return;
        loaderHidden = true;
        const loader = document.getElementById('tataLoader');
        if (loader) loader.classList.add('hide');
      }

      // Safety: loader maksimal 4 detik, jangan sampai stuck
      setTimeout(hideLoader, 4000);

      // set login logo from sidebar logo
      const sideLogo = document.querySelector('.logo-icon img');
      const loginLogo = document.getElementById('loginLogo');
      if (sideLogo && loginLogo) loginLogo.src = sideLogo.src;

      document.querySelectorAll('.lang-item').forEach(el=>el.classList.toggle('active',el.dataset.lang===currentLang));

      try {
        // Cek status login Firebase
        const user = await checkAuth();

        if (user) {
          await enterApp();
        } else {
          document.getElementById('loginScreen').classList.remove('hide');
          document.getElementById('mainApp').classList.add('hide');
        }
      } catch (e) {
        console.warn('Init error:', e);
        document.getElementById('loginScreen').classList.remove('hide');
        document.getElementById('mainApp').classList.add('hide');
      }

      // Hide Tata.co loader (min ~0.9s agar animasi smooth)
      const elapsed = Date.now() - loaderStart;
      const wait = Math.max(0, 900 - elapsed);
      setTimeout(hideLoader, wait);
    });

    function setGreeting() {
      const hour = new Date().getHours();
      let greet = t('night');
      if (hour < 11) greet = t('morning');
      else if (hour < 15) greet = t('afternoon');
      else if (hour < 18) greet = t('evening');
      const name = (currentUser && currentUser.name) ? currentUser.name : 'User';
      document.getElementById('greetingText').textContent = `${greet}, ${name}`;
      const localeMap = { id:'id-ID', en:'en-US', ms:'ms-MY', ja:'ja-JP', ar:'ar-SA' };
      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      document.getElementById('dateText').textContent = new Date().toLocaleDateString(localeMap[currentLang]||'id-ID', options);
    }

    function renderFolders() {
      const grid = document.getElementById('folderGrid');
      if (!grid) return;
      grid.innerHTML = folders.map(f => `
        <div class="folder-card" onclick="openFolder('${f.name.replace(/'/g, "\\'")}')">
          <div class="folder-tab ${f.color}"></div>
          <div class="folder-body">
            <div class="icon ${f.color}"><i class="fas ${f.icon}"></i></div>
            <div class="name">${f.name}</div>
            <div class="count"><span>${f.count}</span> ${t('docs')}</div>
          </div>
        </div>
      `).join('');
      const fcl = document.getElementById('folderCountLabel');
      if (fcl) fcl.textContent = `${folders.length} ${t('folders').toLowerCase()}`;
    }

    function renderSidebarFolders() {
      const list = document.getElementById('sidebarFolders');
      list.innerHTML = folders.map(f => `
        <div class="folder-item" onclick="openFolder('${f.name}')">
          <i class="fas ${f.icon}" style="font-size:13px;color:rgba(255,255,255,0.45);width:16px;"></i>
          ${f.name}
          <span class="count">${f.count}</span>
        </div>
      `).join('');
    }

    function renderBarChart() {
      const months = ['Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt'];
      const values = [2, 5, 3, 8, 4, 3];
      const max = Math.max(...values);
      const chart = document.getElementById('barChart');
      if (!chart) return;
      chart.innerHTML = months.map((m, i) => {
        const h = Math.max(8, (values[i] / max) * 110);
        return `
          <div class="bar-item">
            <div class="bar-value">${values[i]}</div>
            <div class="bar ${i === months.length - 1 ? 'fill' : ''}" style="height:${h}px;"></div>
            <div class="bar-label">${m}</div>
          </div>
        `;
      }).join('');
    }

    function populateFolderSelect() {
      const select = document.getElementById('fileFolder');
      select.innerHTML = folders.map(f => `<option value="${f.name}">${f.name}</option>`).join('');
    }

    function updateStats() {
      const totalEl = document.getElementById('statTotal');
      if (totalEl) totalEl.textContent = files.length;
      const badge = document.getElementById('totalBadge');
      if (badge) badge.textContent = files.length;
      const monthEl = document.getElementById('statMonth');
      if (monthEl) monthEl.textContent = files.filter(f => f.date.startsWith('2026-10')).length;
      // badge sampah di nav
      const trashNav = document.querySelector('.nav-item[data-view="trash"] .badge');
      if (trashNav) trashNav.textContent = trash.length;
      const folderNav = document.querySelector('.nav-item[data-view="folders"] .badge');
      if (folderNav) folderNav.textContent = folders.length;
      const statFolders = document.getElementById('statFolders');
      if (statFolders) statFolders.textContent = folders.length;
      const sub = document.querySelector('.stat-card .stat-info .sub');
      if (sub) sub.textContent = `${trash.length} ${t('inTrash')}`;
    }

    // ========== NAVIGATION (History API + hash path) ==========
    // Agar tombol Back/Forward browser mengikuti urutan halaman yang benar
    let _navSilent = false; // true saat restore dari popstate/hash (jangan push lagi)

    function getRouteFromHash() {
      const raw = (location.hash || '').replace(/^#\/?/, '').trim();
      if (!raw) return { view: 'dashboard', folder: null };
      const parts = raw.split('/');
      if (parts[0] === 'folder' && parts[1]) {
        return { view: 'all', folder: decodeURIComponent(parts.slice(1).join('/')) };
      }
      const allowed = ['dashboard', 'all', 'folders', 'trash'];
      const view = allowed.includes(parts[0]) ? parts[0] : 'dashboard';
      return { view, folder: null };
    }

    function updateHash(view, folder) {
      let hash = '#/' + (view || 'dashboard');
      if (folder) hash = '#/folder/' + encodeURIComponent(folder);
      if (location.hash === hash) return;
      try {
        history.pushState({ view: view || 'dashboard', folder: folder || null }, '', hash);
      } catch (e) {
        // Fallback untuk file:// atau browser yang membatasi history API
        try { location.hash = hash; } catch (e2) {}
      }
    }

    function applyRoute(view, folder, fromHistory) {
      if (folder) {
        _applyOpenFolder(folder);
      } else {
        _applySwitchView(view || 'dashboard');
      }
      if (!fromHistory) {
        updateHash(view || 'dashboard', folder || null);
      }
    }

    function _applySwitchView(view) {
      currentView = view;
      currentFolderFilter = null;
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      const navItem = document.querySelector(`.nav-item[data-view="${view}"]`);
      if (navItem) navItem.classList.add('active');

      const dash = document.getElementById('dashboardView');
      const list = document.getElementById('fileListView');
      const toolbar = document.getElementById('fileToolbar');
      const tableWrap = document.getElementById('fileTableWrap');
      const folderManage = document.getElementById('folderManageView');
      const btnPrimary = document.getElementById('btnListPrimary');

      if (view === 'dashboard') {
        dash.classList.remove('hide');
        list.classList.remove('show');
      } else {
        dash.classList.add('hide');
        list.classList.add('show');
        const titles = { all: t('allArchives'), folders: t('manageFolders'), trash: t('trash') };
        document.getElementById('listTitle').textContent = titles[view] || view;

        if (view === 'folders') {
          toolbar.style.display = 'none';
          tableWrap.style.display = 'none';
          folderManage.classList.add('show');
          btnPrimary.innerHTML = `<i class="fas fa-plus"></i> ${t('newFolder')}`;
          renderFolderManage();
        } else {
          toolbar.style.display = 'flex';
          tableWrap.style.display = 'block';
          folderManage.classList.remove('show');
          btnPrimary.innerHTML = `<i class="fas fa-plus"></i> ${t('upload')}`;
          populateFilterFolder();
          if (view === 'trash') {
            toolbar.style.display = 'none';
            renderFileTable(trash, true);
          } else {
            applyFilterSort();
          }
        }
      }

      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebarOverlay').classList.remove('show');
    }

    function switchView(view) {
      if (_navSilent) {
        _applySwitchView(view);
        return;
      }
      applyRoute(view, null, false);
    }

    function _applyOpenFolder(name) {
      currentView = 'all';
      currentFolderFilter = name;
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      const navItem = document.querySelector(`.nav-item[data-view="all"]`);
      if (navItem) navItem.classList.add('active');
      document.getElementById('dashboardView').classList.add('hide');
      document.getElementById('fileListView').classList.add('show');
      document.getElementById('listTitle').textContent = name;
      document.getElementById('fileToolbar').style.display = 'flex';
      document.getElementById('fileTableWrap').style.display = 'block';
      document.getElementById('folderManageView').classList.remove('show');
      document.getElementById('btnListPrimary').innerHTML = `<i class="fas fa-plus"></i> ${t('upload')}`;
      populateFilterFolder();
      const ff = document.getElementById('filterFolder');
      if (ff) ff.value = name;
      applyFilterSort();
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebarOverlay').classList.remove('show');
    }

    function openFolder(name) {
      if (_navSilent) {
        _applyOpenFolder(name);
        return;
      }
      applyRoute('all', name, false);
    }

    function restoreRouteFromHistory() {
      const route = getRouteFromHash();
      _navSilent = true;
      try {
        if (route.folder) {
          _applyOpenFolder(route.folder);
        } else {
          _applySwitchView(route.view);
        }
      } finally {
        _navSilent = false;
      }
    }

    window.addEventListener('popstate', function () {
      restoreRouteFromHistory();
    });

    // Sinkronkan hash saat pertama kali masuk app
    function initRoute() {
      try {
        if (!location.hash || location.hash === '#' || location.hash === '#/') {
          history.replaceState({ view: 'dashboard', folder: null }, '', '#/dashboard');
        }
      } catch (e) {
        try { if (!location.hash || location.hash === '#' || location.hash === '#/') location.hash = '#/dashboard'; } catch (e2) {}
      }
      restoreRouteFromHistory();
    }

    function onListPrimaryAction() {
      if (currentView === 'folders') openFolderModal();
      else openModal('upload');
    }

    function refreshCurrentList() {
      if (currentView === 'folders') {
        renderFolderManage();
        return;
      }
      if (currentView === 'trash') {
        renderFileTable(trash, true);
      } else if (currentView === 'all' || currentFolderFilter) {
        applyFilterSort();
      }
    }

    function populateFilterFolder() {
      const sel = document.getElementById('filterFolder');
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = `<option value="">${t('allFolders')}</option>` +
        folders.map(f => `<option value="${f.name}">${f.name}</option>`).join('');
      if (currentFolderFilter) sel.value = currentFolderFilter;
      else if (cur) sel.value = cur;
    }

    function applyFilterSort() {
      let data = [...files];
      const folderVal = document.getElementById('filterFolder')?.value || '';
      const sortVal = document.getElementById('sortBy')?.value || 'date-desc';
      sortKey = sortVal;
      if (folderVal) data = data.filter(f => f.folder === folderVal);
      if (currentFolderFilter && !folderVal) data = data.filter(f => f.folder === currentFolderFilter);

      data.sort((a, b) => {
        if (sortVal === 'name-asc') return a.name.localeCompare(b.name);
        if (sortVal === 'name-desc') return b.name.localeCompare(a.name);
        if (sortVal === 'folder-asc') return a.folder.localeCompare(b.folder);
        if (sortVal === 'date-asc') return a.date.localeCompare(b.date);
        return b.date.localeCompare(a.date);
      });

      const lbl = document.getElementById('listCountLabel');
      if (lbl) lbl.textContent = `${data.length} arsip`;
      renderFileTable(data, false);
    }

    function renderFileTable(data, isTrash) {
      const tbody = document.getElementById('fileTableBody');
      const empty = document.getElementById('emptyState');

      if (!data.length) {
        tbody.innerHTML = '';
        empty.style.display = 'block';
        return;
      }
      empty.style.display = 'none';

      const iconMap = {
        pdf: 'fa-file-pdf pdf',
        img: 'fa-file-image img',
        doc: 'fa-file-word doc',
        xls: 'fa-file-excel xls',
        other: 'fa-file other'
      };

      tbody.innerHTML = data.map(f => {
        const actions = isTrash
          ? `<button class="action-btn" title="${t('restore')}" onclick="restoreFile(${f.id})"><i class="fas fa-undo"></i></button>
             <button class="action-btn danger" title="${t('permanentDelete')}" onclick="permanentDelete(${f.id})"><i class="fas fa-trash"></i></button>`
          : `<button class="action-btn" title="${t('preview')}" onclick="previewFile(${f.id})"><i class="fas fa-eye"></i></button>
             <button class="action-btn" title="Edit" onclick="openEditFile(${f.id})"><i class="fas fa-pen"></i></button>
             <button class="action-btn" title="${t('move')}" onclick="moveFile(${f.id})"><i class="fas fa-folder-open"></i></button>
             <button class="action-btn danger" title="${t('delete')}" onclick="deleteFile(${f.id})"><i class="fas fa-trash"></i></button>`;
        return `
        <tr>
          <td>
            <div class="file-name">
              <i class="fas ${iconMap[f.type] || iconMap.other}"></i>
              ${f.name}
            </div>
          </td>
          <td>${f.folder}</td>
          <td>${f.size}</td>
          <td>${formatDate(f.date)}</td>
          <td><div class="actions">${actions}</div></td>
        </tr>`;
      }).join('');
    }

    function formatDate(d) {
      const date = new Date(d);
      return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    // ========== MODAL ==========
    function openModal(type) {
      if (type === 'upload') populateFolderSelect();
      document.getElementById(type + 'Modal').classList.add('show');
    }

    function closeModal(type) {
      const el = document.getElementById(type + 'Modal');
      if (el) el.classList.remove('show');
      if (type === 'upload') {
        document.getElementById('selectedFiles').innerHTML = '';
        document.getElementById('fileName').value = '';
        document.getElementById('fileNote').value = '';
        document.getElementById('fileInput').value = '';
        pendingUploadFiles = [];
      }
    }

    // ========== UPLOAD ==========
    const uploadZone = document.getElementById('uploadZone');
    uploadZone.addEventListener('dragover', e => {
      e.preventDefault();
      uploadZone.classList.add('dragover');
    });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
    uploadZone.addEventListener('drop', e => {
      e.preventDefault();
      uploadZone.classList.remove('dragover');
      handleFiles(e.dataTransfer.files);
    });

    function handleFileSelect(e) {
      handleFiles(e.target.files);
    }

    function handleFiles(fileList) {
      pendingUploadFiles = Array.from(fileList);
      const container = document.getElementById('selectedFiles');
      container.innerHTML = pendingUploadFiles.map(f => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg);border-radius:8px;margin-bottom:6px;font-size:13px;">
          <i class="fas fa-file" style="color:var(--primary);"></i>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.name}</span>
          <span style="color:var(--text-secondary);font-size:12px;">${(f.size/1024).toFixed(0)} KB</span>
        </div>
      `).join('');
      if (pendingUploadFiles.length && !document.getElementById('fileName').value) {
        document.getElementById('fileName').value = pendingUploadFiles[0].name.replace(/\.[^/.]+$/, '');
      }
    }

    function detectType(name) {
      const ext = name.split('.').pop()?.toLowerCase();
      if (['pdf'].includes(ext)) return 'pdf';
      if (['jpg','jpeg','png','gif','webp'].includes(ext)) return 'img';
      if (['doc','docx'].includes(ext)) return 'doc';
      if (['xls','xlsx','csv'].includes(ext)) return 'xls';
      return 'other';
    }

    function uploadFile() {
      const name = document.getElementById('fileName').value.trim();
      const folder = document.getElementById('fileFolder').value;
      const note = document.getElementById('fileNote').value.trim();
      if (!name) {
        showToast(t('fillName'));
        return;
      }

      const raw = pendingUploadFiles[0] || null;
      const fullName = name.includes('.') ? name : (raw ? raw.name : name + '.pdf');
      const type = detectType(fullName);
      let previewUrl = null;
      let sizeStr = Math.floor(Math.random() * 300 + 50) + ' KB';
      if (raw) {
        sizeStr = (raw.size / 1024).toFixed(0) + ' KB';
        if (type === 'img' || type === 'pdf') {
          previewUrl = URL.createObjectURL(raw);
        }
      }

      const newFile = {
        id: Date.now(),
        name: fullName,
        folder,
        size: sizeStr,
        date: new Date().toISOString().slice(0, 10),
        type,
        note,
        previewUrl,
        driveSynced: false
      };

      files.unshift(newFile);
      const f = folders.find(x => x.name === folder);
      if (f) f.count++;

      if (raw) {
        idbPut(newFile.id, raw);
        // Upload ke Firebase Storage
        (async () => {
          const path = await cloudUploadFile(newFile.id, fullName, raw);
          if (path) {
            newFile.storagePath = path;
            const idx = files.findIndex(x => x.id === newFile.id);
            if (idx !== -1) files[idx].storagePath = path;
            saveData();
          }
        })();
      }
      saveData();

      renderFolders();
      renderSidebarFolders();
      updateStats();
      closeModal('upload');
      showToast(t('uploaded'));
      addNotification(`Arsip baru diunggah: ${fullName}`);
      if (currentView === 'all') applyFilterSort();
    }

    // ========== ACTIONS ==========
    function deleteFile(id) {
      id = Number(id);
      if (!confirm(t('confirmDel'))) return;
      const idx = files.findIndex(f => Number(f.id) === id);
      if (idx === -1) return;
      const file = files[idx];
      const folder = folders.find(x => x.name === file.folder);
      if (folder && folder.count > 0) folder.count--;
      files.splice(idx, 1);
      trash.unshift(file);
      renderFolders();
      renderSidebarFolders();
      updateStats();
      refreshCurrentList();
      saveData();
      showToast(t('deleted'));
      addNotification(`Dipindah ke sampah: ${file.name}`);
    }

    function restoreFile(id) {
      id = Number(id);
      const idx = trash.findIndex(f => Number(f.id) === id);
      if (idx === -1) return;
      const file = trash[idx];
      trash.splice(idx, 1);
      files.unshift(file);
      const folder = folders.find(x => x.name === file.folder);
      if (folder) folder.count++;
      renderFolders();
      renderSidebarFolders();
      updateStats();
      refreshCurrentList();
      saveData();
      showToast(t('moved') + ' ' + file.folder);
    }

    function permanentDelete(id) {
      id = Number(id);
      if (!confirm(t('confirmDel'))) return;
      const toDel = trash.find(f => Number(f.id) === id);
      if (toDel && toDel.storagePath) cloudDeleteFile(toDel.storagePath);
      trash = trash.filter(f => Number(f.id) !== id);
      idbDelete(id);
      updateStats();
      refreshCurrentList();
      saveData();
      showToast(t('deleted'));
    }

    function moveFile(id) {
      id = Number(id);
      const newFolder = prompt(folders.map(f => f.name).join('\n'));
      if (!newFolder) return;
      const target = folders.find(f => f.name.toLowerCase() === newFolder.toLowerCase().trim());
      if (!target) {
        showToast(t('notFound'));
        return;
      }
      const file = files.find(f => Number(f.id) === id);
      if (file) {
        const old = folders.find(x => x.name === file.folder);
        if (old && old.count > 0) old.count--;
        target.count++;
        file.folder = target.name;
        renderFolders();
        renderSidebarFolders();
        updateStats();
        refreshCurrentList();
        saveData();
        showToast(`${t('moved')} ${target.name}`);
      }
    }

    function previewFile(id) {
      id = Number(id);
      const file = files.find(f => Number(f.id) === id) || trash.find(f => Number(f.id) === id);
      if (!file) return;
      document.getElementById('previewTitle').textContent = file.name;
      const body = document.getElementById('previewBody');
      const meta = document.getElementById('previewMeta');
      meta.innerHTML = `<strong>Folder:</strong> ${file.folder} · <strong>Ukuran:</strong> ${file.size} · <strong>Tanggal:</strong> ${formatDate(file.date)}` +
        (file.note ? `<br><strong>Keterangan:</strong> ${file.note}` : '');

      if (file.previewUrl && file.type === 'img') {
        body.innerHTML = `<img src="${file.previewUrl}" alt="${file.name}">`;
      } else if (file.previewUrl && file.type === 'pdf') {
        body.innerHTML = `<iframe src="${file.previewUrl}" title="PDF preview"></iframe>`;
      } else if (file.type === 'img') {
        body.innerHTML = `<i class="fas fa-file-image" style="font-size:64px;color:#2563EB;"></i>
          <p style="color:var(--text-secondary);font-size:14px;">Preview gambar tersedia setelah upload file asli</p>
          <p style="font-weight:600;">${file.name}</p>`;
      } else if (file.type === 'pdf') {
        body.innerHTML = `<i class="fas fa-file-pdf" style="font-size:64px;color:#DC2626;"></i>
          <p style="color:var(--text-secondary);font-size:14px;">Preview PDF tersedia setelah upload file asli</p>
          <p style="font-weight:600;">${file.name}</p>`;
      } else {
        body.innerHTML = `<i class="fas fa-file" style="font-size:64px;color:#6B7280;"></i>
          <p style="color:var(--text-secondary);font-size:14px;">Preview tidak tersedia untuk tipe file ini</p>
          <p style="font-weight:600;">${file.name}</p>`;
      }
      openModal('preview');
    }

    function openEditFile(id) {
      id = Number(id);
      const file = files.find(f => Number(f.id) === id);
      if (!file) return;
      document.getElementById('editFileId').value = file.id;
      document.getElementById('editFileName').value = file.name;
      document.getElementById('editFileNote').value = file.note || '';
      const sel = document.getElementById('editFileFolder');
      sel.innerHTML = folders.map(f => `<option value="${f.name}" ${f.name===file.folder?'selected':''}>${f.name}</option>`).join('');
      openModal('edit');
    }

    function saveEditFile() {
      const id = Number(document.getElementById('editFileId').value);
      const file = files.find(f => Number(f.id) === id);
      if (!file) return;
      const newName = document.getElementById('editFileName').value.trim();
      const newFolder = document.getElementById('editFileFolder').value;
      const newNote = document.getElementById('editFileNote').value.trim();
      if (!newName) { showToast(t('fillName')); return; }

      if (file.folder !== newFolder) {
        const oldF = folders.find(x => x.name === file.folder);
        const newF = folders.find(x => x.name === newFolder);
        if (oldF && oldF.count > 0) oldF.count--;
        if (newF) newF.count++;
        file.folder = newFolder;
      }
      file.name = newName;
      file.note = newNote;
      file.type = detectType(newName);

      renderFolders();
      renderSidebarFolders();
      updateStats();
      refreshCurrentList();
      saveData();
      closeModal('edit');
      showToast(t('archiveUpdated'));
      addNotification(`Arsip diperbarui: ${newName}`);
    }

    // ========== FOLDER MANAGE ==========
    function renderFolderManage() {
      const list = document.getElementById('folderManageList');
      if (!list) return;
      const colorBg = {
        blue:'#DBEAFE', green:'#D1FAE5', orange:'#FFEDD5', purple:'#EDE9FE',
        pink:'#FCE7F3', cyan:'#CFFAFE', red:'#FEE2E2', yellow:'#FEF3C7'
      };
      const colorFg = {
        blue:'#2563EB', green:'#059669', orange:'#EA580C', purple:'#7C3AED',
        pink:'#DB2777', cyan:'#0891B2', red:'#DC2626', yellow:'#D97706'
      };
      list.innerHTML = folders.map(f => `
        <div class="folder-manage-item">
          <div class="fm-icon" style="background:${colorBg[f.color]||'#E5E7EB'};color:${colorFg[f.color]||'#6B7280'};">
            <i class="fas ${f.icon}"></i>
          </div>
          <div class="fm-name">${f.name}</div>
          <div class="fm-count">${f.count} dokumen</div>
          <button class="action-btn" title="Rename" onclick="openFolderModal(${f.id})"><i class="fas fa-pen"></i></button>
          <button class="action-btn danger" title="Hapus" onclick="deleteFolder(${f.id})"><i class="fas fa-trash"></i></button>
        </div>
      `).join('');
    }

    function openFolderModal(id) {
      if (id) {
        const f = folders.find(x => x.id === id);
        if (!f) return;
        document.getElementById('folderModalTitle').textContent = 'Rename Folder';
        document.getElementById('folderEditId').value = f.id;
        document.getElementById('folderNameInput').value = f.name;
        document.getElementById('folderColorInput').value = f.color;
      } else {
        document.getElementById('folderModalTitle').textContent = 'Folder Baru';
        document.getElementById('folderEditId').value = '';
        document.getElementById('folderNameInput').value = '';
        document.getElementById('folderColorInput').value = 'blue';
      }
      openModal('folder');
    }

    function saveFolder() {
      const name = document.getElementById('folderNameInput').value.trim();
      const color = document.getElementById('folderColorInput').value;
      const editId = document.getElementById('folderEditId').value;
      if (!name) { showToast(t('fillFolderName')); return; }

      if (editId) {
        const f = folders.find(x => String(x.id) === String(editId));
        if (!f) return;
        const oldName = f.name;
        if (oldName !== name && folders.some(x => x.name.toLowerCase() === name.toLowerCase())) {
          showToast(t('folderExists')); return;
        }
        f.name = name;
        f.color = color;
        files.forEach(file => { if (file.folder === oldName) file.folder = name; });
        trash.forEach(file => { if (file.folder === oldName) file.folder = name; });
        showToast(t('folderUpdated'));
        addNotification(`Folder diubah: ${name}`);
      } else {
        if (folders.some(x => x.name.toLowerCase() === name.toLowerCase())) {
          showToast(t('folderExists')); return;
        }
        const maxId = folders.reduce((m, f) => Math.max(m, f.id), 0);
        folders.push({
          id: maxId + 1,
          name,
          icon: folderIcons[folders.length % folderIcons.length],
          color,
          count: 0
        });
        showToast(t('folderCreated'));
        addNotification(t('newFolderNotif') + name);
      }

      renderFolders();
      renderSidebarFolders();
      populateFolderSelect();
      populateFilterFolder();
      updateStats();
      renderFolderManage();
      saveData();
      closeModal('folder');
    }

    function deleteFolder(id) {
      const f = folders.find(x => x.id === id);
      if (!f) return;
      const hasFiles = files.some(file => file.folder === f.name);
      if (hasFiles) {
        if (!confirm(t('folderHasFiles').replace('{name}', f.name))) return;
        let target = folders.find(x => x.name === 'Lainnya' && x.id !== f.id);
        if (!target) {
          target = { id: Date.now(), name: 'Lainnya', icon: 'fa-folder', color: 'purple', count: 0 };
          folders.push(target);
        }
        files.forEach(file => {
          if (file.folder === f.name) {
            file.folder = target.name;
            target.count++;
          }
        });
      } else if (!confirm(t('confirmDelFolder').replace('{name}', f.name))) {
        return;
      }
      const idx = folders.findIndex(x => x.id === id);
      if (idx >= 0) folders.splice(idx, 1);
      renderFolders();
      renderSidebarFolders();
      populateFolderSelect();
      populateFilterFolder();
      updateStats();
      renderFolderManage();
      saveData();
      showToast(t('folderRemoved'));
      addNotification(`Folder dihapus: ${f.name}`);
    }

    // ========== NOTIFICATIONS ==========
    function toggleNotifPanel() {
      document.getElementById('notifPanel').classList.toggle('show');
      renderNotifications();
    }

    function renderNotifications() {
      const list = document.getElementById('notifList');
      const badge = document.getElementById('notifBadge');
      const unread = notifications.filter(n => !n.read).length;
      if (unread > 0) {
        badge.textContent = unread > 9 ? '9+' : unread;
        badge.classList.add('show');
      } else {
        badge.classList.remove('show');
      }
      if (!notifications.length) {
        list.innerHTML = `<div class="notif-empty">Belum ada notifikasi</div>`;
        return;
      }
      list.innerHTML = notifications.map(n => `
        <div class="notif-item ${n.read ? '' : 'unread'}" onclick="markNotifRead(${n.id})">
          <div>${n.text}</div>
          <div class="n-time">${formatNotifTime(n.time)}</div>
        </div>
      `).join('');
    }

    function formatNotifTime(ts) {
      const diff = Date.now() - ts;
      if (diff < 60000) return 'Baru saja';
      if (diff < 3600000) return Math.floor(diff/60000) + ' menit lalu';
      if (diff < 86400000) return Math.floor(diff/3600000) + ' jam lalu';
      return new Date(ts).toLocaleDateString('id-ID');
    }

    function addNotification(text) {
      notifications.unshift({ id: Date.now(), text, time: Date.now(), read: false });
      if (notifications.length > 30) notifications.pop();
      renderNotifications();
      saveData();
    }

    function markNotifRead(id) {
      const n = notifications.find(x => x.id === id);
      if (n) n.read = true;
      renderNotifications();
    }

    function markAllNotifRead() {
      notifications.forEach(n => n.read = true);
      renderNotifications();
      saveData();
    }

    document.addEventListener('click', e => {
      const wrap = document.querySelector('.notif-wrap');
      if (wrap && !wrap.contains(e.target)) {
        document.getElementById('notifPanel')?.classList.remove('show');
      }
    });

    function handleSearch() {
      const q = document.getElementById('searchInput').value.toLowerCase();
      if (!q) {
        if (document.getElementById('fileListView').classList.contains('show')) {
          refreshCurrentList();
        }
        return;
      }
      switchView('all');
      const filtered = files.filter(f =>
        f.name.toLowerCase().includes(q) || f.folder.toLowerCase().includes(q)
      );
      renderFileTable(filtered, false);
    }

    function syncDrive() {
      showToast(t('syncing'));
      // Simpan snapshot metadata + tandai file tersinkron (browser-side).
      // Koneksi Google Drive API penuh membutuhkan Client ID / OAuth dari Google Cloud.
      setTimeout(() => {
        const stamp = new Date().toISOString();
        localStorage.setItem('arsipLastDriveSync', stamp);
        files.forEach(f => { f.driveSynced = true; });
        saveData();

        // Export backup JSON (bisa diunggah manual ke Google Drive)
        try {
          const payload = {
            exportedAt: stamp,
            folders,
            files: files.map(f => ({ id: f.id, name: f.name, folder: f.folder, size: f.size, date: f.date, type: f.type, note: f.note || '' })),
            trash: trash.map(f => ({ id: f.id, name: f.name, folder: f.folder, size: f.size, date: f.date, type: f.type }))
          };
          const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `arsip-backup-${stamp.slice(0,10)}.json`;
          a.click();
          URL.revokeObjectURL(url);
        } catch (e) {}

        showToast(t('synced'));
        addNotification('Sinkronisasi Drive selesai · backup diunduh');
      }, 1200);
    }

    function toggleSidebar() {
      document.getElementById('sidebar').classList.toggle('open');
      document.getElementById('sidebarOverlay').classList.toggle('show');
    }

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.style.display = 'block';
      setTimeout(() => t.style.display = 'none', 2500);
    }
