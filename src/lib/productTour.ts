export const PRODUCT_TOUR_REQUEST_EVENT = 'stowmind:start-product-tour'
export const PRODUCT_TOUR_STORAGE_KEY = 'stowmind.productTour.v1'
export const PRODUCT_TOUR_VERSION = 1

export type ProductTourStatus = 'started' | 'completed' | 'dismissed'

export interface ProductTourState {
  version: number
  status: ProductTourStatus
  lastStep?: number
  startedAt?: string
  completedAt?: string
}

export function readProductTourState(): ProductTourState | null {
  try {
    const raw = localStorage.getItem(PRODUCT_TOUR_STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<ProductTourState>
    if (value.version !== PRODUCT_TOUR_VERSION) return null
    if (value.status !== 'started' && value.status !== 'completed' && value.status !== 'dismissed') return null
    return value as ProductTourState
  } catch {
    return null
  }
}

export function writeProductTourState(state: ProductTourState) {
  localStorage.setItem(PRODUCT_TOUR_STORAGE_KEY, JSON.stringify(state))
}

export function requestProductTour() {
  window.dispatchEvent(new CustomEvent(PRODUCT_TOUR_REQUEST_EVENT))
}
