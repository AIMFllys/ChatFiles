import { Clock3, UsersRound } from 'lucide-react'
import type { TimelineBucket, TimelineParticipant } from '../../types'

function sampledBuckets(buckets: TimelineBucket[], maximum = 12) {
  if (buckets.length <= maximum) return buckets
  const sampled: TimelineBucket[] = []
  for (let index = 0; index < maximum; index += 1) {
    const bucket = buckets[Math.round(index * (buckets.length - 1) / (maximum - 1))]
    if (sampled.at(-1)?.key !== bucket.key) sampled.push(bucket)
  }
  return sampled
}

export function TimelineRail({
  buckets,
  participants,
  activeSender,
  onJump,
  onOpenPeople,
}: {
  buckets: TimelineBucket[]
  participants: TimelineParticipant[]
  activeSender: string
  onJump: (bucket: TimelineBucket) => void
  onOpenPeople: () => void
}) {
  return (
    <aside className="timeline-rail" aria-label="时间与发言人导航">
      <button
        aria-label={`筛选发言人，共 ${participants.length} 人`}
        className={activeSender ? 'timeline-people-button is-active' : 'timeline-people-button'}
        onClick={onOpenPeople}
        title="按发言人筛选"
        type="button"
      >
        <UsersRound size={16} />
      </button>
      <div className="timeline-rail-line" aria-hidden="true" />
      <div className="timeline-date-buttons">
        {sampledBuckets(buckets).map((bucket) => (
          <button
            key={bucket.key}
            onClick={() => onJump(bucket)}
            title={`${bucket.label} · ${bucket.messageCount.toLocaleString()} 条`}
            type="button"
          >
            <Clock3 size={11} />
            <span>{bucket.key.slice(2).replace('-', '/')}</span>
          </button>
        ))}
      </div>
    </aside>
  )
}
