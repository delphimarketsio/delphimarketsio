import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export type ToastInput = {
  type?: ToastType
  title?: string
  message: string
  duration?: number // ms
}

export type Toast = Required<Omit<ToastInput, 'duration' | 'type'>> & {
  id: number
  type: ToastType
  duration: number
}

let nextId = 1

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Toast[]>([])
  const timers = new Map<number, ReturnType<typeof setTimeout>>()

  function remove(id: number) {
    const idx = toasts.value.findIndex((t) => t.id === id)
    if (idx !== -1) toasts.value.splice(idx, 1)
    const timer = timers.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.delete(id)
    }
  }

  function clear() {
    toasts.value = []
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
  }

  function show(input: ToastInput) {
    const id = nextId++
    const toast: Toast = {
      id,
      type: input.type ?? 'info',
      title: input.title ?? '',
      message: input.message,
      duration: Math.max(1500, Math.min(input.duration ?? 3500, 10000)),
    }
    toasts.value.push(toast)
    const timer = setTimeout(() => remove(id), toast.duration)
    timers.set(id, timer)
    return id
  }

  const success = (message: string, title?: string, duration?: number) =>
    show({ type: 'success', message, title, duration })
  const error = (message: string, title?: string, duration?: number) =>
    show({ type: 'error', message, title, duration: duration ?? 5000 })
  const info = (message: string, title?: string, duration?: number) =>
    show({ type: 'info', message, title, duration })
  const warning = (message: string, title?: string, duration?: number) =>
    show({ type: 'warning', message, title, duration })

  return { toasts, show, success, error, info, warning, remove, clear }
})
