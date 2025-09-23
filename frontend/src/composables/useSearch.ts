import { ref, computed } from 'vue'

interface BetData {
  id: number
  title: string
  description: string
  myPosition?: string
  amount?: string
  status: 'active' | 'pending' | 'completed'
  participants?: string[]
  endDate: string
  isCreator: boolean
  isReferee: boolean
  isParticipant: boolean
  payout?: string
  won?: boolean
}

// Global search state
const searchQuery = ref('')

export function useSearch() {
  const setSearchQuery = (query: string) => {
    searchQuery.value = query
  }

  const clearSearch = () => {
    searchQuery.value = ''
  }

  const filterBets = (bets: BetData[]) => {
    if (!searchQuery.value.trim()) {
      return bets
    }

    const query = searchQuery.value.toLowerCase().trim()
    return bets.filter((bet) => {
      const titleMatch = bet.title.toLowerCase().includes(query)
      const descriptionMatch = bet.description.toLowerCase().includes(query)
      return titleMatch || descriptionMatch
    })
  }

  const isSearchActive = computed(() => searchQuery.value.trim().length > 0)

  return {
    searchQuery: computed(() => searchQuery.value),
    setSearchQuery,
    clearSearch,
    filterBets,
    isSearchActive,
  }
}
