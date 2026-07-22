import { jsPDF } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';

export interface PdfExportOptions {
  pageSize?: 'auto' | 'a4' | 'a3';
  orientation?: 'landscape' | 'portrait';
  filename?: string;
}

/**
 * Export an SVG container to a high-resolution Vector PDF document.
 * Bypasses HTML5 <canvas> texture limits for large flowcharts.
 * Temporarily attaches cloned element to DOM to prevent detached node geometry errors.
 */
export async function exportFlowchartToPdf(
  svgElement: SVGElement,
  options: PdfExportOptions = {}
): Promise<void> {
  if (!svgElement) {
    throw new Error('Invalid SVG element passed to PDF exporter');
  }

  const { pageSize = 'auto', orientation, filename = 'renpy-flowchart.pdf' } = options;

  // Deep clone SVG element to prevent mutating live DOM
  const clonedSvg = svgElement.cloneNode(true) as SVGElement;

  // Temporarily attach to DOM in hidden position so layout/BBox calculations succeed
  clonedSvg.style.position = 'absolute';
  clonedSvg.style.top = '-9999px';
  clonedSvg.style.left = '-9999px';
  clonedSvg.style.visibility = 'hidden';
  document.body.appendChild(clonedSvg);

  try {
    const bbox = svgElement.getBoundingClientRect();
    const width = Math.max(bbox.width || clonedSvg.clientWidth || 800, 100);
    const height = Math.max(bbox.height || clonedSvg.clientHeight || 600, 100);

    clonedSvg.setAttribute('width', String(width));
    clonedSvg.setAttribute('height', String(height));
    if (!clonedSvg.getAttribute('viewBox')) {
      clonedSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }

    let doc: jsPDF;

    if (pageSize === 'auto') {
      const isLandscape = width >= height;
      doc = new jsPDF({
        orientation: isLandscape ? 'landscape' : 'portrait',
        unit: 'pt',
        format: [width, height],
      });
    } else {
      doc = new jsPDF({
        orientation: orientation || (width >= height ? 'landscape' : 'portrait'),
        unit: 'pt',
        format: pageSize,
      });
    }

    const pdfWidth = doc.internal.pageSize.getWidth();
    const pdfHeight = doc.internal.pageSize.getHeight();

    // Scale to fit page maintaining aspect ratio
    const scale = Math.min(pdfWidth / width, pdfHeight / height);
    const renderWidth = width * scale;
    const renderHeight = height * scale;
    const x = (pdfWidth - renderWidth) / 2;
    const y = (pdfHeight - renderHeight) / 2;

    await svg2pdf(clonedSvg, doc, {
      x,
      y,
      width: renderWidth,
      height: renderHeight,
    });

    doc.save(filename);
  } finally {
    if (clonedSvg.parentNode) {
      clonedSvg.parentNode.removeChild(clonedSvg);
    }
  }
}
