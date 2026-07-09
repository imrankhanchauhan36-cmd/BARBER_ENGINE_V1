//////////////////////////////////////////////////////
// ZEMISH — Approvals Store (Zustand)
// Global state for approvals module
//////////////////////////////////////////////////////

import { create } from 'zustand'

const useApprovalsStore = create((set, get) => ({
  // ─── State ───────────────────────────────────
  salons:       [],
  selectedId:   null,
  filter:       'ALL',
  search:       '',
  isLoading:    false,

  // ─── Actions ─────────────────────────────────
  setSalons:    (salons)    => set({ salons }),
  setFilter:    (filter)    => set({ filter }),
  setSearch:    (search)    => set({ search }),
  setSelected:  (id)        => set({ selectedId: id }),
  setLoading:   (isLoading) => set({ isLoading }),

  // Get selected salon
  getSelected: () => {
    const { salons, selectedId } = get()
    return salons.find(s => s.id === selectedId) || null
  },

  // Update single salon status
  updateSalon: (id, updates) => set(state => ({
    salons: state.salons.map(s => s.id === id ? { ...s, ...updates } : s)
  })),

  // Filtered salons
  getFiltered: () => {
    const { salons, filter, search } = get()
    return salons.filter(s => {
      const matchFilter = filter === 'ALL' || s.status === filter
      const matchSearch = !search || s.salon.toLowerCase().includes(search.toLowerCase()) || s.district.toLowerCase().includes(search.toLowerCase())
      return matchFilter && matchSearch
    })
  },
}))

export default useApprovalsStore