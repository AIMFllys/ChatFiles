import { z } from 'zod/v4'
import { wechatMessageSchema, type WechatMessage } from './chatIdentity.js'
import { stableIdSchema, timelineBucketKeySchema, unixSecondsSchema } from './primitives.js'

export type TimelineCursor = { time: number; messageUid: string }

export type TimelineMessage = WechatMessage & { message_uid: string }

export type TimelineParticipant = {
  id: string
  name: string
  messageCount: number
  lastTime: number
}

export type TimelineBucket = {
  key: string
  label: string
  startTime: number
  endTime: number
  messageCount: number
  cursor: string
}

export type TimelinePageInfo = {
  olderCursor: string | null
  newerCursor: string | null
  hasOlder: boolean
  hasNewer: boolean
}

export type TimelinePage = {
  conversationId: string
  limit: number
  messages: TimelineMessage[]
  participants: TimelineParticipant[]
  buckets: TimelineBucket[]
  pageInfo: TimelinePageInfo
}

export const timelineCursorSchema = z.object({
  time: unixSecondsSchema,
  messageUid: stableIdSchema,
}) satisfies z.ZodType<TimelineCursor>

export const timelineMessageSchema = wechatMessageSchema.extend({ message_uid: stableIdSchema }) satisfies z.ZodType<TimelineMessage>

export const timelineParticipantSchema = z.object({
  id: stableIdSchema,
  name: z.string(),
  messageCount: z.number().int().nonnegative(),
  lastTime: unixSecondsSchema,
}) satisfies z.ZodType<TimelineParticipant>

export const timelineBucketSchema = z.object({
  key: timelineBucketKeySchema,
  label: z.string().min(1),
  startTime: unixSecondsSchema,
  endTime: unixSecondsSchema,
  messageCount: z.number().int().nonnegative(),
  cursor: stableIdSchema,
}) satisfies z.ZodType<TimelineBucket>

export const timelinePageInfoSchema = z.object({
  olderCursor: stableIdSchema.nullable(),
  newerCursor: stableIdSchema.nullable(),
  hasOlder: z.boolean(),
  hasNewer: z.boolean(),
}) satisfies z.ZodType<TimelinePageInfo>

export const timelinePageSchema = z.object({
  conversationId: stableIdSchema,
  limit: z.number().int().min(1).max(240),
  messages: z.array(timelineMessageSchema),
  participants: z.array(timelineParticipantSchema),
  buckets: z.array(timelineBucketSchema),
  pageInfo: timelinePageInfoSchema,
}) satisfies z.ZodType<TimelinePage>
