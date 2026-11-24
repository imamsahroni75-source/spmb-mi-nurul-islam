# Security Specification & Payload-First TDD (`firestore.rules`)

## 1. Data Invariants
1. **Strict Non-PII Public Summary**: Collection `/origin_schools/{schoolId}` stores only aggregate school origin data (`schoolName`, `schoolType`, `studentCount`, `updatedBy`, `createdAt`, `updatedAt`). No student PII (names, phone numbers, addresses, NIK) may be stored in `/origin_schools`.
2. **Admin-Only Mutations**: Public visitors can read (`get`, `list`) `/origin_schools`, while `create`, `update`, and `delete` are strictly restricted to verified admins (`request.auth.token.email_verified == true` AND either bootstrapped admin email `holipahhaenul@gmail.com` or an existing `/admins/{uid}` document).
3. **Immutable Creation Metadata**: `createdAt` is locked on `update`, while `updatedAt` must always equal `request.time` and `updatedBy` must equal `request.auth.uid`.
4. **No Self-Privilege Escalation**: `/admins/{userId}` denies all client writes (`create`, `update`, `delete`) and `list` queries.
5. **Bounded Types & IDs**: All document IDs match `^[a-zA-Z0-9_\\-]+$` (`<= 128` chars), `schoolName` is `2..100` chars, `schoolType` is in `['TK', 'RA', 'Lainnya']`, and `studentCount` is an integer between `0` and `5000`.

## 2. The "Dirty Dozen" Malicious Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Create**: Unauthenticated user attempts `create` on `/origin_schools/tk_1`.
2. **Non-Admin Authenticated Create**: Signed-in user with different email attempts `create` on `/origin_schools/tk_1`.
3. **Unverified Admin Email Spoof**: Signed-in user with `email == 'holipahhaenul@gmail.com'` and `email_verified == false` attempts `create`.
4. **Shadow / Ghost Field Injection**: Admin sends `{ schoolName: "RA Al-Falah", schoolType: "RA", studentCount: 5, isVerified: true, ... }`.
5. **Path ID Poisoning**: Admin attempts `create` at `/origin_schools/invalid$id!with*bad#chars` or >128 chars.
6. **Negative Student Count**: Admin sends `studentCount: -3`.
7. **Float / String Type Poisoning**: Admin sends `studentCount: "10"` or `studentCount: 4.5`.
8. **Empty or Oversized School Name**: Admin sends `schoolName: "A"` (<2 chars) or 200-char string (>100 chars).
9. **Invalid School Type Enum**: Admin sends `schoolType: "SMP"`.
10. **Client-Forged Timestamp**: Admin sends `createdAt` or `updatedAt` different from `request.time`.
11. **Mutating Immutable `createdAt` on Update**: Admin attempts to modify `createdAt` during `update`.
12. **Admin Escalation Write**: Any user attempts `set` on `/admins/attacker_uid` with `{ email: "attacker@example.com", role: "admin" }`.
