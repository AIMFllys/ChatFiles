import { z } from 'zod/v4'
import { stableIdSchema, unixSecondsSchema } from './primitives.js'

/** Canonical cross-runtime WeChat message DTO. */
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

export const wechatMessageSchema = z.object({
  message_uid: stableIdSchema.optional(),
  seq: z.number().int(),
  time: unixSecondsSchema,
  sort_seq: z.number().int().optional(),
  source_db: z.string().optional(),
  local_id: z.number().int().optional(),
  sender: z.string(),
  sender_name: z.string(),
  is_own: z.union([z.literal(0), z.literal(1)]).optional(),
  sender_source: z.string().optional(),
  sender_audit: z.string().optional(),
  raw_type: z.string().optional(),
  type: z.number().int(),
  type_label: z.string(),
  text: z.string(),
}) satisfies z.ZodType<WechatMessage>
