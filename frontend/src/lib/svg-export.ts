/**
 * Inline all computed styles into an SVG so it renders correctly standalone.
 * Attaches to DOM temporarily for accurate getComputedStyle.
 */
export function flattenSVG(svgElement: SVGSVGElement): void {
  const wasAttached = !!svgElement.parentNode
  if (!wasAttached) {
    svgElement.style.cssText = 'position:fixed;left:0;top:0;opacity:0.01;pointer-events:none;z-index:99999'
    document.body.appendChild(svgElement)
  }

  try {
    const allEls = svgElement.querySelectorAll('*')
    allEls.forEach((el) => {
      const e = el as SVGElement & HTMLElement
      const cs = window.getComputedStyle(e)
      if (!cs) return

      const tag = e.tagName.toLowerCase()

      // --- Force color attributes ---
      const attrsToResolve = ['fill', 'stroke']
      for (const attr of attrsToResolve) {
        const val = e.getAttribute(attr) || ''
        const needsResolve = val.includes('var(') || val.includes('oklch') || val === 'none' || val === ''
        if (needsResolve) {
          const c = cs.getPropertyValue(attr)
          if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'none' && !c.includes('var(')) {
            e.setAttribute(attr, c)
          }
        }
      }

      // --- Text elements: force all text rendering props ---
      if (tag === 'text' || tag === 'tspan') {
        for (const p of ['fill', 'font-size', 'font-family', 'font-weight', 'text-anchor']) {
          const c = cs.getPropertyValue(p)
          if (c && c !== 'rgba(0, 0, 0, 0)' && !c.includes('var(')) {
            e.setAttribute(p, c)
          }
        }
      }

      // --- Shape elements ---
      if (['rect', 'path', 'circle', 'ellipse', 'line'].includes(tag)) {
        for (const p of ['fill', 'stroke', 'stroke-width', 'opacity']) {
          const c = cs.getPropertyValue(p)
          if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'none' && !c.includes('var(')) {
            e.setAttribute(p, c)
          }
        }
      }
    })
  } finally {
    if (!wasAttached) {
      const p = svgElement.parentNode
      if (p) (p as Node).removeChild(svgElement)
      svgElement.style.cssText = ''
    }
  }
}

/**
 * Download a single chart panel as colored SVG.
 */
