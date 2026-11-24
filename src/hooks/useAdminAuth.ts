import {onAuthStateChanged, signInWithPopup, signOut, type User} from 'firebase/auth';
import {doc, getDoc} from 'firebase/firestore';
import {useCallback, useEffect, useRef, useState} from 'react';
import {auth, BOOTSTRAPPED_ADMIN_EMAIL, db, googleProvider} from '../firebase';

export interface AdminAuthState {
  currentUser: User | null;
  isAdmin: boolean;
  checkingAdmin: boolean;
  signingIn: boolean;
  authError: string | null;
  signInAdmin: () => Promise<void>;
  signOutAdmin: () => Promise<void>;
  clearAuthError: () => void;
}

function getUserEmail(user: User): string {
  const direct = user.email?.trim();
  if (direct) return direct;
  const fromProvider = user.providerData?.find((p) => Boolean(p?.email))?.email?.trim();
  return fromProvider ?? '';
}

function buildDeniedMessage(user: User): string {
  const attemptedEmail = getUserEmail(user);
  if (attemptedEmail) {
    return `Akses ditolak untuk ${attemptedEmail}. Hanya akun Google admin terdaftar yang dapat masuk.`;
  }
  return 'Akses ditolak. Akun Google ini tidak terdaftar sebagai admin.';
}

function formatAuthError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : '';
  const message = error instanceof Error ? error.message : '';
  const combined = `${code} ${message}`.toLowerCase();

  if (combined.includes('popup-closed') || combined.includes('cancelled-popup')) {
    return 'Jendela login ditutup sebelum selesai. Silakan klik Login Admin lagi.';
  }
  if (combined.includes('popup-blocked')) {
    return 'Pop-up login diblokir browser. Izinkan pop-up untuk situs ini lalu coba lagi.';
  }
  if (combined.includes('unauthorized-domain')) {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'domain ini';
    return `Domain "${host}" belum diizinkan di Firebase Authentication (Authorized Domains).`;
  }
  if (
    combined.includes('operation-not-supported-in-this-environment') ||
    combined.includes('web-storage-unsupported')
  ) {
    return 'Browser ini membatasi login Google (misal browser bawaan WhatsApp/mode privat). Buka link lewat Chrome atau Safari biasa.';
  }
  if (combined.includes('operation-not-allowed')) {
    return 'Login Google belum diaktifkan di Firebase Authentication.';
  }
  if (combined.includes('network-request-failed')) {
    return 'Koneksi internet terputus saat login Google. Periksa jaringan Anda lalu coba lagi.';
  }
  if (combined.includes('too-many-requests')) {
    return 'Terlalu banyak percobaan login. Tunggu sebentar lalu coba lagi.';
  }

  return code
    ? `Gagal masuk dengan akun Google (${code}).`
    : 'Gagal masuk dengan akun Google. Coba buka situs lewat Chrome/Safari biasa.';
}

async function isAuthorizedAdminUser(user: User): Promise<boolean> {
  if (!user.emailVerified) {
    return false;
  }

  const email = getUserEmail(user);
  if (email.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()) {
    return true;
  }

  try {
    const adminSnap = await getDoc(doc(db, 'admins', user.uid));
    return adminSnap.exists();
  } catch {
    return false;
  }
}

export function useAdminAuth(): AdminAuthState {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [checkingAdmin, setCheckingAdmin] = useState<boolean>(false);
  const [signingIn, setSigningIn] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const signInInProgressRef = useRef<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (signInInProgressRef.current) {
        return;
      }

      if (!user) {
        if (!cancelled) {
          setCurrentUser(null);
          setIsAdmin(false);
          setCheckingAdmin(false);
        }
        return;
      }

      if (!cancelled) {
        setCheckingAdmin(true);
      }

      const allowed = await isAuthorizedAdminUser(user);
      if (cancelled || signInInProgressRef.current) return;

      if (!allowed) {
        const deniedMsg = buildDeniedMessage(user);
        await signOut(auth).catch(() => undefined);
        if (!cancelled) {
          setCurrentUser(null);
          setIsAdmin(false);
          setCheckingAdmin(false);
          setAuthError(deniedMsg);
        }
        return;
      }

      setCurrentUser(user);
      setIsAdmin(true);
      setCheckingAdmin(false);
      setAuthError(null);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const signInAdmin = useCallback(async () => {
    if (signInInProgressRef.current) return;
    signInInProgressRef.current = true;
    setAuthError(null);
    setSigningIn(true);

    try {
      const credential = await signInWithPopup(auth, googleProvider);
      const allowed = await isAuthorizedAdminUser(credential.user);

      if (!allowed) {
        const deniedMsg = buildDeniedMessage(credential.user);
        await signOut(auth).catch(() => undefined);
        setCurrentUser(null);
        setIsAdmin(false);
        setAuthError(deniedMsg);
        return;
      }

      setCurrentUser(credential.user);
      setIsAdmin(true);
      setAuthError(null);
    } catch (error) {
      if (auth.currentUser) {
        const allowed = await isAuthorizedAdminUser(auth.currentUser);
        if (allowed) {
          setCurrentUser(auth.currentUser);
          setIsAdmin(true);
          setAuthError(null);
          return;
        }
        const deniedMsg = buildDeniedMessage(auth.currentUser);
        await signOut(auth).catch(() => undefined);
        setCurrentUser(null);
        setIsAdmin(false);
        setAuthError(deniedMsg);
        return;
      }

      setAuthError(formatAuthError(error));
    } finally {
      signInInProgressRef.current = false;
      setSigningIn(false);
    }
  }, []);

  const signOutAdmin = useCallback(async () => {
    setAuthError(null);
    await signOut(auth);
    setCurrentUser(null);
    setIsAdmin(false);
  }, []);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  return {
    currentUser,
    isAdmin,
    checkingAdmin,
    signingIn,
    authError,
    signInAdmin,
    signOutAdmin,
    clearAuthError,
  };
}
