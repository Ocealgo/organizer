/**
 * Firestore security rules — behavioural tests.
 *
 * Run with:  npm run test:rules
 * (starts the Firestore emulator, runs these, tears it down)
 *
 * Each test states an invariant in plain English. Tests named "documents GAP n"
 * assert CURRENT permissive behaviour on purpose — they are there so that when
 * the gap is closed, the test fails loudly and reminds you to flip it.
 */

import { readFileSync } from 'node:fs'
import { before, after, beforeEach, describe, it } from 'node:test'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, updateDoc, deleteDoc, setLogLevel } from 'firebase/firestore'

setLogLevel('error')

const U = {
  rep: 'rep_1',
  rep2: 'rep_2',
  admin: 'admin_1',
  sa: 'super_1',
  pend: 'pending_1',
  off: 'deactivated_1',
}

let env

const asUser = (uid, token) => env.authenticatedContext(uid, token).firestore()
const asAnon = () => env.unauthenticatedContext().firestore()
const seed = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()))

before(async () => {
  env = await initializeTestEnvironment({
    // 'demo-' prefix => emulator-only project, can never reach production.
    projectId: 'demo-ocealgo',
    firestore: {
      rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })
})

after(async () => {
  if (env) await env.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
  await seed(async (db) => {
    const mk = (uid, role, status, email) =>
      setDoc(doc(db, 'users', uid), { email, name: uid, role, status, createdAt: 1 })
    await Promise.all([
      mk(U.rep, 'offline_sales', 'approved', 'rep@ocealgo.test'),
      mk(U.rep2, 'offline_sales', 'approved', 'rep2@ocealgo.test'),
      mk(U.admin, 'admin', 'approved', 'admin@ocealgo.test'),
      mk(U.sa, 'super_admin', 'approved', 'sa@ocealgo.test'),
      mk(U.pend, 'offline_sales', 'pending', 'pend@ocealgo.test'),
      mk(U.off, 'offline_sales', 'deactivated', 'off@ocealgo.test'),
    ])
  })
})

// ── fixtures ────────────────────────────────────────────────────────────────

const party = (over = {}) => ({
  name: 'Test Shop', type: 'retailer', category: 'FMCG',
  phone: '9876543210', address: 'MG Road', place: 'Kochi',
  district: 'Ernakulam', state: 'Kerala', pincode: '682001',
  pricePerPacket: 0, packetsAllocated: 0, cartonsAllocated: 0,
  lowStockThreshold: 0, status: 'prospect',
  addedBy: U.rep, addedByName: 'rep_1', createdAt: 1,
  ...over,
})

const alloc = (over = {}) => ({
  fromType: 'company', fromId: 'company', fromName: 'Ocealgo',
  partyId: 'p1', partyName: 'Test Shop', partyType: 'retailer',
  productId: 'prod1', productName: 'Baby Wet Wipes',
  packets: 10, cartons: 0, pricePerPacket: 45, totalAmount: 450,
  paymentType: 'credit', plannedDate: '2026-08-01',
  status: 'pending', notes: '',
  createdBy: U.rep, createdByName: 'rep_1',
  createdAt: 1, month: '2026-08', lockedAtCreation: true,
  ...over,
})

// ─────────────────────────────────────────────────────────────────────────────

describe('access gate', () => {
  it('an unauthenticated request cannot read parties', async () => {
    await seed((db) => setDoc(doc(db, 'parties', 'p1'), party()))
    await assertFails(getDoc(doc(asAnon(), 'parties', 'p1')))
  })

  it('an unauthenticated request cannot write parties', async () => {
    await assertFails(setDoc(doc(asAnon(), 'parties', 'p9'), party()))
  })

  it('a pending user can read nothing but their own user doc', async () => {
    await seed((db) => setDoc(doc(db, 'parties', 'p1'), party()))
    await assertFails(getDoc(doc(asUser(U.pend), 'parties', 'p1')))
    await assertSucceeds(getDoc(doc(asUser(U.pend), 'users', U.pend)))
  })

  it('a deactivated user cannot read parties', async () => {
    await seed((db) => setDoc(doc(db, 'parties', 'p1'), party()))
    await assertFails(getDoc(doc(asUser(U.off), 'parties', 'p1')))
  })

  it('an approved rep can read parties', async () => {
    await seed((db) => setDoc(doc(db, 'parties', 'p1'), party()))
    await assertSucceeds(getDoc(doc(asUser(U.rep), 'parties', 'p1')))
  })

  it('an unknown collection is denied even to a super admin', async () => {
    await assertFails(setDoc(doc(asUser(U.sa), 'some_new_collection', 'x'), { a: 1 }))
  })
})

describe('privilege escalation — the critical block', () => {
  it('a rep CANNOT promote themselves to super_admin', async () => {
    await assertFails(updateDoc(doc(asUser(U.rep), 'users', U.rep), { role: 'super_admin' }))
  })

  it('a rep CANNOT promote themselves to admin', async () => {
    await assertFails(updateDoc(doc(asUser(U.rep), 'users', U.rep), { role: 'admin' }))
  })

  it('a pending user CANNOT approve their own account', async () => {
    await assertFails(updateDoc(doc(asUser(U.pend), 'users', U.pend), { status: 'approved' }))
  })

  it('a rep CANNOT change another user at all', async () => {
    await assertFails(updateDoc(doc(asUser(U.rep), 'users', U.rep2), { role: 'admin' }))
  })

  it('a rep CAN update their own display name', async () => {
    await assertSucceeds(updateDoc(doc(asUser(U.rep), 'users', U.rep), { name: 'Rep Renamed' }))
  })

  it('an admin CAN approve a pending user', async () => {
    await assertSucceeds(updateDoc(doc(asUser(U.admin), 'users', U.pend), {
      status: 'approved', role: 'offline_sales',
      approvedAt: 2, approvedBy: U.admin, approvedByName: 'admin_1',
    }))
  })

  it('an admin CANNOT grant super_admin', async () => {
    await assertFails(updateDoc(doc(asUser(U.admin), 'users', U.pend), {
      status: 'approved', role: 'super_admin',
    }))
  })

  it('a super_admin CAN grant super_admin', async () => {
    await assertSucceeds(updateDoc(doc(asUser(U.sa), 'users', U.pend), {
      status: 'approved', role: 'super_admin',
    }))
  })

  it('an admin CANNOT modify a super_admin account', async () => {
    await assertFails(updateDoc(doc(asUser(U.admin), 'users', U.sa), { status: 'deactivated' }))
  })

  it('nobody can delete a super_admin account', async () => {
    await assertFails(deleteDoc(doc(asUser(U.sa), 'users', U.sa)))
  })
})

describe('signup', () => {
  it('a new user CAN self-create as a pending sales account', async () => {
    const db = asUser('new_1', { email: 'new@ocealgo.test' })
    await assertSucceeds(setDoc(doc(db, 'users', 'new_1'), {
      email: 'new@ocealgo.test', name: 'New Person',
      role: 'offline_sales', status: 'pending', createdAt: 1,
    }))
  })

  it('a new user CANNOT self-create as an approved super_admin', async () => {
    // This is the SignupPage.tsx hardcoded-email grant. Now blocked.
    const db = asUser('new_2', { email: 'amalau14113@gmail.com' })
    await assertFails(setDoc(doc(db, 'users', 'new_2'), {
      email: 'amalau14113@gmail.com', name: 'Impostor',
      role: 'super_admin', status: 'approved', createdAt: 1,
    }))
  })

  it('a new user CANNOT create a user doc under someone else\'s uid', async () => {
    const db = asUser('new_3', { email: 'n3@ocealgo.test' })
    await assertFails(setDoc(doc(db, 'users', 'victim'), {
      email: 'n3@ocealgo.test', name: 'X',
      role: 'offline_sales', status: 'pending', createdAt: 1,
    }))
  })

  it('a new user CANNOT claim an email other than their verified one', async () => {
    const db = asUser('new_4', { email: 'n4@ocealgo.test' })
    await assertFails(setDoc(doc(db, 'users', 'new_4'), {
      email: 'boss@ocealgo.test', name: 'X',
      role: 'offline_sales', status: 'pending', createdAt: 1,
    }))
  })
})

describe('parties', () => {
  it('a rep CAN add a prospect in their own name', async () => {
    await assertSucceeds(setDoc(doc(asUser(U.rep), 'parties', 'p_new'), party()))
  })

  it('a rep CANNOT create a party pre-set to active', async () => {
    await assertFails(setDoc(doc(asUser(U.rep), 'parties', 'p_new'), party({ status: 'active' })))
  })

  it('a rep CANNOT attribute a new party to someone else', async () => {
    await assertFails(setDoc(doc(asUser(U.rep), 'parties', 'p_new'), party({ addedBy: U.rep2 })))
  })

  it('a rep CANNOT delete a party', async () => {
    await seed((db) => setDoc(doc(db, 'parties', 'p1'), party()))
    await assertFails(deleteDoc(doc(asUser(U.rep), 'parties', 'p1')))
  })

  it('an admin CAN delete a party', async () => {
    await seed((db) => setDoc(doc(db, 'parties', 'p1'), party()))
    await assertSucceeds(deleteDoc(doc(asUser(U.admin), 'parties', 'p1')))
  })
})

describe('allocations — money integrity', () => {
  it('a rep CAN create a valid pending allocation', async () => {
    await assertSucceeds(setDoc(doc(asUser(U.rep), 'allocations_v2', 'a_new'), alloc()))
  })

  it('a rep CANNOT create an allocation attributed to another rep', async () => {
    await assertFails(setDoc(doc(asUser(U.rep), 'allocations_v2', 'a_new'),
      alloc({ createdBy: U.rep2 })))
  })

  it('a rep CANNOT create an allocation that is already dispatched', async () => {
    await assertFails(setDoc(doc(asUser(U.rep), 'allocations_v2', 'a_new'),
      alloc({ status: 'sent', sentAt: 5 })))
  })

  it('a rep CANNOT create an allocation with a pre-set paidAmount', async () => {
    await assertFails(setDoc(doc(asUser(U.rep), 'allocations_v2', 'a_new'),
      alloc({ paidAmount: 450 })))
  })

  it('an allocation whose totalAmount does not match packets x price is rejected', async () => {
    await assertFails(setDoc(doc(asUser(U.rep), 'allocations_v2', 'a_new'),
      alloc({ packets: 10, pricePerPacket: 45, totalAmount: 1 })))
  })

  it('a rep CANNOT dispatch an allocation', async () => {
    await seed((db) => setDoc(doc(db, 'allocations_v2', 'a1'), alloc()))
    await assertFails(updateDoc(doc(asUser(U.rep), 'allocations_v2', 'a1'),
      { status: 'sent', sentAt: 9 }))
  })

  it('a rep CANNOT mark a pending allocation paid', async () => {
    await seed((db) => setDoc(doc(db, 'allocations_v2', 'a1'), alloc()))
    await assertFails(updateDoc(doc(asUser(U.rep), 'allocations_v2', 'a1'),
      { status: 'paid', paidAt: 9, paidAmount: 450 }))
  })

  it('a rep CAN cancel their own pending allocation', async () => {
    await seed((db) => setDoc(doc(db, 'allocations_v2', 'a1'), alloc()))
    await assertSucceeds(updateDoc(doc(asUser(U.rep), 'allocations_v2', 'a1'),
      { status: 'cancelled' }))
  })

  it('a rep CANNOT cancel another rep\'s allocation', async () => {
    await seed((db) => setDoc(doc(db, 'allocations_v2', 'a1'), alloc({ createdBy: U.rep2 })))
    await assertFails(updateDoc(doc(asUser(U.rep), 'allocations_v2', 'a1'),
      { status: 'cancelled' }))
  })

  it('an admin CAN dispatch an allocation', async () => {
    await seed((db) => setDoc(doc(db, 'allocations_v2', 'a1'), alloc()))
    await assertSucceeds(updateDoc(doc(asUser(U.admin), 'allocations_v2', 'a1'),
      { status: 'sent', sentAt: 9, sentBy: U.admin }))
  })

  it('documents GAP 3: a rep CAN still apply a payment to a sent credit allocation', async () => {
    // Delete this test when payment application moves to a Cloud Function
    // and the compatibility rule is removed from firestore.rules.
    await seed((db) => setDoc(doc(db, 'allocations_v2', 'a1'),
      alloc({ status: 'sent', sentAt: 5 })))
    await assertSucceeds(updateDoc(doc(asUser(U.rep), 'allocations_v2', 'a1'),
      { paidAmount: 450, status: 'paid', paidAt: 9 }))
  })

  it('a rep CANNOT change the amount of a sent allocation', async () => {
    await seed((db) => setDoc(doc(db, 'allocations_v2', 'a1'),
      alloc({ status: 'sent', sentAt: 5 })))
    await assertFails(updateDoc(doc(asUser(U.rep), 'allocations_v2', 'a1'),
      { totalAmount: 1 }))
  })
})

describe('payment transactions', () => {
  const txn = (over = {}) => ({
    partyId: 'p1', partyName: 'Test Shop', partyType: 'retailer',
    amount: 500, paymentMethod: 'cash',
    collectionType: 'collected_by_salesperson',
    collectedBy: U.rep, collectedByName: 'rep_1',
    status: 'pending_approval', date: '2026-08-01', createdAt: 1,
    ...over,
  })

  it('a rep CAN log a collection as pending_approval in their own name', async () => {
    await assertSucceeds(setDoc(doc(asUser(U.rep), 'payment_transactions', 't_new'), txn()))
  })

  it('a rep CANNOT log a pre-approved payment', async () => {
    await assertFails(setDoc(doc(asUser(U.rep), 'payment_transactions', 't_new'),
      txn({ status: 'approved' })))
  })

  it('a rep CANNOT log a payment as already confirmed by admin', async () => {
    await assertFails(setDoc(doc(asUser(U.rep), 'payment_transactions', 't_new'),
      txn({ confirmedAt: 5 })))
  })

  it('a rep CANNOT attribute a collection to another rep', async () => {
    await assertFails(setDoc(doc(asUser(U.rep), 'payment_transactions', 't_new'),
      txn({ collectedBy: U.rep2 })))
  })

  it('a rep CANNOT approve their own payment', async () => {
    await seed((db) => setDoc(doc(db, 'payment_transactions', 't1'), txn()))
    await assertFails(updateDoc(doc(asUser(U.rep), 'payment_transactions', 't1'),
      { status: 'approved', confirmedAt: 9 }))
  })

  it('an admin CAN confirm a payment', async () => {
    await seed((db) => setDoc(doc(db, 'payment_transactions', 't1'), txn()))
    await assertSucceeds(updateDoc(doc(asUser(U.admin), 'payment_transactions', 't1'),
      { status: 'approved', confirmedAt: 9, confirmedBy: U.admin }))
  })

  it('a rep CAN delete their own unconfirmed payment (revisit edit flow)', async () => {
    await seed((db) => setDoc(doc(db, 'payment_transactions', 't1'), txn()))
    await assertSucceeds(deleteDoc(doc(asUser(U.rep), 'payment_transactions', 't1')))
  })

  it('a rep CANNOT delete an admin-confirmed payment', async () => {
    await seed((db) => setDoc(doc(db, 'payment_transactions', 't1'),
      txn({ status: 'approved', confirmedAt: 5 })))
    await assertFails(deleteDoc(doc(asUser(U.rep), 'payment_transactions', 't1')))
  })
})

describe('visit logs', () => {
  const log = (uid, over = {}) => ({
    salesPersonId: uid, salesPersonName: uid, date: '2026-08-01',
    visits: [], endOfDayNote: '', totalVisited: 0,
    createdAt: 1, updatedAt: 1, ...over,
  })

  it('a rep CAN read their own visit log', async () => {
    await seed((db) => setDoc(doc(db, 'visit_logs', 'l1'), log(U.rep)))
    await assertSucceeds(getDoc(doc(asUser(U.rep), 'visit_logs', 'l1')))
  })

  it('a rep CANNOT read another rep\'s visit log', async () => {
    await seed((db) => setDoc(doc(db, 'visit_logs', 'l2'), log(U.rep2)))
    await assertFails(getDoc(doc(asUser(U.rep), 'visit_logs', 'l2')))
  })

  it('a rep CAN read a log that was shared with them', async () => {
    await seed((db) => setDoc(doc(db, 'visit_logs', 'l2'),
      log(U.rep2, { sharedWith: [U.rep2, U.rep] })))
    await assertSucceeds(getDoc(doc(asUser(U.rep), 'visit_logs', 'l2')))
  })

  it('an admin CAN read any visit log', async () => {
    await seed((db) => setDoc(doc(db, 'visit_logs', 'l2'), log(U.rep2)))
    await assertSucceeds(getDoc(doc(asUser(U.admin), 'visit_logs', 'l2')))
  })

  it('a rep CANNOT create a log in another rep\'s name', async () => {
    await assertFails(setDoc(doc(asUser(U.rep), 'visit_logs', 'l_new'), log(U.rep2)))
  })
})

describe('products, stock and settings', () => {
  it('a rep CANNOT create a product', async () => {
    await assertFails(setDoc(doc(asUser(U.rep), 'products', 'prod_new'),
      { name: 'Rogue', unitLabel: 'packets', defaultPricePerUnit: 1, unitsPerCarton: 12, active: true }))
  })

  it('an admin CAN create a product', async () => {
    await assertSucceeds(setDoc(doc(asUser(U.admin), 'products', 'prod_new'),
      { name: 'New Product', unitLabel: 'packets', defaultPricePerUnit: 45, unitsPerCarton: 12, active: true, createdBy: U.admin, createdAt: 1 }))
  })

  it('a rep CANNOT change the carton size', async () => {
    await seed((db) => setDoc(doc(db, 'config', 'stock'),
      { total: 0, locked: 0, packetsPerCarton: 12, productStock: {}, updatedAt: 1 }))
    await assertFails(updateDoc(doc(asUser(U.rep), 'config', 'stock'), { packetsPerCarton: 1 }))
  })

  it('documents GAP 2: a rep CAN write productStock (needed to lock on create)', async () => {
    // Delete this test when stock locking moves to a Cloud Function.
    await seed((db) => setDoc(doc(db, 'config', 'stock'),
      { total: 0, locked: 0, packetsPerCarton: 12, productStock: {}, updatedAt: 1 }))
    await assertSucceeds(updateDoc(doc(asUser(U.rep), 'config', 'stock'), {
      'productStock.prod1.locked': 10, updatedAt: 2,
    }))
  })

  it('a rep CANNOT write app settings', async () => {
    await assertFails(setDoc(doc(asUser(U.rep), 'config', 'settings'), { mapperLink: 'https://evil.test' }))
  })

  it('an admin CANNOT write app settings — super admin only', async () => {
    await assertFails(setDoc(doc(asUser(U.admin), 'config', 'settings'), { mapperLink: 'https://x.test' }))
  })

  it('a super_admin CAN write app settings', async () => {
    await assertSucceeds(setDoc(doc(asUser(U.sa), 'config', 'settings'), { mapperLink: 'https://x.test' }))
  })
})

describe('leave', () => {
  const leave = (uid, over = {}) => ({
    uid, name: uid, role: 'offline_sales', date: '2026-08-01',
    leaveType: 'full_day', status: 'pending_approval',
    markedAt: 1, markedBy: uid, markedByName: uid, ...over,
  })

  it('a rep CAN request their own leave', async () => {
    await assertSucceeds(setDoc(doc(asUser(U.rep), 'leave_records', 'lv_new'), leave(U.rep)))
  })

  it('a rep CANNOT self-approve a leave request', async () => {
    await assertFails(setDoc(doc(asUser(U.rep), 'leave_records', 'lv_new'),
      leave(U.rep, { status: 'active' })))
  })

  it('a rep CANNOT approve their own pending leave', async () => {
    await seed((db) => setDoc(doc(db, 'leave_records', 'lv1'), leave(U.rep)))
    await assertFails(updateDoc(doc(asUser(U.rep), 'leave_records', 'lv1'), { status: 'active' }))
  })

  it('a rep CAN request unmark on their own active leave', async () => {
    await seed((db) => setDoc(doc(db, 'leave_records', 'lv1'), leave(U.rep, { status: 'active' })))
    await assertSucceeds(updateDoc(doc(asUser(U.rep), 'leave_records', 'lv1'),
      { status: 'unmark_requested', unmarkRequestedAt: 9 }))
  })

  it('an admin CAN approve a leave request', async () => {
    await seed((db) => setDoc(doc(db, 'leave_records', 'lv1'), leave(U.rep)))
    await assertSucceeds(updateDoc(doc(asUser(U.admin), 'leave_records', 'lv1'), { status: 'active' }))
  })

  it('a rep CANNOT read another rep\'s leave record', async () => {
    await seed((db) => setDoc(doc(db, 'leave_records', 'lv2'), leave(U.rep2)))
    await assertFails(getDoc(doc(asUser(U.rep), 'leave_records', 'lv2')))
  })
})

describe('expenses', () => {
  const entry = (uid, over = {}) => ({
    reportId: 'r1', userId: uid, date: '2026-08-01',
    type: 'variable', category: 'bus_fare', amount: 100, createdAt: 1, ...over,
  })

  it('a rep CAN create their own expense entry', async () => {
    await assertSucceeds(setDoc(doc(asUser(U.rep), 'expense_entries', 'e_new'), entry(U.rep)))
  })

  it('a rep CANNOT create an expense entry for another user', async () => {
    await assertFails(setDoc(doc(asUser(U.rep), 'expense_entries', 'e_new'), entry(U.rep2)))
  })

  it('a rep CANNOT read another rep\'s expense entry', async () => {
    await seed((db) => setDoc(doc(db, 'expense_entries', 'e2'), entry(U.rep2)))
    await assertFails(getDoc(doc(asUser(U.rep), 'expense_entries', 'e2')))
  })

  it('an admin CAN read any expense entry', async () => {
    await seed((db) => setDoc(doc(db, 'expense_entries', 'e2'), entry(U.rep2)))
    await assertSucceeds(getDoc(doc(asUser(U.admin), 'expense_entries', 'e2')))
  })

  it('a rep CANNOT edit a submitted report', async () => {
    await seed((db) => setDoc(doc(db, 'expense_reports', 'r1'), {
      userId: U.rep, userName: 'rep_1', weekStart: '2026-07-27', weekEnd: '2026-08-02',
      status: 'submitted', totalAmount: 500, createdAt: 1,
    }))
    await assertFails(updateDoc(doc(asUser(U.rep), 'expense_reports', 'r1'), { totalAmount: 99999 }))
  })

  it('a rep CANNOT clear their own report', async () => {
    await seed((db) => setDoc(doc(db, 'expense_reports', 'r1'), {
      userId: U.rep, userName: 'rep_1', weekStart: '2026-07-27', weekEnd: '2026-08-02',
      status: 'submitted', totalAmount: 500, createdAt: 1,
    }))
    await assertFails(updateDoc(doc(asUser(U.rep), 'expense_reports', 'r1'), { status: 'cleared' }))
  })
})

describe('workspace and audit trail', () => {
  it('a rep CANNOT read admin reminders', async () => {
    await seed((db) => setDoc(doc(db, 'reminders', 'rm1'),
      { title: 'Private', date: '2026-08-01', category: 'Finance', type: 'manual', done: false, createdAt: 1 }))
    await assertFails(getDoc(doc(asUser(U.rep), 'reminders', 'rm1')))
  })

  it('a rep CANNOT forge a dispatch record', async () => {
    await assertFails(setDoc(doc(asUser(U.rep), 'dispatches', 'd_new'),
      { partyId: 'p1', packets: 10, totalAmount: 450, dispatchedBy: U.rep, dispatchedAt: 1, createdAt: 1 }))
  })

  it('a dispatch record is immutable even for an admin', async () => {
    await seed((db) => setDoc(doc(db, 'dispatches', 'd1'),
      { partyId: 'p1', packets: 10, totalAmount: 450, dispatchedBy: U.admin, dispatchedAt: 1, createdAt: 1 }))
    await assertFails(updateDoc(doc(asUser(U.admin), 'dispatches', 'd1'), { packets: 1 }))
  })

  it('a rep CAN mark an alert read but CANNOT rewrite its message', async () => {
    await seed((db) => setDoc(doc(db, 'alerts', 'al1'),
      { type: 'new_party', message: 'original', relatedId: 'x', read: false, createdAt: 1 }))
    await assertSucceeds(updateDoc(doc(asUser(U.rep), 'alerts', 'al1'), { read: true }))
    await assertFails(updateDoc(doc(asUser(U.rep), 'alerts', 'al1'), { message: 'tampered' }))
  })
})
