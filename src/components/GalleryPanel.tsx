import {deleteDoc, doc, serverTimestamp, writeBatch} from 'firebase/firestore';
import {
  ChevronLeft,
  ChevronRight,
  Images,
  LogIn,
  LogOut,
  Trash2,
  X,
} from 'lucide-react';
import {type FormEvent, useEffect, useMemo, useState} from 'react';
import firebaseConfig from '../../firebase-applet-config.json';
import {db, handleFirestoreError, OperationType} from '../firebase';
import {type AdminAuthState} from '../hooks/useAdminAuth';

export interface GalleryLinkRecord {
  id: string;
  title: string;
  driveUrl: string;
  description: string;
  order: number;
}

interface GalleryPhotoItem {
  id: string;
  title: string;
  thumbUrl: string;
  fullUrl: string;
}

interface GalleryPanelProps {
  items: GalleryLinkRecord[];
  loading: boolean;
  loadError: string | null;
  adminAuth: AdminAuthState;
}

const INITIAL_VISIBLE_COUNT = 12;
const LOAD_MORE_STEP = 15;

function extractDriveFolderId(rawUrl: string): string | null {
  const match = rawUrl.trim().match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

function extractUrlsFromInput(rawInput: string): string[] {
  const matches = rawInput.match(/https?:\/\/[^\s,;"'<>()]+/gi) ?? [];
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const raw of matches) {
    const normalized = raw
      .replace(/^http:\/\//i, 'https://')
      .replace(/[.,;]+$/, '')
      .trim();

    if (
      normalized.length >= 12 &&
      normalized.length <= 500 &&
      /^https:\/\/\S+$/i.test(normalized) &&
      !seen.has(normalized)
    ) {
      seen.add(normalized);
      cleaned.push(normalized);
    }
  }

  return cleaned;
}

function resolveSinglePhotoUrls(
  rawUrl: string,
): {thumbUrl: string; fullUrl: string} | null {
  const trimmed = rawUrl.trim();
  if (!/^https:\/\/\S+$/i.test(trimmed) || trimmed.includes('/folders/')) {
    return null;
  }

  const fileMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  const lhMatch = trimmed.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);

  const fileId =
    fileMatch?.[1] ||
    (trimmed.includes('drive.google.com') ? idMatch?.[1] : null) ||
    lhMatch?.[1];

  if (fileId) {
    return {
      thumbUrl: `https://lh3.googleusercontent.com/d/${fileId}=w400`,
      fullUrl: `https://lh3.googleusercontent.com/d/${fileId}=w1200`,
    };
  }

  return {thumbUrl: trimmed, fullUrl: trimmed};
}

function buildPhotoDocId(title: string): string {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return `${base || 'galeri'}-${suffix}`.slice(0, 120);
}

export function GalleryPanel({items, loading, loadError, adminAuth}: GalleryPanelProps) {
  const {
    currentUser,
    isAdmin,
    checkingAdmin,
    signingIn,
    authError,
    signInAdmin,
    signOutAdmin,
    clearAuthError,
  } = adminAuth;

  const [adminView, setAdminView] = useState<'none' | 'add' | 'manage'>('none');
  const [title, setTitle] = useState<string>('Kegiatan MI Nurul Islam');
  const [linkUrl, setLinkUrl] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState<boolean>(false);

  const [folderPhotos, setFolderPhotos] = useState<Record<string, GalleryPhotoItem[]>>({});
  const [folderApiBlocked, setFolderApiBlocked] = useState<boolean>(false);
  const [loadingFolders, setLoadingFolders] = useState<boolean>(false);

  const [visibleCount, setVisibleCount] = useState<number>(INITIAL_VISIBLE_COUNT);
  const [activePhotoIndex, setActivePhotoIndex] = useState<number | null>(null);
  const [failedIds, setFailedIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isAdmin) {
      setAdminView('none');
      setConfirmClearAll(false);
    }
  }, [isAdmin]);

  const folderEntries = useMemo(
    () =>
      items
        .map((item) => {
          const folderId = extractDriveFolderId(item.driveUrl);
          return folderId ? {id: item.id, title: item.title, folderId} : null;
        })
        .filter((entry): entry is {id: string; title: string; folderId: string} => entry !== null),
    [items],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadFolderImages() {
      if (folderEntries.length === 0) {
        setFolderPhotos({});
        setFolderApiBlocked(false);
        setLoadingFolders(false);
        return;
      }

      setLoadingFolders(true);
      const nextMap: Record<string, GalleryPhotoItem[]> = {};
      let apiDenied = false;

      await Promise.all(
        folderEntries.map(async (folder) => {
          try {
            const query = encodeURIComponent(
              `'${folder.folderId}' in parents and trashed = false and mimeType contains 'image/'`,
            );
            const endpoint = `https://www.googleapis.com/drive/v3/files?q=${query}&orderBy=modifiedTime%20desc&pageSize=100&fields=files(id,name)&key=${encodeURIComponent(firebaseConfig.apiKey)}`;
            const response = await fetch(endpoint);

            if (!response.ok) {
              if (response.status === 403 || response.status === 401) {
                apiDenied = true;
              }
              return;
            }

            const payload = (await response.json()) as {
              files?: Array<{id?: string; name?: string}>;
            };
            const files = Array.isArray(payload.files) ? payload.files : [];
            nextMap[folder.id] = files
              .filter((file): file is {id: string; name?: string} => typeof file.id === 'string')
              .map((file, idx) => ({
                id: `${folder.id}-${file.id}`,
                title: folder.title || `Dokumentasi #${idx + 1}`,
                thumbUrl: `https://lh3.googleusercontent.com/d/${file.id}=w400`,
                fullUrl: `https://lh3.googleusercontent.com/d/${file.id}=w1200`,
              }));
          } catch {
            // Abaikan error jaringan per folder
          }
        }),
      );

      if (!cancelled) {
        setFolderPhotos(nextMap);
        setFolderApiBlocked(apiDenied);
        setLoadingFolders(false);
      }
    }

    void loadFolderImages();
    return () => {
      cancelled = true;
    };
  }, [folderEntries]);

  const photoEntries: GalleryPhotoItem[] = useMemo(() => {
    const collected: GalleryPhotoItem[] = [];

    for (const item of items) {
      const folderId = extractDriveFolderId(item.driveUrl);
      if (folderId) {
        const fromFolder = folderPhotos[item.id] ?? [];
        collected.push(...fromFolder);
      } else {
        const single = resolveSinglePhotoUrls(item.driveUrl);
        if (single) {
          collected.push({
            id: item.id,
            title: item.title || 'Dokumentasi Kegiatan',
            thumbUrl: single.thumbUrl,
            fullUrl: single.fullUrl,
          });
        }
      }
    }

    return collected;
  }, [items, folderPhotos]);

  const visiblePhotos = useMemo(
    () => photoEntries.slice(0, visibleCount),
    [photoEntries, visibleCount],
  );

  useEffect(() => {
    if (activePhotoIndex === null) return;
    if (photoEntries.length === 0) {
      setActivePhotoIndex(null);
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setActivePhotoIndex(null);
      } else if (event.key === 'ArrowRight') {
        setActivePhotoIndex((prev) =>
          prev === null ? null : (prev + 1) % photoEntries.length,
        );
      } else if (event.key === 'ArrowLeft') {
        setActivePhotoIndex((prev) =>
          prev === null ? null : (prev - 1 + photoEntries.length) % photoEntries.length,
        );
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePhotoIndex, photoEntries.length]);

  async function handleAdminSignIn() {
    setFormError(null);
    await signInAdmin();
  }

  async function handleAdminSignOut() {
    setFormError(null);
    setAdminView('none');
    setConfirmClearAll(false);
    await signOutAdmin();
  }

  async function handleAddLink(event: FormEvent) {
    event.preventDefault();
    if (!currentUser || !isAdmin) return;

    const trimmedTitle = title.trim();
    const extractedUrls = extractUrlsFromInput(linkUrl);

    if (trimmedTitle.length < 2 || trimmedTitle.length > 80) {
      setFormError('Judul harus 2–80 karakter.');
      return;
    }
    if (extractedUrls.length === 0) {
      setFormError('Tempel minimal 1 link foto yang diawali https://.');
      return;
    }
    if (extractedUrls.length > 100) {
      setFormError('Maksimal 100 link foto dalam satu kali simpan.');
      return;
    }
    if (extractedUrls.some((url) => extractDriveFolderId(url) !== null)) {
      setFormError(
        'Link folder Google Drive diblokir oleh API Google. Buka folder Drive → pilih foto (Ctrl+A) → Salin link → tempel link foto-fotonya di sini.',
      );
      return;
    }

    setFormError(null);
    setSubmitting(true);

    const startOrder = Math.floor(
      items.reduce((max, item) => Math.max(max, item.order), -1) + 1,
    );
    const batch = writeBatch(db);

    try {
      extractedUrls.forEach((url, index) => {
        const entryTitle =
          extractedUrls.length > 1
            ? `${trimmedTitle} #${index + 1}`.slice(0, 80)
            : trimmedTitle;
        const docId = buildPhotoDocId(entryTitle);
        batch.set(doc(db, 'gallery_links', docId), {
          title: entryTitle,
          driveUrl: url,
          description: '',
          order: Math.min(1000, Math.max(0, startOrder + index)),
          updatedBy: currentUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      await batch.commit();

      setTitle('Kegiatan MI Nurul Islam');
      setLinkUrl('');
      setAdminView('none');
    } catch (error) {
      console.error('Gagal menyimpan link galeri:', error);
      setFormError(
        'Gagal menyimpan ke galeri. Pastikan Anda login dengan akun admin terdaftar dan link valid.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteLink(docId: string) {
    if (!currentUser || !isAdmin) return;
    setBusyId(docId);
    try {
      await deleteDoc(doc(db, 'gallery_links', docId));
      setActivePhotoIndex(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `gallery_links/${docId}`);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteAllLinks() {
    if (!currentUser || !isAdmin || items.length === 0) return;
    setBusyId('__all__');
    try {
      const batch = writeBatch(db);
      items.forEach((item) => {
        batch.delete(doc(db, 'gallery_links', item.id));
      });
      await batch.commit();
      setActivePhotoIndex(null);
      setConfirmClearAll(false);
      setAdminView('none');
    } catch (error) {
      console.error('Gagal menghapus semua link:', error);
      setFormError('Gagal menghapus semua link galeri.');
    } finally {
      setBusyId(null);
    }
  }

  const activePhoto = activePhotoIndex !== null ? photoEntries[activePhotoIndex] ?? null : null;
  const isFetchingAny = loading || loadingFolders;

  return (
    <div className="space-y-3">
      {/* Header Galeri & Kontrol Admin */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/15">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-200">
          <Images className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>
            {photoEntries.length > 0
              ? `Dokumentasi (${photoEntries.length} Foto)`
              : 'Dokumentasi Kegiatan'}
          </span>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setAdminView((prev) => (prev === 'add' ? 'none' : 'add'));
                setConfirmClearAll(false);
                setFormError(null);
              }}
              className="text-xs font-medium text-amber-200 hover:text-white underline underline-offset-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {adminView === 'add' ? 'Tutup' : '+ Tambah'}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdminView((prev) => (prev === 'manage' ? 'none' : 'manage'));
                setConfirmClearAll(false);
                setFormError(null);
              }}
              className="text-xs font-medium text-amber-200 hover:text-white underline underline-offset-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {adminView === 'manage' ? 'Lihat Grid' : `Hapus Link (${items.length})`}
            </button>
          </div>
        )}
      </div>

      {/* Form Tambah Link (Khusus Admin) */}
      {adminView === 'add' && isAdmin && (
        <form onSubmit={handleAddLink} className="pb-3 border-b border-white/15 space-y-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Judul kegiatan"
            maxLength={80}
            required
            aria-label="Judul kegiatan"
            className="w-full rounded-lg bg-white/95 text-[#1C1917] placeholder:text-stone-400 px-3 py-2 text-xs focus:outline-2 focus:outline-amber-300"
          />
          <textarea
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="Tempel 1 atau banyak link foto Google Drive (pisah baris, spasi, atau koma)"
            rows={3}
            required
            aria-label="Link foto Google Drive"
            className="w-full rounded-lg bg-white/95 text-[#1C1917] placeholder:text-stone-400 px-3 py-2 text-xs focus:outline-2 focus:outline-amber-300 resize-none"
          />
          <p className="text-[11px] text-emerald-100/80 leading-snug">
            Tips: Di Google Drive, pilih beberapa foto sekaligus → Salin link → tempel di sini (tanpa API Google).
          </p>
          {formError && <p className="text-xs text-amber-200 leading-snug">{formError}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[40px] rounded-lg bg-[#F2C94C] hover:bg-[#E7BD3D] disabled:opacity-60 text-[#0B2B18] text-xs font-semibold transition-colors cursor-pointer"
          >
            {submitting ? 'Menyimpan...' : 'Simpan ke Galeri'}
          </button>
        </form>
      )}

      {/* Menu Hapus Link (Khusus Admin) */}
      {adminView === 'manage' && isAdmin ? (
        <div className="space-y-2">
          {items.length > 1 && (
            <div className="flex items-center justify-end gap-2">
              {confirmClearAll ? (
                <>
                  <button
                    type="button"
                    disabled={busyId === '__all__'}
                    onClick={() => void handleDeleteAllLinks()}
                    className="rounded-md bg-red-500/80 hover:bg-red-500 px-2.5 py-1 text-[11px] font-semibold text-white cursor-pointer"
                  >
                    {busyId === '__all__' ? 'Menghapus...' : `Ya, Hapus Semua (${items.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearAll(false)}
                    className="rounded-md bg-white/10 hover:bg-white/20 px-2.5 py-1 text-[11px] text-white cursor-pointer"
                  >
                    Batal
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(true)}
                  className="text-[11px] font-medium text-red-200 hover:text-white underline underline-offset-2 cursor-pointer"
                >
                  Hapus Semua Link
                </button>
              )}
            </div>
          )}
          {items.length === 0 ? (
            <p className="py-6 text-center text-xs text-emerald-100/75">
              Belum ada link yang tersimpan.
            </p>
          ) : (
            <ul className="divide-y divide-white/10 max-h-60 sm:max-h-68 overflow-y-auto pr-1">
              {items.map((item) => (
                <li key={item.id} className="py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-white truncate">{item.title}</p>
                    <p className="text-[11px] text-emerald-100/65 truncate">{item.driveUrl}</p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === item.id || busyId === '__all__'}
                    onClick={() => void handleDeleteLink(item.id)}
                    aria-label={`Hapus ${item.title}`}
                    className="shrink-0 min-h-[32px] inline-flex items-center gap-1 rounded-md bg-red-500/20 hover:bg-red-500/35 border border-red-300/30 px-2.5 py-1 text-[11px] font-medium text-red-100 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3 shrink-0" aria-hidden="true" />
                    <span>{busyId === item.id ? 'Menghapus...' : 'Hapus'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : isFetchingAny && photoEntries.length === 0 ? (
        <div className="grid grid-cols-3 gap-2 py-1" aria-label="Memuat galeri">
          {Array.from({length: 6}).map((_, idx) => (
            <div
              key={idx}
              className="aspect-square rounded-lg bg-white/10 animate-pulse"
              aria-hidden="true"
            />
          ))}
        </div>
      ) : loadError ? (
        <p className="py-6 text-center text-xs text-amber-200">{loadError}</p>
      ) : photoEntries.length === 0 ? (
        <div className="py-5 text-center space-y-2">
          {folderApiBlocked && isAdmin ? (
            <div className="rounded-lg bg-black/25 border border-amber-300/30 p-3 text-left space-y-2">
              <p className="text-xs font-medium text-amber-200">
                Link folder Google Drive tidak bisa dimuat karena API Google menolak akses.
              </p>
              <p className="text-[11px] text-emerald-100/80">
                Hapus link folder lewat menu &ldquo;Hapus Link&rdquo;, lalu tempel link foto satuan (bisa banyak link sekaligus) lewat &ldquo;+ Tambah&rdquo;.
              </p>
            </div>
          ) : (
            <p className="text-xs text-emerald-100/80">Belum ada foto di galeri.</p>
          )}
          {isAdmin && adminView !== 'add' && !folderApiBlocked && (
            <p className="text-[11px] text-amber-200/90">
              Klik &ldquo;+ Tambah&rdquo; di kanan atas untuk menambahkan foto kegiatan.
            </p>
          )}
        </div>
      ) : (
        <div className="max-h-64 sm:max-h-72 overflow-y-auto pr-1 space-y-2.5">
          <div className="grid grid-cols-3 gap-2">
            {visiblePhotos.map((photo, index) => {
              const isFailed = failedIds[photo.id];
              return (
                <div
                  key={photo.id}
                  className="relative group aspect-square rounded-lg overflow-hidden bg-[#071D10] ring-1 ring-white/15"
                >
                  {isFailed ? (
                    <div className="w-full h-full flex items-center justify-center text-emerald-100/40">
                      <Images className="w-5 h-5" aria-hidden="true" />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setActivePhotoIndex(index)}
                      aria-label={`Lihat ${photo.title}`}
                      className="w-full h-full block cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-200"
                    >
                      <img
                        src={photo.thumbUrl}
                        alt={photo.title}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={() =>
                          setFailedIds((prev) => ({
                            ...prev,
                            [photo.id]: true,
                          }))
                        }
                        className="w-full h-full object-cover object-[50%_22%] transition-transform duration-200 ease-out group-hover:scale-105"
                      />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {visibleCount < photoEntries.length && (
            <button
              type="button"
              onClick={() =>
                setVisibleCount((prev) =>
                  Math.min(photoEntries.length, prev + LOAD_MORE_STEP),
                )
              }
              className="w-full min-h-[38px] rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium text-amber-100 transition-colors cursor-pointer"
            >
              Muat Foto Lainnya ({photoEntries.length - visibleCount} lagi)
            </button>
          )}
        </div>
      )}

      {/* Akses Admin Panitia */}
      <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs text-emerald-100/75 pt-1 border-t border-white/10">
        {currentUser && isAdmin ? (
          <>
            <span className="truncate">Admin: {currentUser.email}</span>
            <button
              type="button"
              onClick={() => void handleAdminSignOut()}
              className="inline-flex items-center gap-1 text-amber-200 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Keluar</span>
            </button>
          </>
        ) : (
          <>
            <span>
              {checkingAdmin ? 'Memeriksa akun...' : 'Dokumentasi MI Nurul Islam Gedangmas'}
            </span>
            <button
              type="button"
              disabled={signingIn || checkingAdmin}
              onClick={() => {
                clearAuthError();
                void handleAdminSignIn();
              }}
              className="inline-flex items-center gap-1 text-amber-200 hover:text-white disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{signingIn ? 'Membuka...' : 'Login Admin'}</span>
            </button>
          </>
        )}
      </div>

      {(authError || (formError && adminView !== 'add')) && !(currentUser && isAdmin) && (
        <p className="text-xs text-amber-200 text-right">{authError || formError}</p>
      )}

      {/* Lightbox Foto Ukuran Penuh */}
      {activePhoto && activePhotoIndex !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={activePhoto.title}
          onClick={() => setActivePhotoIndex(null)}
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-3 sm:p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-3xl flex flex-col items-center gap-3"
          >
            <div className="w-full flex items-center justify-between text-xs sm:text-sm text-white/90">
              <span className="truncate pr-3 font-medium">
                {activePhotoIndex + 1} / {photoEntries.length} · {activePhoto.title}
              </span>
              <button
                type="button"
                onClick={() => setActivePhotoIndex(null)}
                aria-label="Tutup foto"
                className="h-9 w-9 rounded-full bg-white/15 hover:bg-white/25 text-white inline-flex items-center justify-center shrink-0 cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="relative w-full flex items-center justify-center">
              {photoEntries.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setActivePhotoIndex((prev) =>
                      prev === null
                        ? null
                        : (prev - 1 + photoEntries.length) % photoEntries.length,
                    )
                  }
                  aria-label="Foto sebelumnya"
                  className="absolute left-1 sm:left-2 z-10 h-10 w-10 rounded-full bg-black/55 hover:bg-black/80 text-white inline-flex items-center justify-center cursor-pointer"
                >
                  <ChevronLeft className="w-5 h-5" aria-hidden="true" />
                </button>
              )}

              <img
                src={activePhoto.fullUrl}
                alt={activePhoto.title}
                referrerPolicy="no-referrer"
                className="max-h-[75dvh] w-auto max-w-full rounded-xl object-contain bg-black/40 shadow-2xl"
              />

              {photoEntries.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setActivePhotoIndex((prev) =>
                      prev === null ? null : (prev + 1) % photoEntries.length,
                    )
                  }
                  aria-label="Foto berikutnya"
                  className="absolute right-1 sm:right-2 z-10 h-10 w-10 rounded-full bg-black/55 hover:bg-black/80 text-white inline-flex items-center justify-center cursor-pointer"
                >
                  <ChevronRight className="w-5 h-5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
