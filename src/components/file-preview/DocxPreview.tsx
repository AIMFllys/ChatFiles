import { useEffect, useRef } from 'react'
import { renderAsync } from 'docx-preview'
import { fileUrl, type BrowsableFile } from '../../utils/tree'

export function DocxPreview({ file }: { file: BrowsableFile }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let mounted = true
    const run = async () => {
      if (!ref.current) return
      ref.current.innerHTML = ''
      const blob = await fetch(fileUrl(file)).then((res) => res.blob())
      if (mounted && ref.current) await renderAsync(blob, ref.current, undefined, { className: 'docx-render' })
    }
    run().catch(() => {
      if (ref.current) ref.current.textContent = 'DOCX 预览失败，可使用右上角下载。'
    })
    return () => {
      mounted = false
    }
  }, [file])
  return <div className="docx-host" ref={ref} />
}
