import type { Driver, DriveStep } from 'driver.js'
import { useCallback, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useI18n } from '@/i18n'
import {
  PRODUCT_TOUR_REQUEST_EVENT,
  readProductTourState,
  writeProductTourState,
  PRODUCT_TOUR_VERSION,
  type ProductTourState,
} from '@/lib/productTour'
import 'driver.js/dist/driver.css'

const TOUR_TARGETS = [
  '[data-tour="home-welcome"]',
  '[data-tour="home-health"]',
  '[data-tour="home-system-clean"]',
  '[data-tour="home-agent-cleanup"]',
  '[data-tour="sidebar-settings"]',
]

function waitForTourTargets(timeoutMs = 3000) {
  return new Promise<boolean>((resolve) => {
    const deadline = Date.now() + timeoutMs
    const check = () => {
      if (TOUR_TARGETS.every((selector) => document.querySelector(selector))) {
        resolve(true)
        return
      }
      if (Date.now() >= deadline) {
        resolve(false)
        return
      }
      window.setTimeout(check, 50)
    }
    check()
  })
}

function terminalState(state: ProductTourState | null) {
  return state?.status === 'completed' || state?.status === 'dismissed'
}

function nextState(status: ProductTourState['status'], lastStep?: number): ProductTourState {
  const now = new Date().toISOString()
  return {
    version: PRODUCT_TOUR_VERSION,
    status,
    lastStep,
    startedAt: status === 'started' ? now : undefined,
    completedAt: status === 'completed' ? now : undefined,
  }
}

export function ProductTour({ enabled }: { enabled: boolean }) {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const driverRef = useRef<Driver | null>(null)
  const startingRef = useRef(false)

  const startTour = useCallback(async (force: boolean) => {
    if (startingRef.current) return
    if (!force && terminalState(readProductTourState())) return

    if (driverRef.current?.isActive()) {
      if (!force) return
      driverRef.current.destroy()
      driverRef.current = null
    }

    startingRef.current = true
    if (location.pathname !== '/') navigate('/', { replace: false })
    const ready = await waitForTourTargets()
    if (!ready) {
      startingRef.current = false
      return
    }

    let driverFactory: typeof import('driver.js').driver
    try {
      driverFactory = (await import('driver.js')).driver
    } catch {
      startingRef.current = false
      return
    }
    const steps: DriveStep[] = [
      {
        element: '[data-tour="home-welcome"]',
        popover: {
          title: t('tour.welcomeTitle'),
          description: t('tour.welcomeDesc'),
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '[data-tour="home-health"]',
        popover: {
          title: t('tour.healthTitle'),
          description: t('tour.healthDesc'),
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="home-system-clean"]',
        popover: {
          title: t('tour.cleanTitle'),
          description: t('tour.cleanDesc'),
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="home-agent-cleanup"]',
        popover: {
          title: t('tour.agentCleanupTitle'),
          description: t('tour.agentCleanupDesc'),
          side: 'top',
        },
      },
      {
        element: '[data-tour="sidebar-settings"]',
        popover: {
          title: t('tour.settingsTitle'),
          description: t('tour.settingsDesc'),
          side: 'right',
        },
      },
    ]

    const instance = driverFactory({
      steps,
      animate: true,
      allowClose: true,
      allowKeyboardControl: true,
      overlayClickBehavior: 'close',
      overlayOpacity: 0.65,
      stagePadding: 8,
      stageRadius: 14,
      popoverClass: 'stowmind-tour-popover',
      showProgress: true,
      nextBtnText: t('tour.next'),
      prevBtnText: t('tour.previous'),
      doneBtnText: t('tour.done'),
      closeBtnLabel: t('tour.close'),
      onDestroyed: (_element, _step, options) => {
        const status = options.reason === 'done' ? 'completed' : 'dismissed'
        const state = nextState(status, options.state.activeIndex)
        writeProductTourState(state)
        driverRef.current = null
      },
    })
    driverRef.current = instance
    writeProductTourState(nextState('started'))
    startingRef.current = false
    instance.drive()
  }, [location.pathname, navigate, t])

  useEffect(() => {
    const handleRequest = () => {
      void startTour(true)
    }
    window.addEventListener(PRODUCT_TOUR_REQUEST_EVENT, handleRequest)
    return () => window.removeEventListener(PRODUCT_TOUR_REQUEST_EVENT, handleRequest)
  }, [startTour])

  useEffect(() => {
    if (!enabled || location.pathname !== '/' || terminalState(readProductTourState())) return
    const timer = window.setTimeout(() => {
      void startTour(false)
    }, 650)
    return () => window.clearTimeout(timer)
  }, [enabled, location.pathname, startTour])

  useEffect(() => {
    if (location.pathname === '/' || !driverRef.current?.isActive()) return
    driverRef.current.destroy()
    driverRef.current = null
  }, [location.pathname])

  useEffect(() => () => {
    if (driverRef.current?.isActive()) driverRef.current.destroy()
    driverRef.current = null
  }, [])

  return null
}
