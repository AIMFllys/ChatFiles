import type { ReactNode } from 'react'
import {
  Archive,
  BookOpenText,
  Brain,
  DatabaseZap,
  FileText,
  GraduationCap,
  Home,
  Layers3,
  LayoutGrid,
  Lightbulb,
  MessageSquareText,
  MessagesSquare,
  Sparkles,
} from 'lucide-react'

export type Tab =
  | 'overview'
  | 'chat'
  | 'files'
  | 'insights'
  | 'academics'
  | 'media'
  | 'summary'
  | 'clues'
  | 'synthesis'
  | 'databases'
  | 'candidates'
  | 'knowledge'
  | 'ai'

export interface NavItem {
  id: Tab
  label: string
  icon: ReactNode
}

/** upper rail — boards that directly present a finished result */
export const PRIMARY_NAV: NavItem[] = [
  { id: 'overview', label: '概览', icon: <Home size={20} /> },
  { id: 'chat', label: '聊天', icon: <MessagesSquare size={20} /> },
  { id: 'files', label: '文件', icon: <Archive size={20} /> },
  { id: 'insights', label: '洞察', icon: <Lightbulb size={20} /> },
  { id: 'academics', label: '学业', icon: <GraduationCap size={20} /> },
  { id: 'media', label: '媒体', icon: <LayoutGrid size={20} /> },
]

/** lower rail — configuration + evidence/working boards (not finished output) */
export const CONFIG_NAV: NavItem[] = [
  { id: 'summary', label: '总结', icon: <Brain size={20} /> },
  { id: 'clues', label: '线索', icon: <MessageSquareText size={20} /> },
  { id: 'synthesis', label: '聊天整理', icon: <FileText size={20} /> },
  { id: 'databases', label: '数据库', icon: <DatabaseZap size={20} /> },
  { id: 'candidates', label: '候选', icon: <Layers3 size={20} /> },
  { id: 'knowledge', label: '知识', icon: <BookOpenText size={20} /> },
  { id: 'ai', label: 'AI', icon: <Sparkles size={20} /> },
]

export const TAB_TITLES: Record<Tab, { eyebrow: string; title: string }> = {
  overview: { eyebrow: '午夜书斋 · 概览', title: '概览' },
  chat: { eyebrow: '解密微信 · 逐条重读', title: '聊天' },
  files: { eyebrow: '归档与索引 · 只读预览', title: '文件' },
  insights: { eyebrow: 'AI 札记 · 碎金合集', title: '洞察' },
  academics: { eyebrow: '基医强基 2501 · 学业线索', title: '学业' },
  media: { eyebrow: '归档副本 · 媒体复核', title: '媒体' },
  summary: { eyebrow: '证据分层 · 全局总结', title: '总结' },
  clues: { eyebrow: '聊天线索 · 证据复核', title: '线索' },
  synthesis: { eyebrow: '聊天整理 · 证据分层', title: '聊天整理' },
  databases: { eyebrow: '只读探测 · 数据库边界', title: '数据库' },
  candidates: { eyebrow: '未归档 · 价值候选', title: '候选' },
  knowledge: { eyebrow: '课程与笔记 · 知识整理', title: '知识' },
  ai: { eyebrow: 'AI 接入 · 自带模型', title: 'AI' },
}
