/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {onAuthStateChanged, type User} from 'firebase/auth';
import {collection, onSnapshot, orderBy, query, where} from 'firebase/firestore';
import {ArrowLeft, Images, MessageCircle, Users} from 'lucide-react';
import {AnimatePresence, motion, MotionConfig} from 'motion/react';
import {useEffect, useMemo, useState} from 'react';
import {GalleryPanel, type GalleryLinkRecord} from './components/GalleryPanel';
import {OriginInfoPanel, type OriginSchoolRecord, type SchoolType} from './components/OriginInfoPanel';
import {auth, db, handleFirestoreError, OperationType} from './firebase';

const DEFAULT_TARGET_ISO = '2026-12-08T08:00:00+07:00';
const BANNER_IMAGE_SRC = `${import.meta.env.BASE_URL}assets/aistudio/Desain_tanpa_judul_20261123_195255_0000_9eb0f220.jpg`;
const ADMIN_WHATSAPP_URL =
  'https://wa.me/6285187232455?text=Assalamu%27alaikum%2C%20saya%20ingin%20bertanya%20mengenai%20pendaftaran%20SPMB%20MI%20Nurul%20Islam%20Gedangmas.';

type ActiveMenu = 'countdown' | 'info' | 'gallery';

interface TimeBreakdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isOpened: boolean;
}

function resolveTargetDate(): Date {
  if (typeof window === 'undefined') {
    return new Date(DEFAULT_TARGET_ISO);
  }

  const params = new URLSearchParams(window.location.search);
  const raw = params.get('tanggal') || params.get('target');
  if (!raw) {
    return new Date(DEFAULT_TARGET_ISO);
  }

  const normalized = /([+-]\d{2}:\d{2}|Z)$/i.test(raw) ? raw : `${raw}+07:00`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(DEFAULT_TARGET_ISO);
  }
  return parsed;
}

function computeRemaining(targetMs: number, nowMs: number): TimeBreakdown {
  const diff = targetMs - nowMs;
  if (diff <= 0) {
    return {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      isOpened: true,
    };
  }

  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return {
    days,
    hours,
    minutes,
    seconds,
    isOpened: false,
  };
}

function padTwo(value: number): string {
  return String(value).padStart(2, '0');
}

function formatTargetWibCompact(date: Date): string {
  const datePart = new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(date);

  const timePart = new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Jakarta',
  })
    .format(date)
    .replace(':', '.');

  return `${datePart} · ${timePart} WIB`;
}

