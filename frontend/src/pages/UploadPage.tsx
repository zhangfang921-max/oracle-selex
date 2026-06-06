import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Play, Loader2, AlertCircle, Upload, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FadeIn } from '@/components/MotionPrimitives'
import { useUploadFile, useAnalysisDetail } from '@/hooks/use-analysis'
import { toast } from 'sonner'
import { getErrorMessage } from '@/lib/api-client'

export default function UploadPage() {
  const { analysisId } = useParams<{ analysisId: string }>()
  const navigate = useNavigate()
  const uploadFile = useUploadFile()
  const { data: analysis } = useAnalysisDetail(analysisId ?? null)

  const [file, setFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const [lastError, setLastError] = useState('')
  const [uploadDone, setUploadDone] = useState(false)
  const [uploadResult, setUploadResult] = useState<{ totalReads: number; uniqueSequences: number } | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const handleFileSelect = useCallback((f: File) => {
    setFile(f)
    setLastError('')
    setUploadDone(false)
    setUploadResult(null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFileSelect(f)
  }, [handleFileSelect])

  const handleUpload = async () => {
    if (!analysisId || !file) return
    setIsUploading(true)
    setLastError('')
    setUploadProgress(`Uploading ${file.name} (${formatFileSize(file.size)})...`)

    try {
      const result = await uploadFile.mutateAsync({
        analysisId,
        roundNumber: 1,
        file,
      })
      setUploadDone(true)
      setUploadResult(result)
      toast.success('File uploaded successfully! Redirecting to analysis...')
      setTimeout(() => navigate(`/analysis/${analysisId}`), 1200)
    } catch (err: unknown) {
      const msg = getErrorMessage(err)
      setLastError(msg)
      toast.error(`Upload failed: ${msg}`)
    } finally {
      setIsUploading(false)
      setUploadProgress('')
    }
  }

  return (
    <div className="container max-w-2xl" style={{ padding: 'var(--spacing-xl)' }}>
      <FadeIn>
        <button
          onClick={() => navigate('/')}
          className="flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          style={{ marginBottom: 'var(--spacing-lg)', gap: 'var(--spacing-xs)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </button>

        <h1
          className="font-bold"
          style={{ fontSize: 'var(--font-size-headline)', marginBottom: 'var(--spacing-xs)' }}
        >
          Upload FASTA File
        </h1>
        <p className="text-muted-foreground" style={{ marginBottom: 'var(--spacing-xl)' }}>
          <strong>ORACLE</strong> / {analysis?.name || 'New Analysis'} — Upload your SELEX sequence file to begin analysis.
        </p>
      </FadeIn>

      <FadeIn delay={0.1}>
        <div
          className={`relative border-2 rounded-xl transition-all cursor-pointer ${
            dragOver
              ? 'border-primary bg-primary/5'
              : file
                ? 'border-border bg-card'
                : 'border-dashed border-muted-foreground/30 bg-muted/20'
          }`}
          style={{ padding: 'var(--spacing-2xl) var(--spacing-xl)', textAlign: 'center' }}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => {
            if (!isUploading) document.getElementById('file-input')?.click()
          }}
        >
          <input
            id="file-input"
            type="file"
            accept=".fasta,.fa,.fna,.txt,.tsv,.gz,.fasta.gz"
            className="sr-only"
            disabled={isUploading}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFileSelect(f)
            }}
          />

          {uploadDone && uploadResult ? (
            <div className="flex flex-col items-center" style={{ gap: 'var(--spacing-sm)' }}>
              <CheckCircle className="w-12 h-12 text-green-500" />
              <p className="font-semibold text-lg">Upload Complete</p>
              <p className="text-muted-foreground text-sm">
                {uploadResult.totalReads.toLocaleString()} total reads &middot;{' '}
                {uploadResult.uniqueSequences.toLocaleString()} unique sequences
              </p>
            </div>
          ) : file ? (
            <div className="flex flex-col items-center" style={{ gap: 'var(--spacing-sm)' }}>
              <Upload className="w-10 h-10 text-primary" />
              <p className="font-semibold">{file.name}</p>
              <p className="text-sm text-muted-foreground">{formatFileSize(file.size)}</p>
              <p className="text-xs text-muted-foreground">Click or drop to replace</p>
            </div>
          ) : (
            <div className="flex flex-col items-center" style={{ gap: 'var(--spacing-sm)' }}>
              <Upload className="w-10 h-10 text-muted-foreground" />
              <p className="font-medium">Drop your FASTA file here</p>
              <p className="text-sm text-muted-foreground">or click to browse</p>
            </div>
          )}
        </div>
      </FadeIn>

      <FadeIn delay={0.15}>
        <div
          className="bg-muted/50 border border-border rounded-lg text-sm text-muted-foreground"
          style={{ padding: 'var(--spacing-md)', marginTop: 'var(--spacing-lg)', marginBottom: 'var(--spacing-lg)' }}
        >
          <p className="font-semibold text-foreground" style={{ marginBottom: 'var(--spacing-xs)' }}>
            Supported Formats
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>Standard FASTA with read count in header (e.g. &gt;seq_name-123, size=123)</li>
            <li>Tab-separated: sequence &lt;tab&gt; count</li>
            <li>Plain FASTA (duplicates auto-counted)</li>
            <li>Gzipped files (.fasta.gz, .fa.gz)</li>
          </ul>
          <p className="mt-2 text-xs">Max file size: 200 MB. Large files (&gt;50 MB) may take 1-2 minutes to process.</p>
        </div>
      </FadeIn>

      {/* Error display */}
      {lastError && (
        <FadeIn>
          <div
            className="flex items-start border border-destructive/30 bg-destructive/5 rounded-lg text-sm"
            style={{ padding: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)', gap: 'var(--spacing-sm)' }}
          >
            <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-destructive">Upload Error</p>
              <p className="text-muted-foreground">{lastError}</p>
            </div>
          </div>
        </FadeIn>
      )}

      <FadeIn delay={0.2}>
        <div className="flex items-center justify-between" style={{ gap: 'var(--spacing-sm)' }}>
          <div className="text-sm text-muted-foreground">
            {uploadProgress && (
              <span className="text-primary font-medium">{uploadProgress}</span>
            )}
          </div>
          <Button
            onClick={handleUpload}
            disabled={!file || isUploading || uploadDone}
            className="cursor-pointer font-semibold"
            style={{ padding: 'var(--spacing-sm) var(--spacing-xl)' }}
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Upload &amp; Analyze
              </>
            )}
          </Button>
        </div>
      </FadeIn>
    </div>
  )
}
