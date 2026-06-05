import { useEffect, useState } from 'react'
import { DatabaseZap } from 'lucide-react'
import type { DatabasePreview as DatabasePreviewData } from '../../types'
import { formatBytes } from '../../utils/format'
import type { BrowsableFile } from '../../utils/tree'

export function DatabaseFilePreview({ file }: { file: BrowsableFile }) {
  const [previewState, setPreviewState] = useState<{ fileId: string; data: DatabasePreviewData }>()
  const [errorState, setErrorState] = useState<{ fileId: string; message: string }>()
  const unsupported = file.storage !== 'source'
  useEffect(() => {
    if (unsupported) return
    let cancelled = false
    fetch(`/api/source-file/${file.id}/database`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text())
        return res.json() as Promise<DatabasePreviewData>
      })
      .then((data) => {
        if (cancelled) return
        setPreviewState({ fileId: file.id, data })
        setErrorState(undefined)
      })
      .catch(() => {
        if (!cancelled) setErrorState({ fileId: file.id, message: '数据库结构读取失败，可下载后用本地工具查看。' })
      })
    return () => {
      cancelled = true
    }
  }, [file.id, unsupported])

  const error = unsupported ? '数据库预览只对全量源文件索引开放。' : errorState?.fileId === file.id ? errorState.message : ''
  const preview = previewState?.fileId === file.id ? previewState.data : undefined

  if (error) {
    return (
      <div className="empty-preview format-note">
        <DatabaseZap size={38} />
        <h2>数据库预览不可用</h2>
        <p>{error}</p>
      </div>
    )
  }
  if (!preview) return <div className="empty-preview">读取数据库结构中...</div>

  return (
    <div className="database-preview">
      <section className={preview.readable ? 'db-status readable' : 'db-status blocked'}>
        <DatabaseZap size={28} />
        <div>
          <strong>{preview.readable ? 'SQLite 可读' : '普通 SQLite 不可读'}</strong>
          <span>{formatBytes(preview.size)} · {new Date(preview.modified).toLocaleString()}</span>
          {!preview.readable && <p>{preview.error ?? '未知错误'}</p>}
        </div>
      </section>
      <section className="db-header">
        <strong>文件头</strong>
        <code>{preview.header}</code>
      </section>
      {preview.readable ? (
        <div className="db-table-list">
          {preview.tables.length ? (
            preview.tables.map((table) => (
              <section key={table.name}>
                <header>
                  <strong>{table.name}</strong>
                  <span>{table.rowCount == null ? '未知行数' : `${table.rowCount.toLocaleString()} 行`}</span>
                </header>
                <table>
                  <tbody>
                    {table.columns.map((column) => (
                      <tr key={`${table.name}:${column.name}`}>
                        <td>{column.name}</td>
                        <td>{column.type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))
          ) : (
            <p>没有读取到用户表。</p>
          )}
        </div>
      ) : (
        <div className="empty-preview format-note">
          <h2>已记录不可读边界</h2>
          <p>这类文件可能是 QQ NT/xwechat 自定义封装、WAL/SHM 辅助文件、加密库或被占用的数据库。当前只做只读探测，不写入、不修复、不破坏原库。</p>
        </div>
      )}
    </div>
  )
}
