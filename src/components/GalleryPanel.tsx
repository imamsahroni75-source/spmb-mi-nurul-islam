import {deleteDoc, doc, serverTimestamp, writeBatch} from 'firebase/firestore';
import {ChevronLeft, ChevronRight, Images, LogIn, LogOut, Trash2, X} from 'lucide-react';
import {type FormEvent, useEffect, useMemo, useState} from 'react';
import {db, handleFirestoreError, OperationType} from '../firebase';
import {type AdminAuthState} from '../hooks/useAdminAuth';

export interface GalleryLinkRecord {
  id: string;
  title: string;
  driveUrl: string;
  description: string;
  order: number;
}

type ResolvedGalleryEntry =
  | {
      kind: 'photo';
      id: string;
      title: string;
      rawUrl: string;
      thumbUrl: string;
      fullUrl: string;
    }
  | {
      kind: 'folder';
      id: string;
      title: string;
      rawUrl: string;
      folderId: string;
    };

interface GalleryPanelProps {
  items: GalleryLinkRecord[];
  loading: boolean;
  loadError: string | null;
  adminAuth: AdminAuthState;
}

const INITIAL_VISIBLE_COUNT = 15;
const LOAD_MORE_STEP = 18;

function resolveGalleryEntry(item: GalleryLinkRecord): ResolvedGalleryEntry | null {
  const trimmed = item.driveUrl.trim();
  if (!/^https:\/\/\S+$/i.test(trimmed)) return null;

  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch && folderMatch[1]) {
    return {
      kind: 'folder',
      id: item.id,
      title: item.title || 'Galeri Kegiatan',
      rawUrl: trimmed,
      folderId: folderMatch[1],
    };
  }

  const fileMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  const lhMatch = trimmed.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);

  const fileId =
    fileMatch?.[1] || (trimmed.includes('drive.google.com') ? idMatch?.[1] : null) || lhMatch?.[1];
  if (fileId) {
    return {
      kind: 'photo',
      id: item.id,
      title: item.title || 'Dokumentasi Kegiatan',
      rawUrl: trimmed,
      thumbUrl: `https://lh3.googleusercontent.com/d/${fileId}=w400`,
      fullUrl: `https://lh3.googleusercontent.com/d/${fileId}=w1200`,
    };
  }

  return {
    kind: 'photo',
    id: item.id,
    title: item.title || 'Dokumentasi Kegiatan',
    rawUrl: trimmed,
    thumbUrl: trimmed,
    fullUrl: trimmed,
  };
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

  const [visibleCount, setVisibleCount] = useState<number>(INITIAL_VISIBLE_COUNT);
  const [activePhotoIndex, setActivePhotoIndex] = useState<number | null>(null);
  const [failedIds, setFailedIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isAdmin) {
      setAdminView('none');
    }
  }, [isAdmin]);

  const resolvedEntries = useMemo(() => {
    const entries: ResolvedGalleryEntry[] = [];
    for (const item of items) {
      const resolved = resolveGalleryEntry(item);
      if (resolved) {
        entries.push(resolved);
      }
    }
    return entries;
  }, [items]);

  const photoEntries = useMemo(
    () =>
      resolvedEntries.filter(
        (entry): entry is Extract<ResolvedGalleryEntry, {kind: 'photo'}> => entry.kind === 'photo',
      ),
    [resolvedEntries],
  );

  const folderEntries = useMemo(
    () =>
      resolvedEntries.filter(
        (entry): entry is Extract<ResolvedGalleryEntry, {kind: 'folder'}> =>
          entry.kind === 'folder',
      ),
    [resolvedEntries],
  );

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
    await signOutAdmin();
  }

  async function handleAddLink(event: FormEvent) {
    event.preventDefault();
    if (!currentUser || !isAdmin) return;

    const trimmedTitle = title.trim();
    const rawLines = linkUrl
      .split(/[\r\n]+/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (trimmedTitle.length < 2 || trimmedTitle.length > 80) {
      setFormError('Judul harus 2–80 karakter.');
      return;
    }
    if (rawLines.length === 0 || rawLines.length > 25) {
      setFormError('Masukkan 1 hingga 25 link yang valid.');
      return;
    }
    for (const url of rawLines) {
      if (url.length < 12 || url.length > 500 || !/^https:\/\/\S+$/i.test(url)) {
        setFormError('Setiap link harus valid (diawali https:// tanpa spasi).');
        return;
      }
    }

    setFormError(null);
    setSubmitting(true);

    const startOrder = items.reduce((max, item) => Math.max(max, item.order), -1) + 1;
    const batch = writeBatch(db);

    try {
      rawLines.forEach((url, index) => {
        const entryTitle =
          rawLines.length > 1
            ? `${trimmedTitle} #${index + 1}`.slice(0, 80)
            : trimmedTitle;
        const docId = buildPhotoDocId(entryTitle);
        batch.set(doc(db, 'gallery_links', docId), {
          title: entryTitle,
          driveUrl: url,
          description: '',
          order: Math.min(1000, startOrder + index),
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
      handleFirestoreError(error, OperationType.WRITE, 'gallery_links');
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

  const activePhoto = activePhotoIndex !== null ? photoEntries[activePhotoIndex] ?? null : null;

  return (
    <div className="space-y-3 sm:space-y-3.5">
      <div className="rounded-xl bg-black/20 border border-white/15 px-3 py-3">
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/10">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-200">
            <Images className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Galeri Kegiatan</span>
          </div>

          {isAdmin && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setAdminView((prev) => (prev === 'add' ? 'none' : 'add'));
                  setFormError(null);
                }}
                className="text-xs font-medium text-amber-200 hover:text-white underline underline-offset-2 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {adminView === 'add' ? 'Tutup' : '+ Tambah Link'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdminView((prev) => (prev === 'manage' ? 'none' : 'manage'));
                  setFormError(null);
                }}
                className="text-xs font-medium text-amber-200 hover:text-white underline underline-offset-2 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {adminView === 'manage' ? 'Lihat Galeri' : `Hapus Link (${items.length})`}
              </button>
            </div>
          )}
        </div>

        {/* Form Tambah Link (Khusus Admin) */}
        {adminView === 'add' && isAdmin && (
          <form onSubmit={handleAddLink} className="mt-2.5 pb-3 border-b border-white/15 space-y-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Judul foto / album"
              maxLength={80}
              required
              aria-label="Judul foto atau album"
              className="w-full rounded-lg bg-white/95 text-[#1C1917] placeholder:text-stone-400 px-3 py-2 text-xs focus:outline-2 focus:outline-amber-300"
            />
            <textarea
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="Tempel link foto atau folder Google Drive (bisa banyak link, 1 per baris)"
              rows={2}
              required
              aria-label="Link foto atau folder"
              className="w-full rounded-lg bg-white/95 text-[#1C1917] placeholder:text-stone-400 px-3 py-2 text-xs focus:outline-2 focus:outline-amber-300 resize-none"
            />
            {formError && <p className="text-xs text-amber-200">{formError}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[40px] rounded-lg bg-[#F2C94C] hover:bg-[#E7BD3D] disabled:opacity-60 text-[#0B2B18] text-xs font-semibold transition-colors cursor-pointer"
            >
              {submitting ? 'Menyimpan...' : 'Simpan Link'}
            </button>
          </form>
        )}

        {/* Menu Hapus Link (Khusus Admin) */}
        {adminView === 'manage' && isAdmin ? (
          <div className="mt-2.5">
            {items.length === 0 ? (
              <p className="py-5 text-center text-xs text-emerald-100/75">
                Belum ada link yang tersimpan.
              </p>
            ) : (
              <ul className="divide-y divide-white/10 max-h-56 sm:max-h-64 overflow-y-auto pr-1">
                {items.map((item) => (
                  <li key={item.id} className="py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-white truncate">{item.title}</p>
                      <p className="text-[11px] text-emerald-100/65 truncate">{item.driveUrl}</p>
                    </div>
                    <button
                      type="button"
                      disabled={busyId === item.id}
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
        ) : loading ? (
          <p className="py-5 text-center text-xs text-emerald-100/75">Memuat galeri...</p>
        ) : loadError ? (
          <p className="py-5 text-center text-xs text-amber-200">{loadError}</p>
        ) : resolvedEntries.length === 0 ? (
          <div className="py-5 text-center space-y-1">
            <p className="text-xs text-emerald-100/80">Belum ada foto di galeri.</p>
            {isAdmin && adminView !== 'add' && (
              <p className="text-[11px] text-amber-200/90">
                Klik &ldquo;+ Tambah Link&rdquo; di atas untuk menambahkan link foto atau folder.
              </p>
            )}
          </div>
        ) : (
          <div className="mt-2.5 max-h-60 sm:max-h-72 overflow-y-auto pr-1 space-y-2.5">
            {photoEntries.length > 0 && (
              <>
                <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                  {visiblePhotos.map((photo, index) => {
                    const isFailed = failedIds[photo.id];
                    return (
                      <div
                        key={photo.id}
                        className="relative group aspect-square rounded-lg overflow-hidden bg-black/30 border border-white/10"
                      >
                        {isFailed ? (
                          <div className="w-full h-full flex items-center justify-center text-emerald-100/50">
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
                              className="w-full h-full object-cover transition-transform duration-200 ease-out group-hover:scale-105"
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
                    className="w-full min-h-[36px] rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium text-amber-100 transition-colors cursor-pointer"
                  >
                    Muat Foto Lainnya ({photoEntries.length - visibleCount} lagi)
                  </button>
                )}
              </>
            )}

            {folderEntries.map((folder) => (
              <div
                key={folder.id}
                className="relative w-full h-60 sm:h-72 overflow-hidden rounded-lg border border-white/15 bg-[#FBF9F5]"
              >
                <iframe
                  title={folder.title}
                  src={`https://drive.google.com/embeddedfolderview?id=${folder.folderId}#grid`}
                  className="w-[250%] h-[250%] origin-top-left scale-[0.4] border-0"
                  loading="lazy"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Akses Admin Panitia */}
      <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs text-emerald-100/75 pt-0.5">
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
                      prev === null ? null : (prev - 1 + photoEntries.length) % photoEntries.length,
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
