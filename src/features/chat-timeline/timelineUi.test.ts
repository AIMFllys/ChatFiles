import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

function source(name: string) {
  const target = path.resolve(process.cwd(), 'src/features/chat-timeline', name)
  assert.equal(fs.existsSync(target), true, `${name} must exist`)
  return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
}

test('renders chat text through a dedicated bounded timeline', () => {
  const workspace = fs.readFileSync(
    path.resolve(process.cwd(), 'src/features/chat-library/ArtifactWorkspace.tsx'),
    'utf8',
  )
  const hook = source('useChatTimeline.ts')
  const timeline = source('ChatTimeline.tsx')
  const model = source('timelineModel.ts')
  const publicTypes = fs.readFileSync(path.resolve(process.cwd(), 'src/types.ts'), 'utf8')
  assert.match(publicTypes, /TimelineMessage/u)
  assert.match(workspace, /tab === 'chatText'[\s\S]*?<ChatTimeline/u)
  assert.match(hook, /const MAX_PAGES = 5/u)
  assert.match(hook, /AbortController/u)
  assert.match(timeline, /className="timeline-message-name"/u)
  assert.match(timeline, /formatTimelineDateTime\(timestamp, timeline\.timeZone\)/u)
  assert.match(model, /dateStyle/u)
  assert.match(model, /second: '2-digit'/u)
  assert.match(hook, /encodeBrowserTimelineCursor/u)
  assert.match(timeline, /<TimelineRail/u)
})

test('provides a searchable accessible participant panel', () => {
  const people = source('PeoplePopover.tsx')
  assert.match(people, /role="dialog"/u)
  assert.match(people, /aria-label="筛选发言人"/u)
  assert.match(people, /participantMatches/u)
  assert.match(people, /onKeyDown/u)
})
