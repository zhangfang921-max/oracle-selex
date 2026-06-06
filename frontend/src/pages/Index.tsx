import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dna, Upload, Layers, Search, FlaskConical, FileSpreadsheet, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FadeIn, Stagger, HoverLift } from '@/components/MotionPrimitives'
import { useAnalyses, useCreateAnalysis, useDeleteAnalysis } from '@/hooks/use-analysis'
import { toast } from 'sonner'

export default function Index() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const { data: analyses, isLoading } = useAnalyses()
  const createAnalysis = useCreateAnalysis()
  const deleteAnalysis = useDeleteAnalysis()

  const handleCreate = async () => {
    try {
      const analysis = await createAnalysis.mutateAsync(name || `Analysis ${new Date().toLocaleDateString()}`)
      toast.success('Analysis created')
      navigate(`/upload/${analysis.id}`)
    } catch {
      toast.error('Failed to create analysis')
    }
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Delete this analysis and all its data?')) return
    try {
      await deleteAnalysis.mutateAsync(id)
      toast.success('Analysis deleted')
    } catch {
      toast.error('Failed to delete')
    }
  }

  const features = [
    { icon: Upload, title: 'Simple Upload', desc: 'Upload a single FASTA file with automatic read count parsing' },
    { icon: Layers, title: 'Sequence & Structure Clustering', desc: 'Group similar sequences by identity or dot-bracket structure' },
    { icon: Search, title: 'Motif Discovery', desc: 'K-mer frequency analysis and consensus motif generation' },
    { icon: FlaskConical, title: 'G4 Screening', desc: 'G-quadruplex formation potential scoring (G4RNA Screener logic)' },
    { icon: Dna, title: 'RNA Folding', desc: 'ViennaRNA RNAfold with G-Quadruplex structure prediction' },
    { icon: FileSpreadsheet, title: 'Excel Export', desc: 'Download all results as formatted multi-sheet spreadsheets' },
  ]

  return (
    <div>
      {/* Hero — Glassmorphism gradient */}
      <section
        className="bg-hero text-hero-foreground relative overflow-hidden"
        style={{ padding: 'var(--spacing-3xl) var(--spacing-xl)' }}
      >
        {/* Gradient orbs for depth */}
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse at 30% 20%, oklch(0.5 0.2 265 / 0.3) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, oklch(0.5 0.15 320 / 0.2) 0%, transparent 50%)',
          }}
        />

        <div className="container max-w-4xl relative">
          <FadeIn>
            {/* Glass header bar */}
            <div className="flex items-center justify-between" style={{ marginBottom: 'var(--spacing-lg)', paddingBottom: 'var(--spacing-sm)', borderBottom: '1px solid rgba(255,255,255,0.2)' }}>
              <div className="flex items-center" style={{ gap: 'var(--spacing-sm)' }}>
                <Dna className="w-6 h-6 opacity-70" />
                <span
                  className="font-bold tracking-widest uppercase"
                  style={{ fontSize: 'var(--font-size-small)', letterSpacing: '0.2em', opacity: 0.8 }}
                >
                  ORACLE
                </span>
              </div>
              <span className="opacity-50" style={{ fontSize: 'var(--font-size-small)', letterSpacing: '0.05em' }}>
                G4 Aptamer SELEX Analyzer · V3
              </span>
            </div>

            <p
              className="uppercase tracking-widest opacity-50"
              style={{ fontSize: 'var(--font-size-small)', letterSpacing: '0.15em', marginBottom: 'var(--spacing-xs)' }}
            >
              Computational Biology Tools
            </p>
            <h1
              className="font-bold"
              style={{
                fontSize: 'var(--font-size-display)',
                lineHeight: '1.15',
                letterSpacing: 'var(--letter-spacing-tight)',
                marginBottom: 'var(--spacing-sm)',
                fontFamily: 'var(--font-family-heading)',
              }}
            >
              From FASTA to Aptamer Candidates
            </h1>
            <p
              className="opacity-60 max-w-2xl"
              style={{ fontSize: 'var(--font-size-body)', lineHeight: '1.6', marginBottom: 'var(--spacing-xl)' }}
            >
              Automated SELEX NGS data analysis with sequence clustering, motif discovery, G-quadruplex formation screening, and RNA secondary structure prediction.
            </p>
          </FadeIn>

          <FadeIn delay={0.2}>
            <div className="flex flex-wrap items-end" style={{ gap: 'var(--spacing-sm)' }}>
              <div style={{ minWidth: '280px', flex: 1, maxWidth: '400px' }}>
                <label className="text-sm font-medium opacity-70 block" style={{ marginBottom: '4px', fontSize: 'var(--font-size-small)' }}>
                  Analysis Name
                </label>
                <Input
                  placeholder="e.g. VEGF Aptamer Round 1-8"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-hero-foreground/10 border-hero-foreground/20 text-hero-foreground placeholder:text-hero-foreground/40"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                />
              </div>
              <Button
                onClick={handleCreate}
                disabled={createAnalysis.isPending}
                className="bg-accent text-accent-foreground hover:bg-accent/90 cursor-pointer font-semibold"
                size="lg"
                style={{ padding: 'var(--spacing-sm) var(--spacing-lg)' }}
              >
                <Upload className="w-5 h-5 mr-2" />
                {createAnalysis.isPending ? 'Creating...' : 'New Analysis'}
              </Button>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Features — journal article section style */}
      <section className="container max-w-5xl" style={{ padding: 'var(--spacing-2xl) var(--spacing-xl)' }}>
        <FadeIn>
          <div className="text-center" style={{ marginBottom: 'var(--spacing-xl)' }}>
            <h2
              className="font-bold"
              style={{ fontSize: 'var(--font-size-headline)', marginBottom: 'var(--spacing-xs)', fontFamily: 'var(--font-family-heading)' }}
            >
              Analysis Pipeline
            </h2>
            <p
              className="text-muted-foreground max-w-lg mx-auto"
              style={{ fontSize: 'var(--font-size-body)' }}
            >
              Automated, reproducible bioinformatics workflow for aptamer sequence characterization
            </p>
          </div>
        </FadeIn>

        <Stagger stagger={0.06} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3" style={{ gap: 'var(--spacing-md)' }}>
          {features.map((f) => (
            <HoverLift key={f.title}>
              <div
                className="h-full rounded-xl border border-border/50 shadow-sm hover:shadow-md transition-all"
                style={{ padding: 'var(--spacing-lg)', background: 'var(--glass-bg)', backdropFilter: 'blur(var(--glass-blur))' }}
              >
                <div
                  className="rounded-lg flex items-center justify-center"
                  style={{ width: 44, height: 44, marginBottom: 'var(--spacing-sm)', background: 'color-mix(in oklch, var(--primary) 12%, transparent)' }}
                >
                  <f.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold" style={{ marginBottom: '4px', fontSize: 'var(--font-size-title)' }}>
                  {f.title}
                </h3>
                <p className="text-muted-foreground" style={{ fontSize: 'var(--font-size-label)', lineHeight: 1.6 }}>{f.desc}</p>
              </div>
            </HoverLift>
          ))}
        </Stagger>
      </section>

      {/* Workflow — numbered like a journal Methods section */}
      <section
        className="border-t border-border"
        style={{ padding: 'var(--spacing-2xl) var(--spacing-xl)' }}
      >
        <div className="container max-w-4xl">
          <FadeIn>
            <h2
              className="font-bold"
              style={{ fontSize: 'var(--font-size-title)', marginBottom: 'var(--spacing-lg)', fontFamily: 'var(--font-family-heading)' }}
            >
              Methods
            </h2>
          </FadeIn>
          <Stagger stagger={0.08} className="flex flex-col" style={{ gap: 'var(--spacing-md)' }}>
            {[
              { step: '1', title: 'Upload FASTA File', desc: 'Upload your SELEX sequence file. ORACLE parses sequences and read counts automatically.' },
              { step: '2', title: 'Cluster Sequences', desc: 'Group similar sequences by identity or RNA secondary structure similarity using k-mer feature vectors.' },
              { step: '3', title: 'Screen & Predict', desc: 'Run G4RNA Screener, motif discovery, and ViennaRNA structure prediction on cluster representatives.' },
              { step: '4', title: 'Export Results', desc: 'Download all results as a formatted Excel file with separate sheets for each analysis module.' },
            ].map((item) => (
              <FadeIn key={item.step}>
                <div className="flex items-start" style={{ gap: 'var(--spacing-md)', paddingBottom: 'var(--spacing-md)', borderBottom: '1px solid var(--border)' }}>
                  <span
                    className="flex-shrink-0 font-bold text-primary tabular-nums"
                    style={{ fontSize: 'var(--font-size-title)', lineHeight: 1, width: '1.5rem' }}
                  >
                    {item.step}
                  </span>
                  <div>
                    <h3 className="font-semibold" style={{ marginBottom: '2px', fontSize: 'var(--font-size-body)' }}>{item.title}</h3>
                    <p className="text-muted-foreground" style={{ fontSize: 'var(--font-size-small)', lineHeight: 1.5 }}>{item.desc}</p>
                  </div>
                </div>
              </FadeIn>
            ))}
          </Stagger>
        </div>
      </section>

      {/* Previous Analyses */}
      <section className="container max-w-5xl" style={{ padding: 'var(--spacing-2xl) var(--spacing-xl)' }}>
        <FadeIn>
          <h2
            className="font-semibold"
            style={{ fontSize: 'var(--font-size-headline)', marginBottom: 'var(--spacing-md)' }}
          >
            Previous Analyses
          </h2>
        </FadeIn>

        {isLoading ? (
          <div className="text-muted-foreground text-sm">Loading...</div>
        ) : !analyses || analyses.length === 0 ? (
          <FadeIn>
            <div
              className="border border-dashed border-border rounded-lg text-center text-muted-foreground"
              style={{ padding: 'var(--spacing-2xl)' }}
            >
              No analyses yet. Create one above to get started.
            </div>
          </FadeIn>
        ) : (
          <Stagger stagger={0.05} className="flex flex-col" style={{ gap: 'var(--spacing-sm)' }}>
            {analyses.map((a) => (
              <HoverLift key={a.id}>
                <div
                  className="bg-card border border-border rounded-lg shadow-sm flex items-center cursor-pointer hover:border-primary/30 transition-colors"
                  style={{ padding: 'var(--spacing-md) var(--spacing-lg)' }}
                  onClick={() => {
                    if (a.rounds.length === 0) {
                      navigate(`/upload/${a.id}`)
                    } else {
                      navigate(`/analysis/${a.id}`)
                    }
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate" style={{ fontSize: 'var(--font-size-body)' }}>{a.name}</h3>
                    <div className="flex flex-wrap text-muted-foreground" style={{ fontSize: 'var(--font-size-small)', gap: 'var(--spacing-sm)', marginTop: '4px' }}>
                      <span>{a.rounds.length} round{a.rounds.length !== 1 ? 's' : ''}</span>
                      <span>{new Date(a.createdAt).toLocaleDateString()}</span>
                      {a.rounds.length > 0 && (
                        <span>
                          {a.rounds.reduce((s, r) => s + (Number(r.totalReads) || 0), 0).toLocaleString()} total reads
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(a.id, e)}
                    className="text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                    style={{ padding: 'var(--spacing-xs)' }}
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </HoverLift>
            ))}
          </Stagger>
        )}
      </section>

      {/* Footer */}
      <footer
        className="text-center text-xs text-muted-foreground border-t border-border"
        style={{ padding: 'var(--spacing-lg) var(--spacing-xl)' }}
      >
        ORACLE &mdash; Oligonucleotide Read Analysis &amp; Candidate Library Explorer
        &middot; Powered by ViennaRNA
      </footer>
    </div>
  )
}
