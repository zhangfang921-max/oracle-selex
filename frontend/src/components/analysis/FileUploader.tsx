import { useCallback, useState } from 'react'
import { Upload, FileText, CheckCircle, AlertCircle, X, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FadeIn, Stagger } from '@/components/MotionPrimitives'
import type { UploadRound } from '@/types/analysis'

interface FileUploaderProps {
  rounds: UploadRound[]
  onRoundsChange: (rounds: UploadRound[]) => void
  disabled?: boolean
}

export function FileUploader({ rounds, onRoundsChange, disabled }: FileUploaderProps) {
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const addRound = () => {
    const nextNum = rounds.length > 0 ? Math.max(...rounds.map((r) => r.roundNumber)) + 1 : 1
    onRoundsChange([...rounds, { roundNumber: nextNum, file: null, fileName: '', status: 'pending' }])
  }

  const removeRound = (index: number) => {
    onRoundsChange(rounds.filter((_, i) => i !== index))
  }

  const handleFileSelect = useCallback(
    (index: number, file: File) => {
      const updated = [...rounds]
      updated[index] = { ...updated[index], file, fileName: file.name, status: 'pending' }
      onRoundsChange(updated)
    },
    [rounds, onRoundsChange]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault()
      setDragOverIndex(null)
      const file = e.dataTransfer.files[0]
      if (file) handleFileSelect(index, file)
    },
    [handleFileSelect]
  )

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }

  const statusIcon = (status: UploadRound['status']) => {
    switch (status) {
      case 'done':
        return <CheckCircle className="w-5 h-5 text-success" />
      case 'error':
        return <AlertCircle className="w-5 h-5 text-destructive" />
      case 'uploading':
        return (
          <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        )
      default:
        return <FileText className="w-5 h-5 text-muted-foreground" />
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
      <Stagger stagger={0.06} className="flex flex-col" style={{ gap: 'var(--spacing-sm)' }}>
        {rounds.map((round, index) => (
          <FadeIn key={index}>
            <div
              className={`relative border rounded-lg transition-colors ${
                dragOverIndex === index
                  ? 'border-primary bg-primary/5'
                  : round.file
                  ? 'border-border bg-card'
                  : 'border-dashed border-muted-foreground/30 bg-muted/30'
              }`}
              style={{ padding: 'var(--spacing-md)' }}
              onDrop={(e) => handleDrop(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={() => setDragOverIndex(null)}
            >
              <div className="flex items-center" style={{ gap: 'var(--spacing-md)' }}>
                <div
                  className="flex items-center justify-center rounded-md bg-primary text-primary-foreground font-semibold"
                  style={{
                    width: '2.5rem',
                    height: '2.5rem',
                    fontSize: 'var(--font-size-label)',
                    flexShrink: 0,
                  }}
                >
                  R{round.roundNumber}
                </div>

                <div className="flex-1 min-w-0">
                  {round.file ? (
                    <div className="flex items-center" style={{ gap: 'var(--spacing-xs)' }}>
                      {statusIcon(round.status)}
                      <span className="truncate text-sm">{round.fileName}</span>
                      {round.totalReads != null && (
                        <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
                          {round.totalReads.toLocaleString()} reads &middot;{' '}
                          {round.uniqueSequences?.toLocaleString()} unique
                        </span>
                      )}
                    </div>
                  ) : (
                    <label className="flex items-center cursor-pointer" style={{ gap: 'var(--spacing-xs)' }}>
                      <Upload className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Drop FASTA / FASTA.GZ file or click to browse
                      </span>
                      <input
                        type="file"
                        accept=".fasta,.fa,.fna,.txt,.tsv,.gz,.fasta.gz"
                        className="sr-only"
                        disabled={disabled}
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) handleFileSelect(index, f)
                        }}
                      />
                    </label>
                  )}
                </div>

                {!disabled && (
                  <button
                    onClick={() => removeRound(index)}
                    className="text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                    style={{ padding: 'var(--spacing-xs)' }}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </FadeIn>
        ))}
      </Stagger>

      {!disabled && (
        <div className="flex items-center flex-wrap" style={{ gap: 'var(--spacing-sm)' }}>
          <Button variant="outline" size="sm" onClick={addRound} className="self-start cursor-pointer">
            <Plus className="w-4 h-4 mr-1" />
            Add Round
          </Button>
          <span className="text-xs text-muted-foreground">
            Supported formats: <strong>.fasta</strong>, <strong>.fa</strong>, <strong>.fna</strong>, <strong>.fasta.gz</strong>, <strong>.fa.gz</strong>, <strong>.txt</strong>, <strong>.tsv</strong> (up to 200 MB)
          </span>
        </div>
      )}
    </div>
  )
}
