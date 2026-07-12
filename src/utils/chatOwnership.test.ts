import assert from 'node:assert/strict'
import test from 'node:test'

import type { WechatMessage } from '../types/chatIdentity.js'
import { messageRenderKey, resolveMessageOwnership } from './chatOwnership.js'

function message(overrides: Partial<WechatMessage> = {}): WechatMessage {
  return {
    seq: 4,
    time: 100,
    sender: 'wxid_peer',
    sender_name: '对方',
    type: 1,
    type_label: 'text',
    text: '你好',
    ...overrides,
  }
}

test('uses explicit canonical ownership even when legacy environment hints disagree', () => {
  assert.equal(
    resolveMessageOwnership(
      message({ is_own: 0, sender: 'wxid_owner', sender_name: '本人' }),
      { ownerWxidPattern: 'wxid_owner', ownerName: '本人' },
    ),
    false,
  )
  assert.equal(
    resolveMessageOwnership(message({ is_own: 1 }), { ownerWxidPattern: 'different', ownerName: '其他人' }),
    true,
  )
})

test('uses environment identity hints only for legacy messages without is_own', () => {
  assert.equal(
    resolveMessageOwnership(message({ sender: 'wxid_owner' }), { ownerWxidPattern: 'wxid_owner', ownerName: '' }),
    true,
  )
  assert.equal(
    resolveMessageOwnership(message({ sender_name: '本人（设备）' }), { ownerWxidPattern: '', ownerName: '本人' }),
    true,
  )
  assert.equal(resolveMessageOwnership(message(), { ownerWxidPattern: '', ownerName: '' }), false)
})

test('uses message_uid as the stable render key with a legacy fallback', () => {
  assert.equal(messageRenderKey(message({ message_uid: 'wxm:canonical-id' }), 9), 'wxm:canonical-id')
  assert.equal(messageRenderKey(message(), 9), '4-9')
})
