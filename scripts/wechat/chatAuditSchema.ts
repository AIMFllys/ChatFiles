export type ChatAuditIssue = {
  code: string
  count: number
  detail: string
}

export type ChatAuditResult = {
  ok: boolean
  metrics: {
    conversations: number
    messages: number
    textMessages: number
    accounts: number
  }
  issues: ChatAuditIssue[]
}

export const requiredConversationColumns = [
  'id', 'account', 'owner', 'username', 'is_group', 'msg_count', 'text_count',
]

export const requiredMessageColumns = [
  'conv_id', 'message_uid', 'seq', 'source_snapshot', 'source_db', 'source_table',
  'local_id', 'server_id', 'sort_seq', 'time', 'sender', 'sender_name',
  'sender_prefix', 'is_own', 'sender_source', 'sender_audit', 'raw_type', 'type',
  'type_label', 'text',
]

export const requiredParseRunColumns = [
  'run_id', 'status', 'completed_at', 'selected_snapshot_count', 'selected_source_count',
  'source_conversation_count', 'source_message_count', 'output_conversation_count',
  'output_message_count', 'output_text_count', 'deduplicated_message_count',
]