export function downloadChartPanel(containerEl: HTMLElement | null, name: string, opts?: { transparent?: boolean }): void {
  if (!containerEl) return
  const svg = containerEl.querySelector('svg.recharts-surface, svg[class*="recharts"]') as SVGSVGElement | null
  if (!svg) return

  const clone = svg.cloneNode(true) as SVGSVGElement
  flattenSVG(clone)

  const w = parseInt(svg.getAttribute('width') || '800')
  const h = parseInt(svg.getAttribute('height') || '400')

  const svgNS = 'http://www.w3.org/2000/svg'
  const out = document.createElementNS(svgNS, 'svg')
  out.setAttribute('xmlns', svgNS)
  out.setAttribute('width', String(w))
  out.setAttribute('height', String(h))
  out.setAttribute('viewBox', `0 0 ${w} ${h}`)

  if (!opts?.transparent) {
    const bg = document.createElementNS(svgNS, 'rect')
    bg.setAttribute('width', '100%')
    bg.setAttribute('height', '100%')
    bg.setAttribute('fill', '#ffffff')
    out.appendChild(bg)
  }

  while (clone.firstChild) out.appendChild(clone.firstChild)

  const svgStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(out)
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `chart_${name}.svg`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Legend item for panel capture */
interface LegendItem { color: string; text: string; isCircle?: boolean }

/**
 * Resolve a CSS color string (including oklch()) to an RGB/RGBA string usable on Canvas.
 * Uses a temporary DOM element + getComputedStyle for browser-native color resolution.
 */
function resolveColor(color: string): string {
  if (!color || color === 'transparent' || color === 'none') return '#888'
  // Canvas natively supports hex, rgb(), rgba(), and named colors — resolve everything else
  if (!color.startsWith('oklch') && !color.startsWith('color-mix') && !color.startsWith('lab') && !color.startsWith('lch')) {
    return color
  }
  const el = document.createElement('div')
  el.style.color = color
  el.style.display = 'none'
  document.body.appendChild(el)
  const resolved = window.getComputedStyle(el).color
  document.body.removeChild(el)
  return resolved || '#888'
}

/**
 * Download panel as PNG — auto-detects HTML legend and renders it on top of the SVG.
 *
 * @param containerEl — card-level element containing both SVG and [data-legend]
 * @param name — output filename (without extension)
 * @param opts.transparent — skip white background (for dark-background charts)
 * @param opts.legendStyle — 'overlay' (default, for absolutely-positioned legends) or 'bottom' (for side-column legends)
 */
export function downloadPanelAsPNG(
  containerEl: HTMLElement | null,
  name: string,
  opts?: { transparent?: boolean; legendStyle?: 'overlay' | 'bottom' }
): void {
  if (!containerEl) return
  const svg = containerEl.querySelector('svg.recharts-surface, svg[class*="recharts"]') as SVGSVGElement | null
  if (!svg) return

  const clone = svg.cloneNode(true) as SVGSVGElement
  flattenSVG(clone)

  // If transparent, remove any full-coverage background <rect> from the SVG
  if (opts?.transparent) {
    const bgRects = clone.querySelectorAll('rect')
    bgRects.forEach((r) => {
      const rw = parseFloat(r.getAttribute('width') || '0')
      const rh = parseFloat(r.getAttribute('height') || '0')
      const rx = parseFloat(r.getAttribute('x') || '0')
      const ry = parseFloat(r.getAttribute('y') || '0')
      const svgW = parseFloat(clone.getAttribute('width') || '700')
      const svgH = parseFloat(clone.getAttribute('height') || '700')
      if (Math.abs(rx) < 2 && Math.abs(ry) < 2 && Math.abs(rw - svgW) < 2 && Math.abs(rh - svgH) < 2) {
        r.remove()
      }
    })
  }

  // Use getBoundingClientRect for accurate pixel dimensions (not attribute-based)
  const rect = svg.getBoundingClientRect()
  const w = Math.round(rect.width) || parseInt(svg.getAttribute('width') || '800')
  const h = Math.round(rect.height) || parseInt(svg.getAttribute('height') || '400')

  // Build SVG
  const svgNS = 'http://www.w3.org/2000/svg'
  const outSvg = document.createElementNS(svgNS, 'svg')
  outSvg.setAttribute('xmlns', svgNS)
  outSvg.setAttribute('width', String(w))
  outSvg.setAttribute('height', String(h))
  outSvg.setAttribute('viewBox', `0 0 ${w} ${h}`)

  if (!opts?.transparent) {
    const bg = document.createElementNS(svgNS, 'rect')
    bg.setAttribute('width', '100%')
    bg.setAttribute('height', '100%')
    bg.setAttribute('fill', '#ffffff')
    outSvg.appendChild(bg)
  }
  while (clone.firstChild) outSvg.appendChild(clone.firstChild)

  const svgStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(outSvg)
  const url = URL.createObjectURL(new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' }))

  const legendStyle = opts?.legendStyle || 'overlay'
  const img = new Image()

  img.onerror = () => {
    console.warn(`[PNG export] Failed to load SVG image for "${name}", falling back to SVG download`)
    // Fallback: download as SVG
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
    const fallbackUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = fallbackUrl
    a.download = `${name}.svg`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(fallbackUrl)
    URL.revokeObjectURL(url)
  }

  img.onload = () => {
    try {
    const legendEl = containerEl.querySelector('[data-legend]') as HTMLElement | null
    const items = legendEl ? (Array.from(legendEl.children) as HTMLElement[]) : []
    const hasLegend = items.length > 0

    // Pre-compute legend layout for 'bottom' style (needed for canvas height)
    let bottomLegendRows: { colors: string[]; texts: string[]; itemWidths: number[] }[] = []
    let bottomLegendTotalH = 0
    if (hasLegend && legendStyle === 'bottom') {
      const legendX = 12; const spacing = 14; const bItemH = 18; const rowGap = 3
      const maxRowW = w - 24
      let curColors: string[] = []; let curTexts: string[] = []; let curWidths: number[] = []; let curW = 0
      const tmpCtx = document.createElement('canvas').getContext('2d')!
      tmpCtx.font = '600 11px system-ui, -apple-system, sans-serif'

      items.forEach((item) => {
        const svgCircle = item.querySelector('svg circle')
        let color = ''
        if (svgCircle) {
          color = resolveColor(svgCircle.getAttribute('fill') || '#888')
        } else {
          const svgRect = item.querySelector('svg rect')
          if (svgRect) {
            color = resolveColor(svgRect.getAttribute('fill') || '#888')
          } else {
            const colorSpan = item.querySelector('span[style*="background"]') as HTMLElement | null
            if (colorSpan) {
              let bg = colorSpan.style.backgroundColor
              if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') bg = colorSpan.style.background
              if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') color = resolveColor(bg)
            }
          }
        }
        if (!color) color = '#888'
        const textSpan = item.querySelector('span:last-child') as HTMLElement | null
        const cleanText = (textSpan?.textContent || item.textContent || '').replace(/^[●◆★]\s*/, '').trim()
        const textW = tmpCtx.measureText(cleanText).width
        const itemW = 14 + textW + spacing

        if (curColors.length > 0 && curW + itemW > maxRowW) {
          bottomLegendRows.push({ colors: curColors, texts: curTexts, itemWidths: curWidths })
          curColors = []; curTexts = []; curWidths = []; curW = 0
        }
        curColors.push(color); curTexts.push(cleanText); curWidths.push(itemW)
        curW += itemW
      })
      if (curColors.length > 0) bottomLegendRows.push({ colors: curColors, texts: curTexts, itemWidths: curWidths })
      bottomLegendTotalH = bottomLegendRows.length * bItemH + Math.max(0, bottomLegendRows.length - 1) * rowGap + 16
    }

    const legendHeight = legendStyle === 'bottom' ? bottomLegendTotalH : 0
    const canvasH = h + legendHeight

    const canvas = document.createElement('canvas')
    const scale = 3
    canvas.width = w * scale
    canvas.height = canvasH * scale
    const ctx = canvas.getContext('2d')!
    ctx.scale(scale, scale)
    // Fill background
    if (!opts?.transparent) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, canvasH)
    }
    ctx.drawImage(img, 0, 0, w, h)

    if (hasLegend) {
      if (legendStyle === 'bottom') {
        // Render pre-computed bottom legend rows
        const bItemH = 18; const rowGap = 3; const legendX = 12
        const legendY = h + 8

        bottomLegendRows.forEach((row, ri) => {
          let xCursor = legendX
          const rowY = legendY + ri * (bItemH + rowGap)
          row.colors.forEach((color, ii) => {
            ctx.fillStyle = color
            ctx.beginPath()
            ctx.arc(xCursor + 5, rowY + bItemH / 2, 3.5, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = 'rgba(255,255,255,0.5)'
            ctx.lineWidth = 0.8
            ctx.stroke()
            ctx.font = '600 11px system-ui, -apple-system, sans-serif'
            ctx.fillStyle = '#1a1a1a'
            ctx.fillText(row.texts[ii], xCursor + 12, rowY + bItemH / 2 + 4)
            xCursor += row.itemWidths[ii]
          })
        })
      } else {
        // 'overlay' style — absolutely positioned legend
        if (!legendEl) return
        const ls = legendEl.style
        const lTop = parseInt(ls.top) || 16
        const lLeft = parseInt(ls.left) || (w - 220)

        // Detect horizontal flex-wrap layout (Panel B) vs vertical column (Panel A)
        const isHorizontal = ls.display === 'flex' && ls.flexWrap === 'wrap'
        const itemH = 20

        if (items.length > 0) {
          if (isHorizontal) {
            // ── Multi-row wrapping (matches flex-wrap webpage layout) ──
            const itemH = 22
            const rowGap = 4
            const spacing = 12
            // Use DOM maxWidth if set (e.g., '100px'), otherwise fall back to available width
            const domMaxW = ls.maxWidth ? parseInt(ls.maxWidth) : 0
            const maxRowW = domMaxW > 0 ? domMaxW : (w - lLeft - 16)  // respect CSS maxWidth for wrapping

            // Layout items into rows
            const rows: { items: Element[]; widths: number[]; rowW: number }[] = []
            let curRow: Element[] = []
            let curWidths: number[] = []
            let curW = 0

            items.forEach((item) => {
              const rawText = item.querySelector('span:last-child')?.textContent || item.textContent || ''
              const cleanText = rawText.replace(/^[●◆★]\s*/, '').trim()
              ctx.font = '600 14px system-ui, -apple-system, sans-serif'
              const textW = ctx.measureText(cleanText).width
              const itemW = 14 + textW + spacing  // 14 for marker + text + spacing

              if (curRow.length > 0 && curW + itemW > maxRowW) {
                rows.push({ items: curRow, widths: curWidths, rowW: curW })
                curRow = []; curWidths = []; curW = 0
              }
              curRow.push(item)
              curWidths.push(itemW)
              curW += itemW
            })
            if (curRow.length > 0) rows.push({ items: curRow, widths: curWidths, rowW: curW })

            const numRows = rows.length
            const totalH = numRows * itemH + (numRows - 1) * rowGap + 12
            const bgW = Math.max(80, Math.min(w - lLeft - 12, 340))

            // Background — use legend's actual CSS background
            const rx = 4; const ry = 4
            const bx = lLeft - 4; const by = lTop - 2
            const legendBg = ls.background || ls.backgroundColor || 'rgba(255,255,255,0.12)'
            ctx.fillStyle = legendBg.includes('rgba') ? legendBg : 'rgba(255,255,255,0.12)'
            ctx.beginPath()
            ctx.moveTo(bx + rx, by)
            ctx.lineTo(bx + bgW - rx, by)
            ctx.quadraticCurveTo(bx + bgW, by, bx + bgW, by + rx)
            ctx.lineTo(bx + bgW, by + totalH - ry)
            ctx.quadraticCurveTo(bx + bgW, by + totalH, bx + bgW - rx, by + totalH)
            ctx.lineTo(bx + rx, by + totalH)
            ctx.quadraticCurveTo(bx, by + totalH, bx, by + totalH - ry)
            ctx.lineTo(bx, by + rx)
            ctx.quadraticCurveTo(bx, by, bx + rx, by)
            ctx.closePath()
            ctx.fill()

            rows.forEach((row, ri) => {
              let xCursor = lLeft
              const rowY = lTop + ri * (itemH + rowGap)
              row.items.forEach((item, ii) => {
                // Detect color
                const svgCircle = item.querySelector('svg circle')
                let color = ''
                if (svgCircle) {
                  color = resolveColor(svgCircle.getAttribute('fill') || '#888')
                } else {
                  const svgRect = item.querySelector('svg rect')
                  if (svgRect) {
                    color = resolveColor(svgRect.getAttribute('fill') || '#888')
                  } else {
                    const colorSpan = item.querySelector('span[style*="background"]') as HTMLElement | null
                    if (colorSpan) {
                      let bg = colorSpan.style.backgroundColor
                      if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') bg = colorSpan.style.background
                      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') color = resolveColor(bg)
                    }
                  }
                }
                if (!color) color = '#888'

                // Extract text
                const rawText = item.querySelector('span:last-child')?.textContent || item.textContent || ''
                const cleanText = rawText.replace(/^[●◆★]\s*/, '').trim()

                // Draw indicator
                ctx.fillStyle = color
                ctx.beginPath()
                ctx.arc(xCursor + 6, rowY + itemH / 2, 4, 0, Math.PI * 2)
                ctx.fill()
                ctx.strokeStyle = 'rgba(255,255,255,0.6)'
                ctx.lineWidth = 1.2
                ctx.stroke()

                // Draw text
                ctx.font = '600 14px system-ui, -apple-system, sans-serif'
                ctx.fillStyle = '#1a1a1a'
                ctx.fillText(cleanText, xCursor + 14, rowY + itemH / 2 + 5)
                xCursor += row.widths[ii]
              })
            })
          } else {
            // ── Vertical column rendering (original Panel A style) ──
            const bgW = Math.max(80, Math.min(220, w - lLeft - 12))
            const bgH = items.length * itemH + 16
            ctx.fillStyle = 'rgba(255,255,255,0.85)'
            const rx = 4; const ry = 4
            const bx = lLeft - 6; const by = lTop - 4
            ctx.beginPath()
            ctx.moveTo(bx + rx, by)
            ctx.lineTo(bx + bgW - rx, by)
            ctx.quadraticCurveTo(bx + bgW, by, bx + bgW, by + rx)
            ctx.lineTo(bx + bgW, by + bgH - ry)
            ctx.quadraticCurveTo(bx + bgW, by + bgH, bx + bgW - rx, by + bgH)
            ctx.lineTo(bx + rx, by + bgH)
            ctx.quadraticCurveTo(bx, by + bgH, bx, by + bgH - ry)
            ctx.lineTo(bx, by + rx)
            ctx.quadraticCurveTo(bx, by, bx + rx, by)
            ctx.closePath()
            ctx.fill()

            items.forEach((item, i) => {
              const y = lTop + i * itemH + 12

              const svgCircle = item.querySelector('svg circle')
              let color = ''
              if (svgCircle) {
                color = resolveColor(svgCircle.getAttribute('fill') || '#888')
              } else {
                const svgRect = item.querySelector('svg rect')
                if (svgRect) {
                  color = resolveColor(svgRect.getAttribute('fill') || '#888')
                } else {
                  const colorSpan = item.querySelector('span[style*="background"]') as HTMLElement | null
                  if (colorSpan) {
                    let bg = colorSpan.style.backgroundColor
                    if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') bg = colorSpan.style.background
                    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') color = resolveColor(bg)
                  }
                }
              }
              if (!color) color = '#888'

              ctx.fillStyle = color
              ctx.beginPath()
              ctx.arc(lLeft + 4, y - 2, 4, 0, Math.PI * 2)
              ctx.fill()
              ctx.strokeStyle = 'rgba(255,255,255,0.6)'
              ctx.lineWidth = 1.2
              ctx.stroke()

              ctx.fillStyle = '#1a1a1a'
              const textSpan = item.querySelector('span:last-child') as HTMLElement | null
              const rawText = textSpan?.textContent || item.textContent || ''
              const cleanText = rawText.replace(/^[●◆★]\s*/, '').trim()
              ctx.font = cleanText.length > 15
                ? '600 11px system-ui, -apple-system, sans-serif'
                : '600 13px system-ui, -apple-system, sans-serif'
              ctx.fillText(cleanText, lLeft + 14, y + 2)
            })
          }
        }
      }
    }

    canvas.toBlob(blob => {
      if (!blob) return
      const pngUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = pngUrl
      a.download = `${name}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(pngUrl)
    }, 'image/png')
    } catch (e: any) {
      console.warn(`[PNG export] Legend render error for "${name}":`, e.message)
      // Fallback: still try to save as PNG without legend (chart only)
      const canvas = document.createElement('canvas')
      canvas.width = w * 3
      canvas.height = h * 3
      const ctx = canvas.getContext('2d')!
      ctx.scale(3, 3)
      if (!opts?.transparent) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h) }
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(blob => {
        if (!blob) return
        const pngUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = pngUrl
        a.download = `${name}.png`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(pngUrl)
      }, 'image/png')
    }
  }
  img.src = url
}
