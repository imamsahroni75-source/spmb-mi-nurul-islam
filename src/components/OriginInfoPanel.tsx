import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {LogIn, LogOut, Minus, Plus, School, Trash2, Users} from 'lucide-react';
import {type FormEvent, useEffect, useState} from 'react';
import {db, handleFirestoreError, OperationType} from '../firebase';
import {type AdminAuthState} from '../hooks/useAdminAuth';

export type SchoolType = 'TK' | 'RA' | 'Lainnya';

export interface OriginSchoolRecord {
  id: string;
  schoolName: string;
  schoolType: SchoolType;
  studentCount: number;
}

interface RegistrantRecord {
  id: string;
  studentName: string;
  schoolName: string;
  schoolType: SchoolType;
  originSchoolId: string;
  studentCount: number;
}

interface OriginInfoPanelProps {
  schools: OriginSchoolRecord[];
  totalStudents: number;
  loading: boolean;
  loadError: string | null;
  adminAuth: AdminAuthState;
}

function buildOriginSchoolId(schoolType: SchoolType, schoolName: string): string {
  const base = schoolName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return `${schoolType.toLowerCase()}-${base || 'sekolah'}`.slice(0, 120);
}

function buildRegistrantId(studentName: string): string {
  const base = studentName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return `${base || 'pendaftar'}-${suffix}`.slice(0, 120);
}