export default function App() {
  const targetDate = useMemo(() => resolveTargetDate(), []);
  const targetMs = targetDate.getTime();
  const formattedTargetDate = useMemo(() => formatTargetWibCompact(targetDate), [targetDate]);

  const [activeMenu, setActiveMenu] = useState<ActiveMenu>('countdown');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [bannerError, setBannerError] = useState<boolean>(false);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [schools, setSchools] = useState<OriginSchoolRecord[]>([]);
  const [loadingSchools, setLoadingSchools] = useState<boolean>(true);
  const [schoolsError, setSchoolsError] = useState<string | null>(null);

  const [galleryLinks, setGalleryLinks] = useState<GalleryLinkRecord[]>([]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    const schoolsQuery = query(
      collection(db, 'origin_schools'),
      where('studentCount', '>=', 0),
      orderBy('studentCount', 'desc'),
    );

    const unsubscribeSnapshot = onSnapshot(
      schoolsQuery,
      (snapshot) => {
        const items: OriginSchoolRecord[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          const rawType = data.schoolType;
          const schoolType: SchoolType =
            rawType === 'TK' || rawType === 'RA' || rawType === 'Lainnya' ? rawType : 'Lainnya';

          return {
            id: docSnap.id,
            schoolName: typeof data.schoolName === 'string' ? data.schoolName : 'Tanpa Nama',
            schoolType,
            studentCount: typeof data.studentCount === 'number' ? data.studentCount : 0,
          };
        });
        setSchools(items);
        setLoadingSchools(false);
        setSchoolsError(null);
      },
      (error) => {
        setLoadingSchools(false);
        setSchoolsError('Gagal memuat data pendaftar.');
        handleFirestoreError(error, OperationType.LIST, 'origin_schools');
      },
    );

    return () => unsubscribeSnapshot();
  }, []);

  useEffect(() => {
    const galleryQuery = query(
      collection(db, 'gallery_links'),
      where('order', '>=', 0),
      orderBy('order', 'asc'),
    );

    const unsubscribeGallery = onSnapshot(
      galleryQuery,
      (snapshot) => {
        const items: GalleryLinkRecord[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            title: typeof data.title === 'string' ? data.title : 'Galeri Kegiatan',
            driveUrl: typeof data.driveUrl === 'string' ? data.driveUrl : '',
            description: typeof data.description === 'string' ? data.description : '',
            order: typeof data.order === 'number' ? data.order : 0,
          };
        });
        setGalleryLinks(items);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'gallery_links');
      },
    );

    return () => unsubscribeGallery();
  }, []);

  const totalStudents = useMemo(
    () => schools.reduce((sum, item) => sum + item.studentCount, 0),
    [schools],
  );

  const remaining = computeRemaining(targetMs, nowMs);

  const countdownUnits = [
    {label: 'Hari', value: String(remaining.days).padStart(2, '0')},
    {label: 'Jam', value: padTwo(remaining.hours)},
    {label: 'Menit', value: padTwo(remaining.minutes)},
    {label: 'Detik', value: padTwo(remaining.seconds)},
  ];

  return (
    <main className="relative min-h-dvh w-full bg-[radial-gradient(ellipse_at_top,_#F7F4EC_0%,_#EAE4D6_100%)] text-[#1C1917] flex items-center justify-center px-3.5 py-3 sm:px-6 sm:py-6 lg:px-12 selection:bg-[#14532D]/15 selection:text-[#14532D]">
      <div className="relative z-10 w-full max-w-md lg:max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-5 lg:gap-10 items-center">
        {/* Banner Resmi SPMB Utuh */}
        <figure className="lg:col-span-7 min-w-0">
          <div className="overflow-hidden rounded-xl sm:rounded-2xl border border-stone-300/80 bg-white shadow-md">
            {bannerError ? (
              <div className="aspect-[3/2] flex flex-col items-center justify-center px-4 py-6 text-center bg-[#F2F0EA]">
                <p className="font-serif text-lg font-semibold text-[#14532D]">
                  SPMB MI Nurul Islam Gedangmas
                </p>
                <p className="mt-1 text-xs sm:text-sm text-stone-600">
                  Tahun Pelajaran 2027/2028 · Gelombang 1: 8–9 Des 2026
                </p>
              </div>
            ) : (
              <img
                src={BANNER_IMAGE_SRC}
                alt="Banner resmi SPMB MI Nurul Islam Gedangmas Tahun Pelajaran 2027/2028"
                referrerPolicy="no-referrer"
                onError={() => setBannerError(true)}
                className="w-full h-auto block object-contain"
              />
            )}
          </div>
        </figure>

        {/* Panel Kanan: Menu + Logo Bebas di Atas Tulisan SPMB, Hitung Mundur & Info Pendaftar */}
        <section
          aria-label="Informasi dan Hitung Mundur SPMB MI Nurul Islam Gedangmas"
          className="relative overflow-hidden lg:col-span-5 min-w-0 w-full rounded-xl sm:rounded-2xl border border-[#D4AF37]/30 bg-gradient-to-br from-[#124729] via-[#0E3920] to-[#082414] text-white p-4 sm:p-6 lg:p-8 shadow-lg"
        >
          {/* Motif geometris Islami sangat halus agar tulisan tetap fokus */}
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.06]"
          >
            <defs>
              <pattern id="islamic-tile" width="48" height="48" patternUnits="userSpaceOnUse">
                <path
                  d="M24 2L29.5 18.5L46 24L29.5 29.5L24 46L18.5 29.5L2 24L18.5 18.5Z"
                  fill="none"
                  stroke="#FDE68A"
                  strokeWidth="1"
                />
                <circle cx="24" cy="24" r="4" fill="none" stroke="#FDE68A" strokeWidth="0.9" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#islamic-tile)" />
          </svg>

          {/* Cahaya lembut di sudut atas */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-20 -right-20 h-56 w-56 rounded-full bg-amber-300/10 blur-2xl"
          />

          <div className="relative z-10 min-w-0">
            {/* 2 Ikon Kecil di Atas Tulisan SPMB: Info jumlah Pendaftar & Galeri */}
            <nav
              aria-label="Menu informasi SPMB"
              className="mb-2.5 flex items-start justify-center gap-6 sm:gap-10"
            >
              <button
                type="button"
                onClick={() =>
                  setActiveMenu((prev) => (prev === 'info' ? 'countdown' : 'info'))
                }
                aria-pressed={activeMenu === 'info'}
                className="group inline-flex flex-col items-center gap-1 min-w-[44px] min-h-[44px] rounded-lg px-1 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
              >
                <span
                  className={`w-9 h-9 rounded-full inline-flex items-center justify-center border transition-all duration-200 ease-out group-hover:scale-105 group-active:scale-95 ${
                    activeMenu === 'info'
                      ? 'bg-[#F2C94C] border-[#F2C94C] text-[#0B2B18] shadow-sm'
                      : 'bg-[#0B2B18]/90 border-[#F2C94C]/75 text-[#F2C94C] group-hover:border-[#F2C94C]'
                  }`}
                >
                  <Users className="w-4 h-4" aria-hidden="true" />
                </span>
                <span
                  className={`text-[11px] sm:text-xs font-medium leading-tight text-center whitespace-nowrap transition-colors ${
                    activeMenu === 'info'
                      ? 'text-[#F2C94C]'
                      : 'text-amber-100/90 group-hover:text-white'
                  }`}
                >
                  Info Pendaftar
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setActiveMenu((prev) => (prev === 'gallery' ? 'countdown' : 'gallery'))
                }
                aria-pressed={activeMenu === 'gallery'}
                className="group inline-flex flex-col items-center gap-1 min-w-[44px] min-h-[44px] rounded-lg px-1 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
              >
                <span
                  className={`w-9 h-9 rounded-full inline-flex items-center justify-center border transition-all duration-200 ease-out group-hover:scale-105 group-active:scale-95 ${
                    activeMenu === 'gallery'
                      ? 'bg-[#F2C94C] border-[#F2C94C] text-[#0B2B18] shadow-sm'
                      : 'bg-[#0B2B18]/90 border-[#F2C94C]/75 text-[#F2C94C] group-hover:border-[#F2C94C]'
                  }`}
                >
                  <Images className="w-4 h-4" aria-hidden="true" />
                </span>
                <span
                  className={`text-[11px] sm:text-xs font-medium leading-tight text-center whitespace-nowrap transition-colors ${
                    activeMenu === 'gallery'
                      ? 'text-[#F2C94C]'
                      : 'text-amber-100/90 group-hover:text-white'
                  }`}
                >
                  Galeri
                </span>
              </button>
            </nav>

            {/* Judul: SPMB Tebal di Paling Atas, MI NURUL ISLAM GEDANGMAS di Bawahnya */}
            <div className="text-center">
              <h1 className="leading-tight [text-wrap:balance]">
                <span className="block font-sans font-bold text-2xl sm:text-3xl lg:text-4xl tracking-wider text-[#F2C94C]">
                  SPMB
                </span>
                <span className="mt-0.5 block font-serif font-semibold text-base sm:text-xl lg:text-[1.4rem] tracking-wide text-white">
                  MI NURUL ISLAM GEDANGMAS
                </span>
              </h1>
              <p className="mt-1 text-xs sm:text-sm font-medium text-emerald-100/85">
                {activeMenu === 'info' ? (
                  'Data Pendaftar & Asal TK / RA'
                ) : activeMenu === 'gallery' ? (
                  'Galeri Kegiatan Madrasah'
                ) : remaining.isOpened ? (
                  'Pendaftaran Gelombang 1 Resmi Dibuka'
                ) : (
                  <>
                    <span>Hitung Mundur Gelombang 1</span>
                    <span aria-hidden="true" className="mx-1.5 text-white/35">
                      ·
                    </span>
                    <span>2027/2028</span>
                  </>
                )}
              </p>
            </div>

            <div className="my-3 sm:my-4 border-t border-white/15" aria-hidden="true" />

            {activeMenu === 'info' ? (
              <div className="space-y-2.5">
                <OriginInfoPanel
                  schools={schools}
                  totalStudents={totalStudents}
                  loading={loadingSchools}
                  loadError={schoolsError}
                  currentUser={currentUser}
                />
                <div className="flex justify-center pt-0.5">
                  <button
                    type="button"
                    onClick={() => setActiveMenu('countdown')}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-200/90 hover:text-white transition-colors cursor-pointer py-1 px-2"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Kembali ke Hitung Mundur</span>
                  </button>
                </div>
              </div>
            ) : activeMenu === 'gallery' ? (
              <div className="space-y-2.5">
                <GalleryPanel
                  extraItems={galleryLinks}
                  currentUser={currentUser}
                />
                <div className="flex justify-center pt-0.5">
                  <button
                    type="button"
                    onClick={() => setActiveMenu('countdown')}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-200/90 hover:text-white transition-colors cursor-pointer py-1 px-2"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Kembali ke Hitung Mundur</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                {remaining.isOpened ? (
                  <div className="rounded-xl bg-[#FBF9F5] px-4 py-4 sm:py-5 text-center shadow-sm">
                    <p className="font-serif text-lg sm:text-2xl font-semibold text-[#14532D]">
                      SPMB Gelombang 1 Dibuka
                    </p>
                    <p className="mt-1 text-xs sm:text-sm text-stone-700">
                      Pendaftaran dimulai sejak {formattedTargetDate}.
                    </p>
                  </div>
                ) : (
                  <MotionConfig reducedMotion="user">
                    <div
                      role="timer"
                      aria-live="off"
                      aria-label={`Sisa waktu ${remaining.days} hari, ${remaining.hours} jam, ${remaining.minutes} menit, ${remaining.seconds} detik`}
                      className="grid grid-cols-4 gap-2 sm:gap-3"
                    >
                      {countdownUnits.map((unit) => (
                        <div
                          key={unit.label}
                          className="bg-[#FBF9F5] rounded-lg sm:rounded-xl py-2.5 sm:py-4 px-1.5 flex flex-col items-center justify-center text-center shadow-sm"
                        >
                          <div className="relative h-[1.05em] w-full overflow-hidden flex items-center justify-center font-sans font-bold tabular-nums text-2xl sm:text-3xl lg:text-[2.15rem] leading-none tracking-tight text-[#114226]">
                            <AnimatePresence mode="popLayout" initial={false}>
                              <motion.span
                                key={unit.value}
                                initial={{opacity: 0, y: 6}}
                                animate={{opacity: 1, y: 0}}
                                exit={{opacity: 0, y: -6}}
                                transition={{duration: 0.2, ease: [0.16, 1, 0.3, 1]}}
                                className="inline-block"
                              >
                                {unit.value}
                              </motion.span>
                            </AnimatePresence>
                          </div>
                          <span className="mt-1.5 text-[11px] sm:text-xs font-medium text-stone-600">
                            {unit.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </MotionConfig>
                )}

                <div className="mt-3 sm:mt-4 flex flex-col gap-1 text-xs sm:text-sm text-emerald-50/85 border-t border-white/15 pt-3 sm:pt-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-emerald-100/75 shrink-0">Gelombang 1</span>
                    <time
                      dateTime={targetDate.toISOString()}
                      className="font-medium text-white text-right"
                    >
                      8 – 9 Desember 2026
                    </time>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-emerald-100/75 shrink-0">Gelombang 2</span>
                    <span className="font-medium text-emerald-50/95 text-right">
                      1 Maret – 31 Mei 2027
                    </span>
                  </div>
                </div>

                <div className="mt-3.5 sm:mt-5">
                  <a
                    href={ADMIN_WHATSAPP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#F2C94C] hover:bg-[#E7BD3D] hover:scale-[1.02] hover:shadow-md active:scale-[0.98] motion-reduce:transform-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200 px-4 py-2.5 text-sm font-semibold text-[#0B2B18] transition-all duration-200 ease-out whitespace-nowrap shrink-0 shadow-sm"
                  >
                    <MessageCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Hubungi Admin · 085187232455</span>
                  </a>
                </div>

                {/* Teks Berjalan Pengumuman Resmi */}
                <div
                  aria-label="Pengumuman resmi pendaftaran"
                  className="mt-2.5 sm:mt-3 h-8 w-full min-w-0 rounded-lg bg-black/25 border border-white/15 px-3 flex items-center overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_5%,black_95%,transparent)]"
                >
                  <motion.div
                    animate={{x: ['0%', '-50%']}}
                    transition={{duration: 24, repeat: Infinity, ease: 'linear'}}
                    className="flex w-max items-center text-xs font-medium text-amber-100/95 whitespace-nowrap will-change-transform"
                  >
                    <span className="pr-12">
                      Pendaftaran Siswa Baru MI Nurul Islam Gedangmas dilakukan secara offline,
                      Formulir yang Sah disediakan pada waktu Pendaftaran Berlangsung bukan
                      mendapatkan dari luar/ foto copyan. Semua diperlakukan sama tanpa ada
                      perlakuan Khusus
                    </span>
                    <span aria-hidden="true" className="pr-12">
                      Pendaftaran Siswa Baru MI Nurul Islam Gedangmas dilakukan secara offline,
                      Formulir yang Sah disediakan pada waktu Pendaftaran Berlangsung bukan
                      mendapatkan dari luar/ foto copyan. Semua diperlakukan sama tanpa ada
                      perlakuan Khusus
                    </span>
                  </motion.div>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
