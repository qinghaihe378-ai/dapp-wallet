import type { BootTaskKind } from './commandParser'
import type { LimitOrderPayload, SnipePayload, TpSlPayload } from './commandParser'
import { STORAGE_KEYS, loadJson, saveJson } from './storage'

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled'

export interface BootTask {
  id: string
  kind: BootTaskKind
  createdAt: number
  updatedAt: number
  status: TaskStatus
  title: string
  detail?: string
  payload: LimitOrderPayload | SnipePayload | TpSlPayload | Record<string, unknown>
}

function genId() {
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function loadTasks(): BootTask[] {
  return loadJson<BootTask[]>(STORAGE_KEYS.tasks, [])
}

export function saveTasks(tasks: BootTask[]) {
  saveJson(STORAGE_KEYS.tasks, tasks)
}

export function addTask(partial: Omit<BootTask, 'id' | 'createdAt' | 'updatedAt' | 'status'> & { status?: TaskStatus }): BootTask {
  const now = Date.now()
  const t: BootTask = {
    id: genId(),
    createdAt: now,
    updatedAt: now,
    status: partial.status ?? 'pending',
    kind: partial.kind,
    title: partial.title,
    detail: partial.detail,
    payload: partial.payload,
  }
  const list = loadTasks()
  list.unshift(t)
  saveTasks(list)
  return t
}

export function updateTask(id: string, patch: Partial<BootTask>) {
  const list = loadTasks()
  const i = list.findIndex((x) => x.id === id)
  if (i < 0) return
  list[i] = { ...list[i], ...patch, updatedAt: Date.now() }
  saveTasks(list)
}

export function cancelTask(id: string) {
  updateTask(id, { status: 'cancelled' })
}
