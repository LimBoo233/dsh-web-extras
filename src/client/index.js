/**
 * dsh-web-extras 浏览器半入口：组合两个功能模块的 apply。
 * 完成提醒（notify）与外观定制（appearance）各自独立注册 Slot 与样式。
 */
import * as React from 'react'
import { applyNotify } from './notify.js'
import { applyAppearance } from './appearance.js'

export const name = 'dsh-web-extras'
export const inject = ['timer']

export function apply(ctx) {
  applyNotify(ctx)
  applyAppearance(ctx)
}
