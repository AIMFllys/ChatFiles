import zlib from 'node:zlib'

import { truncateCodePoints } from './unicodeText.js'

const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

export function strictUtf8(buffer: Uint8Array, context: string) {
  try {
    return utf8Decoder.decode(buffer)
  } catch {
    throw new Error(`Invalid UTF-8 in ${context}`)
  }
}

export function decodeContent(value: unknown, context: string): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) {
    const buffer = Buffer.from(value)
    if (buffer.length >= 4 && buffer[0] === 0x28 && buffer[1] === 0xb5 && buffer[2] === 0x2f && buffer[3] === 0xfd) {
      try {
        return strictUtf8(zlib.zstdDecompressSync(buffer), context)
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Invalid UTF-8')) throw error
        throw new Error(`Unable to decompress zstd content in ${context}`, { cause: error })
      }
    }
    return strictUtf8(buffer, context)
  }
  return String(value)
}

export function typeLabel(type: number): string {
  switch (type) {
    case 1: return 'text'
    case 3: return 'image'
    case 34: return 'voice'
    case 43: return 'video'
    case 42: return 'card'
    case 47: return 'sticker'
    case 48: return 'location'
    case 49: return 'app'
    case 50: return 'voip'
    case 10000:
    case 10002: return 'system'
    default: return `type_${type}`
  }
}

function xmlTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  if (!match) return ''
  return match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
}

export function extractText(type: number, content: string, isGroup: boolean) {
  let senderPrefix = ''
  let body = content
  if (isGroup) {
    const match = content.match(new RegExp('^([0-9A-Za-z_@.\\-]+):\\n'))
    if (match) {
      senderPrefix = match[1]
      body = content.slice(match[0].length)
    }
  }

  if (type === 1) return { text: body.trim(), senderPrefix }
  if (type === 49 || body.includes('<appmsg')) {
    const title = xmlTag(body, 'title')
    const description = xmlTag(body, 'des')
    const url = xmlTag(body, 'url')
    const appName = xmlTag(body, 'sourcedisplayname') || xmlTag(body, 'appname')
    const extension = xmlTag(body, 'fileext')
    const parts: string[] = []
    if (title) parts.push(title)
    if (description && description !== title) parts.push(description)
    if (extension) parts.push(`[文件 .${extension}]`)
    if (url) parts.push(url)
    if (appName) parts.push(`(${appName})`)
    return { text: parts.join(' — ').trim() || '[链接/应用消息]', senderPrefix }
  }
  if (type === 3) return { text: '[图片]', senderPrefix }
  if (type === 34) return { text: '[语音]', senderPrefix }
  if (type === 43) return { text: '[视频]', senderPrefix }
  if (type === 47) return { text: '[表情]', senderPrefix }
  if (type === 42) return { text: `[名片] ${xmlTag(body, 'nickname')}`.trim(), senderPrefix }
  if (type === 48) return { text: '[位置]', senderPrefix }
  if (type === 10000 || type === 10002) {
    const systemText = body.replace(/<[^>]+>/g, '').trim()
    return {
      text: systemText ? truncateCodePoints(`[系统] ${systemText}`, 300) : '[系统消息]',
      senderPrefix,
    }
  }
  return { text: `[${typeLabel(type)}]`, senderPrefix }
}

export function contactDisplayName(
  username: string,
  nickName: string,
  remark: string,
  alias: string,
) {
  return remark.trim() || nickName.trim() || alias.trim() || username.trim()
}
