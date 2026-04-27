#!/usr/bin/env node
/**
 * Phase 1.5 — #574 legacy migration verification (Mai, 2026-04-27)
 * HYBRID option per Đào msg 1348: Chromium + addInitScript pre-page wrapper
 * to capture exact migration code path. Time-boxed 30 min.
 *
 * NO secret material logged. Only shapes/booleans/error names/messages.
 */
const { chromium } = require('@playwright/test')
const fs = require('node:fs')

const PASS = fs.readFileSync('/tmp/mc-admin-pass.rotated', 'utf8').trim()
const USER = 'admin'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ ignoreHTTPSErrors: true })

  await context.addInitScript(() => {
    window.__mig_log = []
    const safeArg = (a) => {
      if (a instanceof Error) return { __err: true, name: a.name, message: a.message }
      if (typeof a === 'object') {
        try { return JSON.parse(JSON.stringify(a)) } catch { return String(a).slice(0, 200) }
      }
      return String(a).slice(0, 200)
    }
    const ow = console.warn.bind(console)
    const oe = console.error.bind(console)
    console.warn = function (...a) { window.__mig_log.push({ lvl: 'warn', msg: a.map(safeArg) }); return ow(...a) }
    console.error = function (...a) { window.__mig_log.push({ lvl: 'error', msg: a.map(safeArg) }); return oe(...a) }

    if (window.crypto && window.crypto.subtle) {
      const oS = window.crypto.subtle.sign.bind(window.crypto.subtle)
      window.crypto.subtle.sign = function (...a) {
        return oS(...a).then(
          (r) => { window.__mig_log.push({ lvl: 'crypto', op: 'sign', ok: true, byteLen: r && r.byteLength }); return r },
          (e) => { window.__mig_log.push({ lvl: 'crypto', op: 'sign', ok: false, errName: e.name, errMessage: e.message }); throw e }
        )
      }
      const oI = window.crypto.subtle.importKey.bind(window.crypto.subtle)
      window.crypto.subtle.importKey = function (...a) {
        return oI(...a).then(
          (r) => { window.__mig_log.push({ lvl: 'crypto', op: 'importKey', format: a[0], extractable: a[3], keyUsages: a[4], ok: true }); return r },
          (e) => { window.__mig_log.push({ lvl: 'crypto', op: 'importKey', format: a[0], ok: false, errName: e.name, errMessage: e.message }); throw e }
        )
      }
    }

    const origOpen = indexedDB.open.bind(indexedDB)
    indexedDB.open = function (n, v) { window.__mig_log.push({ lvl: 'idb', op: 'open', name: n, version: v }); return origOpen(n, v) }
    const origDel = indexedDB.deleteDatabase.bind(indexedDB)
    indexedDB.deleteDatabase = function (n) { window.__mig_log.push({ lvl: 'idb', op: 'delete', name: n }); return origDel(n) }
  })

  const page = await context.newPage()

  await page.goto('http://127.0.0.1:3000/login', { waitUntil: 'networkidle' })

  await page.fill('input[placeholder="Enter username"]', USER)
  await page.fill('input[type="password"]', PASS)
  await page.click('button:has-text("Sign in")')
  await page.waitForURL('http://127.0.0.1:3000/', { timeout: 10000 }).catch(() => null)
  await page.waitForTimeout(3000)

  const stateAfterLogin = await page.evaluate(async () => {
    const ls = {}
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = (localStorage.getItem(k) || '').length }
    let dbs = []
    try { dbs = (await indexedDB.databases()).map(d => ({ name: d.name, version: d.version })) } catch {}
    return { ls, dbs, location: location.href, logCount: (window.__mig_log || []).length }
  })

  // Seed legacy fixture using REAL pre-#574 format (PKCS8 base64url)
  const seedResult = await page.evaluate(async () => {
    const bufToBin = (buf) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsBinaryString(new Blob([buf])) })
    const bufToB64Url = async (buf) => { const bin = await bufToBin(buf); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') }
    const bufToHex = async (buf) => { const bin = await bufToBin(buf); let hex = ''; for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, '0'); return hex }
    const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
    const privPkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey)
    const pubRaw = await crypto.subtle.exportKey('raw', kp.publicKey)
    const digest = await crypto.subtle.digest('SHA-256', pubRaw)
    const privB64u = await bufToB64Url(privPkcs8)
    const pubB64u = await bufToB64Url(pubRaw)
    const deviceId = await bufToHex(digest)
    await new Promise((r) => { const req = indexedDB.deleteDatabase('mc-device-identity'); req.onsuccess = () => r(); req.onerror = () => r(); req.onblocked = () => r(); setTimeout(r, 3000) })
    localStorage.removeItem('mc-device-id')
    localStorage.removeItem('mc-device-pubkey')
    localStorage.removeItem('mc-device-privkey')
    localStorage.setItem('mc-device-id', deviceId)
    localStorage.setItem('mc-device-pubkey', pubB64u)
    localStorage.setItem('mc-device-privkey', privB64u)
    sessionStorage.setItem('__test_seed_did', deviceId)
    return { seeded: true, didLen: deviceId.length, pubLen: pubB64u.length, privLen: privB64u.length }
  })

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(7000)

  const finalState = await page.evaluate(async () => {
    const ls = {}
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = (localStorage.getItem(k) || '').length }
    let dbs = []
    try { dbs = await indexedDB.databases() } catch {}
    const idbInfo = []
    for (const db of dbs) {
      const info = { name: db.name, version: db.version }
      try {
        const open = indexedDB.open(db.name)
        await new Promise((res, rej) => { open.onsuccess = () => res(); open.onerror = () => rej('e'); open.onblocked = () => rej('b') })
        const conn = open.result
        info.stores = Array.from(conn.objectStoreNames || [])
        info.counts = {}
        if (info.stores.length) {
          const tx = conn.transaction(info.stores, 'readonly')
          for (const sn of info.stores) {
            await new Promise((r) => { const c = tx.objectStore(sn).count(); c.onsuccess = () => { info.counts[sn] = c.result; r() }; c.onerror = () => { info.counts[sn] = 'err'; r() } })
          }
        }
        conn.close()
      } catch (e) { info.error = String(e) }
      idbInfo.push(info)
    }
    const seededDid = sessionStorage.getItem('__test_seed_did')
    const currentDid = localStorage.getItem('mc-device-id')
    return {
      ls, idb: idbInfo,
      didMatchesSeed: !!seededDid && currentDid === seededDid,
      legacyPrivkeyStillPresent: localStorage.getItem('mc-device-privkey') !== null,
      logCount: (window.__mig_log || []).length,
      log: (window.__mig_log || []).slice(0, 80),
    }
  })

  const result = { engine: 'chromium-headless-shell-145', stateAfterLogin, seedResult, finalState }
  console.log(JSON.stringify(result, null, 2))

  await context.close()
  await browser.close()
}

main().catch((e) => { console.error('FATAL', e.name, e.message, e.stack); process.exit(1) })