export function OriginInfoPanel({
  schools,
  totalStudents,
  loading,
  loadError,
  adminAuth,
}: OriginInfoPanelProps) {
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

  const [adminListTab, setAdminListTab] = useState<'schools' | 'registrants'>('schools');
  const [registrants, setRegistrants] = useState<RegistrantRecord[]>([]);
  const [showAddForm, setShowAddForm] = useState<boolean>(false);
  const [studentName, setStudentName] = useState<string>('');
  const [schoolName, setSchoolName] = useState<string>('');
  const [schoolType, setSchoolType] = useState<SchoolType>('RA');
  const [studentCountInput, setStudentCountInput] = useState<string>('1');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      setShowAddForm(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      setRegistrants([]);
      setAdminListTab('schools');
      return;
    }

    const registrantsQuery = query(
      collection(db, 'registrants'),
      where('studentCount', '>=', 1),
      orderBy('studentCount', 'desc'),
    );

    const unsubscribe = onSnapshot(
      registrantsQuery,
      (snapshot) => {
        const items: RegistrantRecord[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          const rawType = data.schoolType;
          const type: SchoolType =
            rawType === 'TK' || rawType === 'RA' || rawType === 'Lainnya' ? rawType : 'Lainnya';

          return {
            id: docSnap.id,
            studentName: typeof data.studentName === 'string' ? data.studentName : '-',
            schoolName: typeof data.schoolName === 'string' ? data.schoolName : '-',
            schoolType: type,
            originSchoolId: typeof data.originSchoolId === 'string' ? data.originSchoolId : '',
            studentCount: typeof data.studentCount === 'number' ? data.studentCount : 1,
          };
        });
        setRegistrants(items);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'registrants');
      },
    );

    return () => unsubscribe();
  }, [isAdmin]);

  async function handleAdminSignIn() {
    setFormError(null);
    await signInAdmin();
  }

  async function handleAdminSignOut() {
    setFormError(null);
    setShowAddForm(false);
    await signOutAdmin();
  }

  async function handleAddRegistrant(event: FormEvent) {
    event.preventDefault();
    if (!currentUser || !isAdmin) return;

    const trimmedStudent = studentName.trim();
    const trimmedSchool = schoolName.trim();
    const parsedCount = Number.parseInt(studentCountInput, 10);

    if (trimmedStudent.length < 2 || trimmedStudent.length > 100) {
      setFormError('Nama pendaftar harus 2–100 karakter.');
      return;
    }
    if (trimmedSchool.length < 2 || trimmedSchool.length > 100) {
      setFormError('Nama TK/RA harus 2–100 karakter.');
      return;
    }
    if (!Number.isInteger(parsedCount) || parsedCount < 1 || parsedCount > 5000) {
      setFormError('Jumlah siswa harus bilangan bulat 1–5000.');
      return;
    }

    setFormError(null);
    setSubmitting(true);

    const matchedSchool = schools.find(
      (item) =>
        item.schoolType === schoolType &&
        item.schoolName.trim().toLowerCase() === trimmedSchool.toLowerCase(),
    );
    const originSchoolId = matchedSchool
      ? matchedSchool.id
      : buildOriginSchoolId(schoolType, trimmedSchool);
    const registrantId = buildRegistrantId(trimmedStudent);

    try {
      const originRef = doc(db, 'origin_schools', originSchoolId);
      const originSnap = matchedSchool ? null : await getDoc(originRef);

      const batch = writeBatch(db);
      const registrantRef = doc(db, 'registrants', registrantId);

      if (matchedSchool) {
        batch.update(originRef, {
          studentCount: Math.min(5000, matchedSchool.studentCount + parsedCount),
          updatedBy: currentUser.uid,
          updatedAt: serverTimestamp(),
        });
      } else if (originSnap && originSnap.exists()) {
        const currentCount =
          typeof originSnap.data().studentCount === 'number' ? originSnap.data().studentCount : 0;
        batch.update(originRef, {
          studentCount: Math.min(5000, currentCount + parsedCount),
          updatedBy: currentUser.uid,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(originRef, {
          schoolName: trimmedSchool,
          schoolType,
          studentCount: parsedCount,
          updatedBy: currentUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      batch.set(registrantRef, {
        studentName: trimmedStudent,
        schoolName: matchedSchool ? matchedSchool.schoolName : trimmedSchool,
        schoolType,
        originSchoolId,
        studentCount: parsedCount,
        createdBy: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await batch.commit();

      setStudentName('');
      setSchoolName('');
      setStudentCountInput('1');
      setShowAddForm(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `registrants/${registrantId}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStepCount(school: OriginSchoolRecord, delta: number) {
    if (!currentUser || !isAdmin) return;
    const nextCount = Math.max(0, Math.min(5000, school.studentCount + delta));
    if (nextCount === school.studentCount) return;

    const path = `origin_schools/${school.id}`;
    setBusyId(school.id);
    try {
      await updateDoc(doc(db, 'origin_schools', school.id), {
        studentCount: nextCount,
        updatedBy: currentUser.uid,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteSchool(schoolId: string) {
    if (!currentUser || !isAdmin) return;
    const path = `origin_schools/${schoolId}`;
    setBusyId(schoolId);
    try {
      await deleteDoc(doc(db, 'origin_schools', schoolId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteRegistrant(reg: RegistrantRecord) {
    if (!currentUser || !isAdmin) return;
    const path = `registrants/${reg.id}`;
    setBusyId(reg.id);
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'registrants', reg.id));

      const linkedSchool = schools.find((s) => s.id === reg.originSchoolId);
      if (linkedSchool) {
        const decremented = Math.max(0, linkedSchool.studentCount - reg.studentCount);
        batch.update(doc(db, 'origin_schools', reg.originSchoolId), {
          studentCount: decremented,
          updatedBy: currentUser.uid,
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Ringkasan Total Siswa Terdaftar */}
      <div className="rounded-xl bg-[#FBF9F5] px-4 py-3.5 sm:px-5 sm:py-4 text-[#1C1917] shadow-sm flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-stone-600">Total Pendaftar Saat Ini</p>
          <p className="mt-0.5 text-[11px] sm:text-xs text-stone-500">
            <span>{schools.length} asal TK / RA terdata</span>
          </p>
        </div>
        <div className="text-right shrink-0">
          <span className="font-sans font-bold tabular-nums text-3xl sm:text-4xl leading-none text-[#114226]">
            {loading ? '—' : totalStudents}
          </span>
          <span className="ml-1.5 text-xs font-medium text-stone-600">Siswa</span>
        </div>
      </div>

      {/* Daftar Asal TK / RA */}
      <div className="rounded-xl bg-black/20 border border-white/15 px-3.5 py-3">
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/10">
          {isAdmin ? (
            <div className="flex items-center gap-3 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setAdminListTab('schools')}
                className={`inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                  adminListTab === 'schools'
                    ? 'text-amber-200'
                    : 'text-emerald-100/65 hover:text-white'
                }`}
              >
                <School className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Asal TK/RA</span>
              </button>
              <button
                type="button"
                onClick={() => setAdminListTab('registrants')}
                className={`inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                  adminListTab === 'registrants'
                    ? 'text-amber-200'
                    : 'text-emerald-100/65 hover:text-white'
                }`}
              >
                <Users className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Daftar Nama ({registrants.length})</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-200">
              <School className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Rincian Asal TK / RA</span>
            </div>
          )}

          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setShowAddForm((prev) => !prev);
                setFormError(null);
              }}
              className="text-xs font-medium text-amber-200 hover:text-white underline underline-offset-2 whitespace-nowrap shrink-0"
            >
              {showAddForm ? 'Tutup' : '+ Tambah'}
            </button>
          )}
        </div>

        {showAddForm && isAdmin && (
          <form
            onSubmit={handleAddRegistrant}
            className="mt-2.5 pb-3 border-b border-white/15 space-y-2"
          >
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <input
                type="text"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder="Nama"
                maxLength={100}
                required
                aria-label="Nama pendaftar"
                className="sm:col-span-6 rounded-lg bg-white/95 text-[#1C1917] placeholder:text-stone-400 px-3 py-2 text-xs focus:outline-2 focus:outline-amber-300"
              />
              <input
                type="text"
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
                placeholder="Nama TK / RA asal"
                maxLength={100}
                required
                aria-label="Nama TK atau RA asal"
                className="sm:col-span-6 rounded-lg bg-white/95 text-[#1C1917] placeholder:text-stone-400 px-3 py-2 text-xs focus:outline-2 focus:outline-amber-300"
              />
              <select
                value={schoolType}
                onChange={(e) => setSchoolType(e.target.value as SchoolType)}
                aria-label="Kategori lembaga"
                className="sm:col-span-6 rounded-lg bg-white/95 text-[#1C1917] px-2.5 py-2 text-xs focus:outline-2 focus:outline-amber-300"
              >
                <option value="RA">RA</option>
                <option value="TK">TK</option>
                <option value="Lainnya">Lainnya</option>
              </select>
              <input
                type="number"
                min={1}
                max={5000}
                value={studentCountInput}
                onChange={(e) => setStudentCountInput(e.target.value)}
                aria-label="Jumlah siswa"
                className="sm:col-span-6 rounded-lg bg-white/95 text-[#1C1917] px-2.5 py-2 text-xs tabular-nums focus:outline-2 focus:outline-amber-300"
              />
            </div>
            {formError && <p className="text-xs text-amber-200">{formError}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[40px] rounded-lg bg-[#F2C94C] hover:bg-[#E7BD3D] disabled:opacity-60 text-[#0B2B18] text-xs font-semibold transition-colors"
            >
              {submitting ? 'Menyimpan...' : 'Simpan Data Pendaftar'}
            </button>
          </form>
        )}

        {adminListTab === 'registrants' && isAdmin ? (
          registrants.length === 0 ? (
            <p className="py-5 text-center text-xs text-emerald-100/75">
              Belum ada catatan nama pendaftar individu.
            </p>
          ) : (
            <ul className="divide-y divide-white/10 max-h-44 sm:max-h-52 overflow-y-auto pr-1">
              {registrants.map((reg) => (
                <li
                  key={reg.id}
                  className="py-2 flex items-center justify-between gap-2 text-xs sm:text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-white truncate">{reg.studentName}</p>
                    <p className="text-[11px] text-emerald-100/70 truncate">
                      {reg.schoolName} · {reg.schoolType}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="font-semibold tabular-nums text-amber-200">
                      {reg.studentCount} siswa
                    </span>
                    <button
                      type="button"
                      disabled={busyId === reg.id}
                      onClick={() => void handleDeleteRegistrant(reg)}
                      aria-label={`Hapus ${reg.studentName}`}
                      className="h-7 w-7 inline-flex items-center justify-center rounded-md text-emerald-100/70 hover:text-white hover:bg-white/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : loading ? (
          <p className="py-5 text-center text-xs text-emerald-100/75">
            Memuat data pendaftar...
          </p>
        ) : loadError ? (
          <p className="py-5 text-center text-xs text-amber-200">{loadError}</p>
        ) : schools.length === 0 ? (
          <p className="py-5 text-center text-xs text-emerald-100/75">
            Belum ada data pendaftar dan asal TK/RA yang dicatat.
          </p>
        ) : (
          <ul className="divide-y divide-white/10 max-h-44 sm:max-h-52 overflow-y-auto pr-1">
            {schools.map((school) => (
              <li
                key={school.id}
                className="py-2 flex items-center justify-between gap-2 text-xs sm:text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium text-white truncate">{school.schoolName}</p>
                  <p className="text-[11px] text-emerald-100/70">{school.schoolType}</p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        disabled={busyId === school.id || school.studentCount <= 0}
                        onClick={() => void handleStepCount(school, -1)}
                        aria-label={`Kurangi jumlah siswa ${school.schoolName}`}
                        className="h-7 w-7 inline-flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white transition-colors"
                      >
                        <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        disabled={busyId === school.id}
                        onClick={() => void handleStepCount(school, 1)}
                        aria-label={`Tambah jumlah siswa ${school.schoolName}`}
                        className="h-7 w-7 inline-flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </>
                  )}

                  <span className="min-w-[4.5ch] text-right font-semibold tabular-nums text-amber-200">
                    {school.studentCount} siswa
                  </span>

                  {isAdmin && (
                    <button
                      type="button"
                      disabled={busyId === school.id}
                      onClick={() => void handleDeleteSchool(school.id)}
                      aria-label={`Hapus ${school.schoolName}`}
                      className="ml-1 h-7 w-7 inline-flex items-center justify-center rounded-md text-emerald-100/70 hover:text-white hover:bg-white/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Akses Admin Panitia (Google Sign-In) */}
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
              {checkingAdmin ? 'Memeriksa akun...' : 'Data diperbarui oleh panitia SPMB'}
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

      {(authError || (formError && !showAddForm)) && !(currentUser && isAdmin) && (
        <p className="text-xs text-amber-200 text-right">{authError || formError}</p>
      )}
    </div>
  );
}
