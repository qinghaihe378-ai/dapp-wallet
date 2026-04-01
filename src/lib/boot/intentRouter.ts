/**
 * Intent 路由占位：复杂策略在 BootPage 内根据 parseBootCommand 结果分支处理。
 */

import type { BootIntent } from './commandParser'

export type RoutedAction =
  | { action: 'immediate' }
  | { action: 'schedule' }
  | { action: 'info' }
  | { action: 'noop' }

export function routeIntent(intent: BootIntent): RoutedAction {
  switch (intent.type) {
    case 'buy':
    case 'sell':
      return { action: 'immediate' }
    case 'limit':
    case 'tpsl':
    case 'snipe':
      return { action: 'schedule' }
    case 'help':
    case 'list_tasks':
    case 'risk_show':
    case 'copy_add':
    case 'copy_remove':
    case 'copy_toggle':
      return { action: 'info' }
    case 'cancel':
      return { action: 'immediate' }
    default:
      return { action: 'noop' }
  }
}
