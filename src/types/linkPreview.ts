export type LinkPreviewStatus = 'ready' | 'fallback'

export type LinkPreview = {
  status: LinkPreviewStatus
  url: string
  domain: string
  title: string
  description: string
  siteName: string
  iconUrl: string
  updatedAt: string
}
