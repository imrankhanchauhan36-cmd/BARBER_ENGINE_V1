//////////////////////////////////////////////////////
// BARBER ENGINE V1
// admin-panel/src/pages/finance/api/finance.api.js
//////////////////////////////////////////////////////
import apiClient from '../../../api/client'

const EP = {
  SUMMARY:        '/admin/finance/summary',
  WALLETS:        '/admin/finance/wallets',
  WALLET_DETAIL:  (salonId) => `/admin/finance/wallets/${salonId}`, // ← NEW
  WALLET_FREEZE:  (id) => `/admin/finance/wallets/${id}/freeze`,
  TRANSACTIONS:   '/admin/finance/transactions',
  LEDGER:         (salonId) => `/admin/finance/ledger/${salonId}`,
  PAYOUT_SUMMARY: '/payouts/admin/summary',
  PAYOUT_LIST:    '/payouts/admin/list',
  PAYOUT_DETAIL:  (id) => `/payouts/admin/detail/${id}`, // ← NEW
  PAYOUT_APPROVE: (id) => `/payouts/admin/approve/${id}`,
  PAYOUT_REJECT:  (id) => `/payouts/admin/reject/${id}`,
  ANALYTICS_REVENUE_TREND: '/admin/finance/analytics/revenue-trend', // ← NEW
  ANALYTICS_STATES:        '/admin/finance/analytics/states',        // ← NEW
  ANALYTICS_TOP_SALONS:    '/admin/finance/analytics/top-salons',    // ← NEW
}

const FinanceAPI = {
  getSummary:       ()                    => apiClient.get(EP.SUMMARY),
  getWallets:       (params)              => apiClient.get(EP.WALLETS, params),
  getWalletDetail:  (salonId)             => apiClient.get(EP.WALLET_DETAIL(salonId)), // ← NEW
  freezeWallet:     (id, body)            => apiClient.patch(EP.WALLET_FREEZE(id), body),
  getTransactions:  (params)              => apiClient.get(EP.TRANSACTIONS, params),
  getTransaction:   (id)                   => apiClient.get(`${EP.TRANSACTIONS}/${id}`),
  getSalonLedger:   (salonId, params)     => apiClient.get(EP.LEDGER(salonId), params),
  getPayoutSummary: ()                    => apiClient.get(EP.PAYOUT_SUMMARY),
  getPayouts:       (params)              => apiClient.get(EP.PAYOUT_LIST, params),
  getPayoutDetail:  (id)                  => apiClient.get(EP.PAYOUT_DETAIL(id)), // ← NEW
  approvePayout:    (id, body)            => apiClient.patch(EP.PAYOUT_APPROVE(id), body),
  rejectPayout:     (id, body)            => apiClient.patch(EP.PAYOUT_REJECT(id), body),
  getRevenueTrend:     (params)           => apiClient.get(EP.ANALYTICS_REVENUE_TREND, params), // ← NEW
  getStatePerformance: ()                 => apiClient.get(EP.ANALYTICS_STATES),                // ← NEW
  getTopSalons:        (params)           => apiClient.get(EP.ANALYTICS_TOP_SALONS, params),     // ← NEW
}

export default FinanceAPI