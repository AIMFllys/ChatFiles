import type { WechatMessage } from '../types/chatIdentity.js'

export type LegacyOwnerHints = {
  ownerWxidPattern: string | RegExp | null
  ownerName: string
}

export function resolveMessageOwnership(message: WechatMessage, hints: LegacyOwnerHints) {
  if (message.is_own === 0 || message.is_own === 1) return message.is_own === 1

  const pattern = typeof hints.ownerWxidPattern === 'string'
    ? hints.ownerWxidPattern ? new RegExp(hints.ownerWxidPattern, 'i') : null
    : hints.ownerWxidPattern
  if (pattern?.test(message.sender || '')) return true
  return Boolean(hints.ownerName && (message.sender_name || '').includes(hints.ownerName))
}

export function messageRenderKey(message: WechatMessage, index: number) {
  return message.message_uid || `${message.seq}-${index}`
}
