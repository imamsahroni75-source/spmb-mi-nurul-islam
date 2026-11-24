import {onAuthStateChanged, signInWithPopup, signOut, type User} from 'firebase/auth';
import {doc, getDoc} from 'firebase/firestore';
import {useCallback, useEffect, useState} from 'react';
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

async function isAuthorizedAdminUser(user: User): Promise<boolean> {
  if (!user.emailVerified) {
    return false;
  }

  if (user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()) {
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

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
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
      if (cancelled) return;

      if (!allowed) {
        await signOut(auth).catch(() => undefined);
        if (!cancelled) {
          setCurrentUser(null);
          setIsAdmin(false);
          setCheckingAdmin(false);
          setAuthError('Akses ditolak. Akun Google ini tidak terdaftar sebagai admin.');
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
    if (signingIn) return;
    setAuthError(null);
    setSigningIn(true);

    try {
      const credential = await signInWithPopup(auth, googleProvider);
      const allowed = await isAuthorizedAdminUser(credential.user);

      if (!allowed) {
        await signOut(auth).catch(() => undefined);
        setCurrentUser(null);
        setIsAdmin(false);
        setAuthError('Akses ditolak. Akun Google ini tidak terdaftar sebagai admin.');
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
        await signOut(auth).catch(() => undefined);
        setCurrentUser(null);
        setIsAdmin(false);
        setAuthError('Akses ditolak. Akun Google ini tidak terdaftar sebagai admin.');
        return;
      }

      const message = error instanceof Error ? error.message : '';
      if (message.includes('popup-closed') || message.includes('cancelled-popup')) {
        setAuthError('Login dibatalkan.');
      } else if (message.includes('popup-blocked')) {
        setAuthError('Pop-up diblokir browser. Izinkan pop-up untuk login Google.');
      } else {
        setAuthError('Gagal masuk dengan akun Google.');
      }
    } finally {
      setSigningIn(false);
    }
  }, [signingIn]);

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
