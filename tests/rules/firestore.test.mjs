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
  mgr: 'manager_1',      // sales_manager on the shipped defaults
  mgrPlus: 'manager_2',  // sales_manager with every permission granted
}

// Mirrors DEFAULT_SALES_MANAGER_PERMISSIONS in src/auth/permissions.ts
const MGR_DEFAULT = {
  view_parties: true, view_allocations: true, view_stock: true, view_products: true,
  view_credit: true, view_expenses: true, view_leave: true, view_reports: true,
  view_users: true, view_workspace: false,
  edit_parties: true, approve_leave: true, approve_sales_users: true,
  manage_products: false, edit_stock: false,
  dispatch_allocations: false, mark_paid: false, approve_payments: false,
  clear_expenses: false, delete_parties: false,
}

const MGR_FULL = Object.fromEntries(Object.keys(MGR_DEFAULT).map(k => [k, true]))

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
    const mk = (uid, role, status, email, permissions) =>
      setDoc(doc(db, 'users', uid), {
        email, name: uid, role, status, createdAt: 1,
        ...(permissions ? { permissions } : {}),
      })
    await Promise.all([
      mk(U.rep, 'offline_sales', 'approved', 'rep@ocealgo.test'),
      mk(U.rep2, 'offline_sales', 'approved', 'rep2@ocealgo.test'),
      mk(U.admin, 'admin', 'approved', 'admin@ocealgo.test'),
      mk(U.sa, 'super_admin', 'approved', 'sa@ocealgo.test'),
      mk(U.pend, 'offline_sales', 'pending', 'pend@ocealgo.test'),
      mk(U.off, 'offline_sales', 'deactivated', 'off@ocealgo.test'),
      mk(U.mgr, 'sales_manager', 'approved', 'mgr@ocealgo.test', MGR_DEFAULT),
      mk(U.mgrPlus, 'sales_manager', 'approved', 'mgr2@ocealgo.test', MGR_FULL),
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

  it('a super_admin CAN approve a signup — exact payload UserManagement sends', async () => {
    await assertSucceeds(updateDoc(doc(asUser(U.sa), 'users', U.pend), {
      status: 'approved',
      role: 'offline_sales',
      approvedAt: 2,
      approvedBy: U.sa,
      approvedByName: 'super_1',
    }))
  })

  it('an admin CAN approve a signup as sales_manager with a permission map', async () => {
    await assertSucceeds(updateDoc(doc(asUser(U.admin), 'users', U.pend), {
      status: 'approved',
      role: 'sales_manager',
      approvedAt: 2,
      approvedBy: U.admin,
      approvedByName: 'admin_1',
      permissions: MGR_DEFAULT,
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

describe('sales manager — permission enforcement', () => {
  it('a manager CANNOT widen their own permissions', async () => {
    // The whole feature rests on this one.
    await assertFails(updateDoc(doc(asUser(U.mgr), 'users', U.mgr), {
      permissions: { ...MGR_DEFAULT, dispatch_allocations: true },
    }))
  })

  it('a manager CANNOT change their own role', async () => {
    await assertFails(updateDoc(doc(asUser(U.mgr), 'users', U.mgr), { role: 'admin' }))
  })

  it('a manager CANNOT edit another manager\'s permissions', async () => {
    await assertFails(updateDoc(doc(asUser(U.mgr), 'users', U.mgrPlus), {
      permissions: { ...MGR_FULL },
    }))
  })

  it('an admin CAN tune a manager\'s permissions', async () => {
    await assertSucceeds(updateDoc(doc(asUser(U.admin), 'users', U.mgr), {
      permissions: { ...MGR_DEFAULT, mark_paid: true },
    }))
  })

  it('a manager on defaults CAN read parties but CANNOT delete one', async () => {
    await seed((db) => setDoc(doc(db, 'parties', 'p1'), party()))
    await assertSucceeds(getDoc(doc(asUser(U.mgr), 'parties', 'p1')))
    await assertFails(deleteDoc(doc(asUser(U.mgr), 'parties', 'p1')))
  })

  it('a manager granted delete_parties CAN delete a party', async () => {
    await seed((db) => setDoc(doc(db, 'parties', 'p1'), party()))
    await assertSucceeds(deleteDoc(doc(asUser(U.mgrPlus), 'parties', 'p1')))
  })

  it('a manager on defaults CANNOT dispatch an allocation', async () => {
    await seed((db) => setDoc(doc(db, 'allocations_v2', 'a1'), alloc()))
    await assertFails(updateDoc(doc(asUser(U.mgr), 'allocations_v2', 'a1'),
      { status: 'sent', sentAt: 9 }))
  })

  it('a manager granted dispatch_allocations CAN dispatch', async () => {
    await seed((db) => setDoc(doc(db, 'allocations_v2', 'a1'), alloc()))
    await assertSucceeds(updateDoc(doc(asUser(U.mgrPlus), 'allocations_v2', 'a1'),
      { status: 'sent', sentAt: 9 }))
  })

  it('a manager on defaults CANNOT mark an allocation paid', async () => {
    await seed((db) => setDoc(doc(db, 'allocations_v2', 'a1'),
      alloc({ status: 'sent', sentAt: 5 })))
    await assertFails(updateDoc(doc(asUser(U.mgr), 'allocations_v2', 'a1'),
      { status: 'paid', paidAt: 9, paidAmount: 450 }))
  })

  it('a manager on defaults CANNOT confirm a payment', async () => {
    await seed((db) => setDoc(doc(db, 'payment_transactions', 't1'), {
      partyId: 'p1', partyName: 'Test Shop', partyType: 'retailer',
      amount: 500, paymentMethod: 'cash', collectionType: 'collected_by_salesperson',
      collectedBy: U.rep, collectedByName: 'rep_1',
      status: 'pending_approval', date: '2026-08-01', createdAt: 1,
    }))
    await assertFails(updateDoc(doc(asUser(U.mgr), 'payment_transactions', 't1'),
      { status: 'approved', confirmedAt: 9 }))
  })

  it('a manager on defaults CANNOT create or edit products', async () => {
    await assertFails(setDoc(doc(asUser(U.mgr), 'products', 'prod_new'),
      { name: 'X', unitLabel: 'packets', defaultPricePerUnit: 1, unitsPerCarton: 12, active: true }))
  })

  it('a manager on defaults CANNOT edit company stock', async () => {
    await seed((db) => setDoc(doc(db, 'config', 'stock'),
      { total: 0, locked: 0, packetsPerCarton: 12, productStock: {}, updatedAt: 1 }))
    await assertFails(updateDoc(doc(asUser(U.mgr), 'config', 'stock'), { packetsPerCarton: 99 }))
  })

  it('a manager without view_workspace CANNOT read reminders', async () => {
    await seed((db) => setDoc(doc(db, 'reminders', 'rm1'),
      { title: 'Private', date: '2026-08-01', category: 'Finance', type: 'manual', done: false, createdAt: 1 }))
    await assertFails(getDoc(doc(asUser(U.mgr), 'reminders', 'rm1')))
  })

  it('a manager granted view_workspace CAN read reminders', async () => {
    await seed((db) => setDoc(doc(db, 'reminders', 'rm1'),
      { title: 'Private', date: '2026-08-01', category: 'Finance', type: 'manual', done: false, createdAt: 1 }))
    await assertSucceeds(getDoc(doc(asUser(U.mgrPlus), 'reminders', 'rm1')))
  })

  it('a manager with view_reports CAN read any rep\'s visit log', async () => {
    await seed((db) => setDoc(doc(db, 'visit_logs', 'l1'), {
      salesPersonId: U.rep, salesPersonName: 'rep_1', date: '2026-08-01',
      visits: [], endOfDayNote: '', totalVisited: 0, createdAt: 1, updatedAt: 1,
    }))
    await assertSucceeds(getDoc(doc(asUser(U.mgr), 'visit_logs', 'l1')))
  })

  it('a manager with view_reports CAN read team leave and expenses', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'leave_records', 'lv1'), {
        uid: U.rep, name: 'rep_1', role: 'offline_sales', date: '2026-08-01',
        leaveType: 'full_day', status: 'active', markedAt: 1, markedBy: U.rep, markedByName: 'rep_1',
      })
      await setDoc(doc(db, 'expense_entries', 'e1'), {
        reportId: 'r1', userId: U.rep, date: '2026-08-01',
        type: 'variable', category: 'bus_fare', amount: 100, createdAt: 1,
      })
    })
    await assertSucceeds(getDoc(doc(asUser(U.mgr), 'leave_records', 'lv1')))
    await assertSucceeds(getDoc(doc(asUser(U.mgr), 'expense_entries', 'e1')))
  })
})

describe('sales manager — approving signups', () => {
  it('CAN approve a pending signup into offline_sales', async () => {
    await assertSucceeds(updateDoc(doc(asUser(U.mgr), 'users', U.pend), {
      status: 'approved', role: 'offline_sales',
      approvedAt: 2, approvedBy: U.mgr, approvedByName: 'manager_1',
    }))
  })

  it('CAN reject a pending signup', async () => {
    await assertSucceeds(updateDoc(doc(asUser(U.mgr), 'users', U.pend), { status: 'rejected' }))
  })

  it('CANNOT approve a signup into admin', async () => {
    await assertFails(updateDoc(doc(asUser(U.mgr), 'users', U.pend), {
      status: 'approved', role: 'admin',
    }))
  })

  it('CANNOT approve a signup into sales_manager', async () => {
    await assertFails(updateDoc(doc(asUser(U.mgr), 'users', U.pend), {
      status: 'approved', role: 'sales_manager',
    }))
  })

  it('CANNOT grant permissions while approving', async () => {
    await assertFails(updateDoc(doc(asUser(U.mgr), 'users', U.pend), {
      status: 'approved', role: 'offline_sales', permissions: MGR_FULL,
    }))
  })

  it('CANNOT change an already-approved user', async () => {
    await assertFails(updateDoc(doc(asUser(U.mgr), 'users', U.rep), {
      status: 'deactivated',
    }))
  })

  it('CANNOT deactivate anyone', async () => {
    await assertFails(updateDoc(doc(asUser(U.mgr), 'users', U.rep2), { status: 'deactivated' }))
  })

  it('a rep with no permissions CANNOT approve a signup', async () => {
    await assertFails(updateDoc(doc(asUser(U.rep), 'users', U.pend), {
      status: 'approved', role: 'offline_sales',
    }))
  })
})

describe('field app — duty sessions', () => {
  const duty = (uid, over = {}) => ({
    uid, name: uid, date: '2026-08-01',
    startAt: 1000, startOdometerKm: 12000,
    startOdometerPhoto: `field/${uid}/s1/start.jpg`,
    startLocation: { lat: 9.93, lng: 76.26, accuracy: 12, capturedAt: 1000 },
    status: 'active', createdAt: 1000,
    ...over,
  })

  it('an officer CAN open their own duty session', async () => {
    await assertSucceeds(setDoc(doc(asUser(U.rep), 'duty_sessions', 'd1'), duty(U.rep)))
  })

  it('an officer CAN start a day with a broken meter, given a reason', async () => {
    const { startOdometerKm, startOdometerPhoto, ...noMeter } = duty(U.rep)
    await assertSucceeds(setDoc(doc(asUser(U.rep), 'duty_sessions', 'd1'), {
      ...noMeter, odometerStatus: 'not_working', odometerIssueNote: 'Meter cable snapped',
    }))
  })

  it('an officer CAN start a day with no vehicle at all', async () => {
    const { startOdometerKm, startOdometerPhoto, ...noMeter } = duty(U.rep)
    await assertSucceeds(setDoc(doc(asUser(U.rep), 'duty_sessions', 'd1'), {
      ...noMeter, odometerStatus: 'no_vehicle', odometerIssueNote: 'On the bus today',
    }))
  })

  it('an officer CANNOT skip the meter without saying why', async () => {
    const { startOdometerKm, startOdometerPhoto, ...noMeter } = duty(U.rep)
    await assertFails(setDoc(doc(asUser(U.rep), 'duty_sessions', 'd1'), {
      ...noMeter, odometerStatus: 'not_working',
    }))
  })

  it('an officer CANNOT claim the meter works and then omit the reading', async () => {
    const { startOdometerKm, ...noReading } = duty(U.rep)
    await assertFails(setDoc(doc(asUser(U.rep), 'duty_sessions', 'd1'), {
      ...noReading, odometerStatus: 'recorded',
    }))
  })

  it('a day can be recorded with no location at all', async () => {
    const { startLocation, ...noGps } = duty(U.rep)
    await assertSucceeds(setDoc(doc(asUser(U.rep), 'duty_sessions', 'd1'), noGps))
  })

  it('an officer CANNOT open a session in someone else\'s name', async () => {
    await assertFails(setDoc(doc(asUser(U.rep), 'duty_sessions', 'd1'), duty(U.rep2)))
  })

  it('an officer CANNOT open a session that is already closed out', async () => {
    await assertFails(setDoc(doc(asUser(U.rep), 'duty_sessions', 'd1'),
      duty(U.rep, { endOdometerKm: 12200, status: 'closed' })))
  })

  it('an officer CAN close their own open session', async () => {
    await seed((db) => setDoc(doc(db, 'duty_sessions', 'd1'), duty(U.rep)))
    await assertSucceeds(updateDoc(doc(asUser(U.rep), 'duty_sessions', 'd1'), {
      endAt: 5000, endOdometerKm: 12180, endOdometerPhoto: 'field/rep_1/s1/end.jpg',
      claimedDistanceKm: 180, status: 'closed',
    }))
  })

  it('an officer CANNOT rewrite their starting odometer reading', async () => {
    await seed((db) => setDoc(doc(db, 'duty_sessions', 'd1'), duty(U.rep)))
    await assertFails(updateDoc(doc(asUser(U.rep), 'duty_sessions', 'd1'),
      { startOdometerKm: 11000 }))
  })

  it('an officer CANNOT swap out the starting odometer photo', async () => {
    await seed((db) => setDoc(doc(db, 'duty_sessions', 'd1'), duty(U.rep)))
    await assertFails(updateDoc(doc(asUser(U.rep), 'duty_sessions', 'd1'),
      { startOdometerPhoto: 'field/rep_1/s1/other.jpg' }))
  })

  it('an officer CANNOT reopen a closed session', async () => {
    await seed((db) => setDoc(doc(db, 'duty_sessions', 'd1'),
      duty(U.rep, { status: 'closed', endOdometerKm: 12180 })))
    await assertFails(updateDoc(doc(asUser(U.rep), 'duty_sessions', 'd1'),
      { endOdometerKm: 12500 }))
  })

  it('an officer CANNOT touch another officer\'s session', async () => {
    await seed((db) => setDoc(doc(db, 'duty_sessions', 'd2'), duty(U.rep2)))
    await assertFails(updateDoc(doc(asUser(U.rep), 'duty_sessions', 'd2'), { status: 'closed' }))
    await assertFails(getDoc(doc(asUser(U.rep), 'duty_sessions', 'd2')))
  })

  it('a manager with view_reports CAN read any session', async () => {
    await seed((db) => setDoc(doc(db, 'duty_sessions', 'd2'), duty(U.rep2)))
    await assertSucceeds(getDoc(doc(asUser(U.mgr), 'duty_sessions', 'd2')))
  })
})

describe('field app — location trace', () => {
  const ping = (uid, over = {}) => ({
    uid, sessionId: 'd1', date: '2026-08-01',
    lat: 9.93, lng: 76.26, accuracy: 15, at: 1200, ...over,
  })

  it('an officer CAN append their own pings', async () => {
    await assertSucceeds(setDoc(doc(asUser(U.rep), 'location_pings', 'p1'), ping(U.rep)))
  })

  it('an officer CANNOT append pings under another uid', async () => {
    await assertFails(setDoc(doc(asUser(U.rep), 'location_pings', 'p1'), ping(U.rep2)))
  })

  it('the trace is immutable — nobody can edit a ping', async () => {
    await seed((db) => setDoc(doc(db, 'location_pings', 'p1'), ping(U.rep)))
    await assertFails(updateDoc(doc(asUser(U.rep), 'location_pings', 'p1'), { lat: 0 }))
    await assertFails(updateDoc(doc(asUser(U.admin), 'location_pings', 'p1'), { lat: 0 }))
  })

  it('only a super admin can delete pings — retention, not user action', async () => {
    await seed((db) => setDoc(doc(db, 'location_pings', 'p1'), ping(U.rep)))
    await assertFails(deleteDoc(doc(asUser(U.rep), 'location_pings', 'p1')))
    await assertFails(deleteDoc(doc(asUser(U.admin), 'location_pings', 'p1')))
    await assertSucceeds(deleteDoc(doc(asUser(U.sa), 'location_pings', 'p1')))
  })
})

describe('field app — outlet visits', () => {
  const visit = (uid, over = {}) => ({
    sessionId: 'd1', uid, name: uid, date: '2026-08-01',
    partyId: 'p1', partyName: 'Test Shop', outletType: 'grocery',
    punchInAt: 2000,
    punchInLocation: { lat: 9.93, lng: 76.26, accuracy: 14, capturedAt: 2000 },
    stock: [], competitors: [], photos: [],
    orderPlaced: false, status: 'open', createdAt: 2000,
    ...over,
  })

  it('an officer CAN punch in to an outlet', async () => {
    await assertSucceeds(setDoc(doc(asUser(U.rep), 'outlet_visits', 'v1'), visit(U.rep)))
  })

  it('an officer CANNOT create a visit already punched out', async () => {
    await assertFails(setDoc(doc(asUser(U.rep), 'outlet_visits', 'v1'),
      visit(U.rep, { punchOutAt: 3000, status: 'closed' })))
  })

  it('an officer CAN punch out with remarks', async () => {
    await seed((db) => setDoc(doc(db, 'outlet_visits', 'v1'), visit(U.rep)))
    await assertSucceeds(updateDoc(doc(asUser(U.rep), 'outlet_visits', 'v1'), {
      remarksCategory: 'no_order_competitor',
      remarksReason: 'Heavy competitor discounting',
      remarksText: 'Owner says the rival brand is running a 20 percent scheme this month.',
      punchOutAt: 3000, durationMinutes: 17, status: 'closed',
    }))
  })

  it('an officer CANNOT move the punch-in time or location after the fact', async () => {
    await seed((db) => setDoc(doc(db, 'outlet_visits', 'v1'), visit(U.rep)))
    await assertFails(updateDoc(doc(asUser(U.rep), 'outlet_visits', 'v1'), { punchInAt: 1 }))
    await assertFails(updateDoc(doc(asUser(U.rep), 'outlet_visits', 'v1'),
      { punchInLocation: { lat: 0, lng: 0, accuracy: 1, capturedAt: 1 } }))
  })

  it('an officer CANNOT reassign a visit to a different outlet', async () => {
    await seed((db) => setDoc(doc(db, 'outlet_visits', 'v1'), visit(U.rep)))
    await assertFails(updateDoc(doc(asUser(U.rep), 'outlet_visits', 'v1'), { partyId: 'p2' }))
  })

  it('an officer CANNOT edit a visit once punched out', async () => {
    await seed((db) => setDoc(doc(db, 'outlet_visits', 'v1'),
      visit(U.rep, { status: 'closed', punchOutAt: 3000 })))
    await assertFails(updateDoc(doc(asUser(U.rep), 'outlet_visits', 'v1'),
      { remarksText: 'rewriting history after the fact' }))
  })

  it('a manager with view_reports CAN read any outlet visit', async () => {
    await seed((db) => setDoc(doc(db, 'outlet_visits', 'v2'), visit(U.rep2)))
    await assertSucceeds(getDoc(doc(asUser(U.mgr), 'outlet_visits', 'v2')))
    await assertFails(getDoc(doc(asUser(U.rep), 'outlet_visits', 'v2')))
  })
})

describe('field app — routes', () => {
  const route = { name: 'Kochi North', outletIds: ['p1'], assignedTo: ['rep_1'], active: true, createdBy: 'admin_1', createdByName: 'admin_1', createdAt: 1 }

  it('any approved user CAN read routes — they pick their beat from them', async () => {
    await seed((db) => setDoc(doc(db, 'sales_routes', 'r1'), route))
    await assertSucceeds(getDoc(doc(asUser(U.rep), 'sales_routes', 'r1')))
  })

  it('an officer CANNOT create or edit a route', async () => {
    await assertFails(setDoc(doc(asUser(U.rep), 'sales_routes', 'r2'), route))
  })

  it('an admin CAN create a route', async () => {
    await assertSucceeds(setDoc(doc(asUser(U.admin), 'sales_routes', 'r2'), route))
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
