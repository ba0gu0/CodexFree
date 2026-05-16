import { describe, expect, it } from 'vitest'
import { ProxyLedger } from './ledger'

describe('proxy ledger account sync', () => {
  it('removes account rows missing from the latest auth pool snapshot', () => {
    const ledger = new ProxyLedger(':memory:')
    try {
      ledger.syncAccountPool([
        { accountId: 'account-a', fingerprint: 'fingerprint-a', label: 'Account A' },
        { accountId: 'account-b', fingerprint: 'fingerprint-b', label: 'Account B' }
      ])
      ledger.syncAccountPool([
        { accountId: 'account-b', fingerprint: 'fingerprint-b2', label: 'Account B2' }
      ])

      expect(ledger.accounts()).toEqual([
        expect.objectContaining({
          accountId: 'account-b',
          fingerprint: 'fingerprint-b2',
          label: 'Account B2'
        })
      ])
    } finally {
      ledger.close()
    }
  })
})
