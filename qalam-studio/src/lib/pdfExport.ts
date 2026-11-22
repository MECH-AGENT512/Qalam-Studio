import type { SolvedAssignment } from '../types';

function cleanMarkdownForPdf(md: string): string[] {
  return md
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\*\*/g, '').replace(/`/g, '').trimEnd());
}

async function rasterizeDataUrlToPng(dataUrl: string): Promise<{ url: string; format: 'PNG' | 'JPEG' }> {
  if (!dataUrl.startsWith('data:image/svg+xml')) {
    return {
      url: dataUrl,
      format: dataUrl.includes('image/jpeg') ? 'JPEG' : 'PNG',
    };
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || 960;
      const height = img.naturalHeight || 720;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context unavailable'));
        return;
      }
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve({ url: canvas.toDataURL('image/png'), format: 'PNG' });
    };
    img.onerror = () => reject(new Error('Failed to load SVG diagram for PDF'));
    img.src = dataUrl;
  });
}

export async function exportAssignmentPdf(assignment: SolvedAssignment, courseTitle?: string): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;
  const maxWidth = pageWidth - margin * 2;
  let y = 20;

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > pageHeight - 18) {
      doc.addPage();
      y = 20;
    }
  };

  // Header band
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 26, 'F');
  doc.setTextColor(248, 250, 252);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Qalam Studio — Solved Assignment Report', margin, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `${courseTitle ? `${courseTitle}  ·  ` : ''}Generated ${new Date().toLocaleDateString()}`,
    margin,
    19
  );

  y = 36;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  const titleLines = doc.splitTextToSize(assignment.title, maxWidth) as string[];
  for (const line of titleLines) {
    ensureSpace(8);
    doc.text(line, margin, y);
    y += 7;
  }

  y += 2;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(71, 85, 105);
  const summaryLines = doc.splitTextToSize(assignment.promptSummary, maxWidth) as string[];
  for (const line of summaryLines) {
    ensureSpace(6);
    doc.text(line, margin, y);
    y += 5.5;
  }

  if (assignment.requirements.length > 0) {
    y += 4;
    ensureSpace(14);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(30, 64, 175);
    doc.text('Assignment Requirements', margin, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    for (const req of assignment.requirements) {
      const wrapped = doc.splitTextToSize(`• ${req}`, maxWidth - 4) as string[];
      for (const w of wrapped) {
        ensureSpace(5.5);
        doc.text(w, margin + 2, y);
        y += 5;
      }
    }
  }

  if (assignment.generatedImageUrl) {
    try {
      const rasterized = await rasterizeDataUrlToPng(assignment.generatedImageUrl);
      y += 6;
      const imgWidth = maxWidth * 0.88;
      const imgHeight = imgWidth * 0.72;
      ensureSpace(imgHeight + 18);
      const xOffset = margin + (maxWidth - imgWidth) / 2;
      doc.setDrawColor(226, 232, 240);
      doc.rect(xOffset - 1, y - 1, imgWidth + 2, imgHeight + 2);
      doc.addImage(rasterized.url, rasterized.format, xOffset, y, imgWidth, imgHeight);
      y += imgHeight + 5;
      if (assignment.imageCaption) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        const capLines = doc.splitTextToSize(`Figure: ${assignment.imageCaption}`, maxWidth) as string[];
        for (const c of capLines) {
          ensureSpace(5);
          doc.text(c, margin, y);
          y += 4.5;
        }
      }
    } catch (err) {
      console.warn('Could not embed image into PDF:', err);
    }
  }

  y += 6;
  ensureSpace(12);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text('Complete Worked Solution & Research Analysis', margin, y);
  y += 7;

  const lines = cleanMarkdownForPdf(assignment.solvedSolutionMarkdown);
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      y += 3;
      continue;
    }
    const isHeading = trimmed.startsWith('#');
    const cleanText = trimmed.replace(/^#+\s*/, '');
    doc.setFont('helvetica', isHeading ? 'bold' : 'normal');
    doc.setFontSize(isHeading ? 11.5 : 10);
    doc.setTextColor(isHeading ? 15 : 51, isHeading ? 23 : 65, isHeading ? 42 : 85);

    const wrapped = doc.splitTextToSize(cleanText, maxWidth) as string[];
    for (const w of wrapped) {
      ensureSpace(6);
      doc.text(w, margin, y);
      y += isHeading ? 6 : 5.2;
    }
    if (isHeading) y += 1.5;
  }

  if (assignment.referencesUsed.length > 0) {
    y += 6;
    ensureSpace(14);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(30, 64, 175);
    doc.text('Research References & Sources', margin, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(71, 85, 105);
    for (let i = 0; i < assignment.referencesUsed.length; i++) {
      const refWrapped = doc.splitTextToSize(`[${i + 1}] ${assignment.referencesUsed[i]}`, maxWidth) as string[];
      for (const r of refWrapped) {
        ensureSpace(5);
        doc.text(r, margin, y);
        y += 4.8;
      }
    }
  }

  const safeName = assignment.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48);
  doc.save(`${safeName || 'solved-assignment'}.pdf`);
}
