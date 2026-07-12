export type WechatMessage = {
  message_uid?: string
  seq: number
  time: number
  sort_seq?: number
  source_db?: string
  local_id?: number
  sender: string
  sender_name: string
  is_own?: 0 | 1
  sender_source?: string
  sender_audit?: string
  raw_type?: string
  type: number
  type_label: string
  text: string
}
