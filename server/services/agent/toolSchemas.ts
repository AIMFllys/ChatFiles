type JsonSchema = {
  type: 'object'
  properties: Record<string, Record<string, unknown>>
  required?: string[]
  additionalProperties: false
}

function tool(name: string, description: string, parameters: JsonSchema) {
  return { type: 'function' as const, function: { name, description, parameters } }
}

const limit = { type: 'integer', minimum: 1, maximum: 100, description: '返回数量上限' }
const conversationId = { type: 'string', minLength: 1, maxLength: 512 }
const assetId = { type: 'string', pattern: '^[0-9a-f]{64}$' }

export const AGENT_TOOL_SCHEMAS = [
  tool('list_conversations', '按名称列出会话及其消息范围。', {
    type: 'object', additionalProperties: false,
    properties: { query: { type: 'string', maxLength: 120 }, limit },
  }),
  tool('search_messages', '以关键词与可用向量混合搜索聊天原文，返回消息证据引用。', {
    type: 'object', additionalProperties: false, required: ['query'],
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 500 }, conversationId,
      sender: { type: 'string', maxLength: 512 }, after: { type: 'integer', minimum: 0 },
      before: { type: 'integer', minimum: 0 }, limit,
    },
  }),
  tool('get_message_context', '按稳定消息 UID 读取其前后有限条原文。', {
    type: 'object', additionalProperties: false, required: ['messageUid'],
    properties: {
      messageUid: { type: 'string', minLength: 1, maxLength: 512 },
      radius: { type: 'integer', minimum: 0, maximum: 20 },
    },
  }),
  tool('search_artifacts', '搜索作品、文档、Skills 与链接的名称和摘要。', {
    type: 'object', additionalProperties: false,
    properties: {
      query: { type: 'string', maxLength: 200 }, conversationId,
      category: { type: 'string', enum: ['all', 'work', 'document', 'skill', 'link'] }, limit,
    },
  }),
  tool('read_document', '按文件资产 ID 读取受支持文档的有界正文，不接受路径。', {
    type: 'object', additionalProperties: false, required: ['assetId'],
    properties: { assetId, maxCharacters: { type: 'integer', minimum: 1, maximum: 50_000 } },
  }),
  tool('get_timeline_slice', '读取一个会话的有界时间轴片段，可围绕消息 UID 定位。', {
    type: 'object', additionalProperties: false, required: ['conversationId'],
    properties: {
      conversationId, aroundMessageUid: { type: 'string', maxLength: 512 },
      sender: { type: 'string', maxLength: 512 }, query: { type: 'string', maxLength: 200 }, limit,
    },
  }),
  tool('get_link_preview', '按链接资产 ID 读取已安全解析的网页简介。', {
    type: 'object', additionalProperties: false, required: ['assetId'], properties: { assetId },
  }),
] as const

export type AgentToolName = typeof AGENT_TOOL_SCHEMAS[number]['function']['name']
