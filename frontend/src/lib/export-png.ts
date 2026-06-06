/**
 * Safe PNG export utility that handles html2canvas limitations
 * (e.g., unsupported oklch color function errors).
 */
export async function exportElementAsPNG(element: HTMLElement, filename: string): Promise<void> {
  // Suppress html2canvas oklch color parse errors during export
  const originalOnError = window.onerror
  const suppressedErrors: string[] = []

  const errorHandler = (event: PromiseRejectionEvent) => {
    if (event.reason?.message?.includes('oklch') || event.reason?.message?.includes('unsupported color')) {
      event.preventDefault()
      suppressedErrors.push(event.reason.message)
      return
    }
  }

  window.addEventListener('unhandledrejection', errorHandler)

  try {
    const { default: html2canvas } = await import('html2canvas')
    const canvas = await html2canvas(element, {
      backgroundColor: '#ffffff',
      scale: 3,
      useCORS: true,
      logging: false,
      onclone: (clonedDoc) => {
        // Convert oklch colors to hex fallbacks in the cloned document
        const allElements = clonedDoc.querySelectorAll('*')
        allElements.forEach((el) => {
          const style = (el as HTMLElement).style
          if (style) {
            const bg = style.backgroundColor
            const color = style.color
            const fill = style.fill
            if (bg && bg.includes('oklch')) style.backgroundColor = 'transparent'
            if (color && color.includes('oklch')) style.color = '#333333'
            if (fill && fill.includes('oklch')) style.fill = '#333333'
          }
        })
      },
    })
    const url = canvas.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  } finally {
    window.removeEventListener('unhandledrejection', errorHandler)
    window.onerror = originalOnError
  }
}
