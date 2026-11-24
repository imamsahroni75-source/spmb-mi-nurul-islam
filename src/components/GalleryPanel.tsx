import {type User, signInWithPopup, signOut} from 'firebase/auth';
import {deleteDoc, doc, getDoc, serverTimestamp, setDoc} from 'firebase/firestore';
import {ChevronLeft, ChevronRight, Images, LogIn, LogOut, Trash2, X} from 'lucide-react';
import {type FormEvent, useEffect, useMemo, useState} from 'react';
import {GALLERY_PHOTO_IDS} from '../data/galleryPhotos';
import {
  auth,
  BOOTSTRAPPED_ADMIN_EMAIL,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from '../firebase';

export interface GalleryLinkRecord {
  id: string;
  title: string;
  driveUrl: string;
  description: string;
  order: number;
}

interface GalleryPhotoItem {
  id: string;
  thumbUrl: string;
  fullUrl: string;
  caption: string;
  firestoreId?: string;
}

interface GalleryPanelProps {
  extraItems: GalleryLinkRecord[];
  currentUser: User | null;
}

const INITIAL_VISIBLE_COUNT = 15;
const LOAD_MORE_STEP = 18;

function resolvePhotoUrls(rawUrl: string): {thumbUrl: string; fullUrl: string} | null {
  const trimmed = rawUrl.trim();
  if (!/^https:\/\/\S+$/i.test(trimmed)) return null;

  const fileMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  const lhMatch = trimmed.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);

  const fileId = fileMatch?.[1] || (trimmed.includes('drive.google.com') ? idMatch?.[1] : null) || lhMatch?.[1];
  if (fileId) {
    return {
      thumbUrl: `https://lh3.googleusercontent.com/d/${fileId}=w400`,
      fullUrl: `https://lh3.googleusercontent.com/d/${fileId}=w1200`,
    };
  }

  // Abaikan tautan folder karena tidak bisa dirender langsung sebagai <img>
  if (trimmed.includes('/folders/')) {
    return null;
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
  return `${base || 'foto'}-${suffix}`.slice(0, 120);
}

export function GalleryPanel({extraItems, currentUser}: GalleryPanelProps) {
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [checkingAdmin, setCheckingAdmin] = useState<boolean>(false);
  const [showAddForm, setShowAddForm] = useState<boolean>(false);
  const [title, setTitle] = useState<string>('Kegiatan MI Nurul Islam');
  const [photoUrl, setPhotoUrl] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [visibleCount, setVisibleCount] = useState<number>(INITIAL_VISIBLE_COUNT);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [failedIds, setFailedIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;

    async function verifyAdminStatus() {
      if (!currentUser) {
        setIsAdmin(false);
        return;
      }

      setFormError(null);

      if (!currentUser.emailVerified) {
        setIsAdmin(false);
        return;
      }

      if (currentUser.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()) {
        setIsAdmin(true);
        return;
      }

      setCheckingAdmin(true);
      try {
        const adminSnap = await getDoc(doc(db, 'admins', currentUser.uid));
        if (!cancelled) {
          setIsAdmin(adminSnap.exists());
        }
      } catch {
        if (!cancelled) {
          setIsAdmin(false);
        }
      } finally {
        if (!cancelled) {
          setCheckingAdmin(false);
        }
      }
    }

    void verifyAdminStatus();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const photos: GalleryPhotoItem[] = useMemo(() => {
    const dynamicPhotos: GalleryPhotoItem[] = [];
    for (const item of extraItems) {
      const resolved = resolvePhotoUrls(item.driveUrl);
      if (resolved) {
        dynamicPhotos.push({
          id: `extra-${item.id}`,
          thumbUrl: resolved.thumbUrl,
          fullUrl: resolved.fullUrl,
          caption: item.title || 'Dokumentasi Kegiatan',
          firestoreId: item.id,
        });
      }
    }

    const builtInPhotos: GalleryPhotoItem[] = GALLERY_PHOTO_IDS.map((fileId, idx) => ({
      id: fileId,
      thumbUrl: `https://lh3.googleusercontent.com/d/${fileId}=w400`,
      fullUrl: `https://lh3.googleusercontent.com/d/${fileId}=w1200`,
      caption: `Dokumentasi Kegiatan #${idx + 1}`,
    }));

    return [...dynamicPhotos, ...builtInPhotos];
  }, [extraItems]);

  const visiblePhotos = useMemo(
    () => photos.slice(0, visibleCount),
    [photos, visibleCount],
  );

  useEffect(() => {
    if (activeIndex === null) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setActiveIndex(null);
      } else if (event.key === 'ArrowRight') {
        setActiveIndex((prev) => (prev === null ? null : (prev + 1) % photos.length));
      } else if (event.key === 'ArrowLeft') {
        setActiveIndex((prev) =>
          prev === null ? null : (prev - 1 + photos.length) % photos.length,
        );
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, photos.length]);

  async function handleAdminSignIn() {
    if (signingIn) return;
    setFormError(null);
    setSigningIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      if (auth.currentUser) {
        return;
      }
      const message = error instanceof Error ? error.message : '';
      if (message.includes('popup-closed') || message.includes('cancelled-popup')) {
        setFormError('Login dibatalkan.');
      } else if (message.includes('popup-blocked')) {
        setFormError('Pop-up diblokir browser. Izinkan pop-up untuk login Google.');
      } else {
        setFormError('Gagal masuk dengan akun Google.');
      }
    } finally {
      setSigningIn(false);
    }
  }

  async function handleAdminSignOut() {
    setFormError(null);
    setShowAddForm(false);
    await signOut(auth);
  }

  async function handleAddPhoto(event: FormEvent) {
    event.preventDefault();
    if (!currentUser || !isAdmin) return;

    const trimmedTitle = title.trim();
    const trimmedUrl = photoUrl.trim();

    if (trimmedTitle.length < 2 || trimmedTitle.length > 80) {
      setFormError('Judul foto harus 2–80 karakter.');
      return;
    }

    const resolved = resolvePhotoUrls(trimmedUrl);
    if (!resolved) {
      setFormError('Masukkan link foto yang valid (diawali https://, bukan link folder).');
      return;
    }

    setFormError(null);
    setSubmitting(true);

    const docId = buildPhotoDocId(trimmedTitle);
    const nextOrder = extraItems.reduce((max, item) => Math.max(max, item.order), -1) + 1;

    try {
      await setDoc(doc(db, 'gallery_links', docId), {
        title: trimmedTitle,
        driveUrl: trimmedUrl,
        description: '',
        order: Math.min(1000, nextOrder),
        updatedBy: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setTitle('Kegiatan MI Nurul Islam');
      setPhotoUrl('');
      setShowAddForm(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `gallery_links/${docId}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeletePhoto(firestoreId: string) {
    if (!currentUser || !isAdmin) return;
    setBusyId(firestoreId);
    try {
      await deleteDoc(doc(db, 'gallery_links', firestoreId));
      setActiveIndex(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `gallery_links/${firestoreId}`);
    } finally {
      setBusyId(null);
    }
  }

  const activePhoto = activeIndex !== null ? photos[activeIndex] ?? null : null;

  return (
    <div className="space-y-3 sm:space-y-3.5">
      <div className="rounded-xl bg-black/20 border border-white/15 px-3 py-3">
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/10">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-200">
            <Images className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Foto Kegiatan ({photos.length})</span>
          </div>

          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setShowAddForm((prev) => !prev);
                setFormError(null);
              }}
              className="text-xs font-medium text-amber-200 hover:text-white underline underline-offset-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {showAddForm ? 'Tutup' : '+ Tambah Foto'}
            </button>
          )}
        </div>

        {showAddForm && isAdmin && (
          <form onSubmit={handleAddPhoto} className="mt-2.5 pb-3 border-b border-white/15 space-y-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Keterangan foto"
              maxLength={80}
              required
              aria-label="Keterangan foto"
              className="w-full rounded-lg bg-white/95 text-[#1C1917] placeholder:text-stone-400 px-3 py-2 text-xs focus:outline-2 focus:outline-amber-300"
            />
            <input
              type="url"
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              placeholder="Tempel link foto (https://...)"
              maxLength={500}
              required
              aria-label="Link foto"
              className="w-full rounded-lg bg-white/95 text-[#1C1917] placeholder:text-stone-400 px-3 py-2 text-xs focus:outline-2 focus:outline-amber-300"
            />
            {formError && <p className="text-xs text-amber-200">{formError}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[40px] rounded-lg bg-[#F2C94C] hover:bg-[#E7BD3D] disabled:opacity-60 text-[#0B2B18] text-xs font-semibold transition-colors cursor-pointer"
            >
              {submitting ? 'Menyimpan...' : 'Simpan Foto'}
            </button>
          </form>
        )}

        {/* Grid Foto Langsung */}
        <div className="mt-2.5 max-h-60 sm:max-h-72 overflow-y-auto pr-1 space-y-2.5">
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
                      onClick={() => setActiveIndex(index)}
                      aria-label={`Lihat ${photo.caption}`}
                      className="w-full h-full block cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-200"
                    >
                      <img
                        src={photo.thumbUrl}
                        alt={photo.caption}
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

                  {isAdmin && photo.firestoreId && (
                    <button
                      type="button"
                      disabled={busyId === photo.firestoreId}
                      onClick={() => void handleDeletePhoto(photo.firestoreId!)}
                      aria-label={`Hapus ${photo.caption}`}
                      className="absolute top-1 right-1 h-6 w-6 rounded-md bg-black/65 text-white hover:bg-black/85 inline-flex items-center justify-center cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {visibleCount < photos.length && (
            <button
              type="button"
              onClick={() =>
                setVisibleCount((prev) => Math.min(photos.length, prev + LOAD_MORE_STEP))
              }
              className="w-full min-h-[36px] rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium text-amber-100 transition-colors cursor-pointer"
            >
              Muat Foto Lainnya ({photos.length - visibleCount} lagi)
            </button>
          )}
        </div>
      </div>

      {/* Akses Admin Panitia */}
      <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs text-emerald-100/75 pt-0.5">
        {currentUser ? (
          <>
            <span className="truncate">
              {checkingAdmin
                ? 'Memeriksa akses...'
                : isAdmin
                  ? `Admin: ${currentUser.email}`
                  : `Masuk sebagai ${currentUser.email} (bukan admin)`}
            </span>
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
            <span>Dokumentasi MI Nurul Islam Gedangmas</span>
            <button
              type="button"
              disabled={signingIn}
              onClick={() => void handleAdminSignIn()}
              className="inline-flex items-center gap-1 text-amber-200 hover:text-white disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{signingIn ? 'Membuka...' : 'Login Admin'}</span>
            </button>
          </>
        )}
      </div>

      {formError && !showAddForm && !currentUser && (
        <p className="text-xs text-amber-200 text-right">{formError}</p>
      )}

      {/* Lightbox Foto Ukuran Penuh */}
      {activePhoto && activeIndex !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={activePhoto.caption}
          onClick={() => setActiveIndex(null)}
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-3 sm:p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-3xl flex flex-col items-center gap-3"
          >
            <div className="w-full flex items-center justify-between text-xs sm:text-sm text-white/90">
              <span className="truncate pr-3 font-medium">
                {activeIndex + 1} / {photos.length} · {activePhoto.caption}
              </span>
              <button
                type="button"
                onClick={() => setActiveIndex(null)}
                aria-label="Tutup foto"
                className="h-9 w-9 rounded-full bg-white/15 hover:bg-white/25 text-white inline-flex items-center justify-center shrink-0 cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="relative w-full flex items-center justify-center">
              <button
                type="button"
                onClick={() =>
                  setActiveIndex((prev) =>
                    prev === null ? null : (prev - 1 + photos.length) % photos.length,
                  )
                }
                aria-label="Foto sebelumnya"
                className="absolute left-1 sm:left-2 z-10 h-10 w-10 rounded-full bg-black/55 hover:bg-black/80 text-white inline-flex items-center justify-center cursor-pointer"
              >
                <ChevronLeft className="w-5 h-5" aria-hidden="true" />
              </button>

              <img
                src={activePhoto.fullUrl}
                alt={activePhoto.caption}
                referrerPolicy="no-referrer"
                className="max-h-[75dvh] w-auto max-w-full rounded-xl object-contain bg-black/40 shadow-2xl"
              />

              <button
                type="button"
                onClick={() =>
                  setActiveIndex((prev) => (prev === null ? null : (prev + 1) % photos.length))
                }
                aria-label="Foto berikutnya"
                className="absolute right-1 sm:right-2 z-10 h-10 w-10 rounded-full bg-black/55 hover:bg-black/80 text-white inline-flex items-center justify-center cursor-pointer"
              >
                <ChevronRight className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
