import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const indexCss = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8')
const libraryCss = [
  'chat-library-shell.css',
  'chat-library-workspace.css',
  'chat-library-cards.css',
  'chat-library-dialog.css',
  'chat-library-responsive.css',
].map((name) => fs.readFileSync(path.resolve(process.cwd(), 'src/styles', name), 'utf8')).join('\n')
const layoutCss = fs.readFileSync(path.resolve(process.cwd(), 'src/styles/layout.css'), 'utf8')
const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8')
const artifactCardSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/features/chat-library/ArtifactCard.tsx'),
  'utf8',
)

test('uses theme-aware foregrounds on semantic avatar colors', () => {
  assert.match(indexCss, /:root[\s\S]*?--chromatic-contrast:\s*#ffffff/u)
  assert.match(indexCss, /:root\[data-theme='dark'\][\s\S]*?--chromatic-contrast:\s*#101012/u)
  assert.match(libraryCss, /\.collection-icon,[\s\S]*?color:\s*var\(--chromatic-contrast\)/u)
})

test('removes every chat chrome blur when reduced transparency is requested', () => {
  assert.match(libraryCss, /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?\.left-rail[\s\S]*?backdrop-filter:\s*none/u)
  assert.match(libraryCss, /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?\.artifact-type[\s\S]*?backdrop-filter:\s*none/u)
})

test('keeps the compact theme control above the minimum pointer target', () => {
  assert.match(layoutCss, /\.theme-switcher\s*\{[\s\S]*?width:\s*82px/u)
  assert.match(layoutCss, /\.theme-switcher button\s*\{[\s\S]*?min-width:\s*24px[\s\S]*?height:\s*30px/u)
})

test('announces the current global destination', () => {
  assert.match(appSource, /aria-current=\{activeTab === item\.id \? 'page' : undefined\}/u)
  assert.match(appSource, /aria-current=\{isConfig \? 'page' : undefined\}/u)
})

test('shows a readable artifact availability label on every artifact card', () => {
  assert.match(artifactCardSource, /artifactAvailabilityLabel\(item\.availability\)/u)
  assert.doesNotMatch(artifactCardSource, /aria-label=\{item\.availability\}/u)
})
