// Client-side export of a generated Doc to a SELF-CONTAINED file (images embedded
// inline), matching what the Doc tab renders. Word (.docx) and PDF.
//
// The heavy libs (docx, jspdf) are dynamically imported inside each exporter so they
// code-split out of the main bundle and only load when the user actually exports.
//
// Images: step.frameKey -> buildPublicObjectUrl() -> same-origin /cap4/... in prod,
// fetched as bytes and embedded. A failed image is skipped (export still succeeds).

import type { DocResponse } from "./api";
import { buildPublicObjectUrl, formatDuration } from "./format";

type LoadedImage = {
  dataUrl: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  type: "jpg" | "png";
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

function imageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
    img.onerror = () => reject(new Error("decode failed"));
    img.src = src;
  });
}

async function loadImage(frameKey: string): Promise<LoadedImage> {
  const res = await fetch(buildPublicObjectUrl(frameKey));
  if (!res.ok) throw new Error(`image ${res.status}`);
  const blob = await res.blob();
  const dataUrl = await blobToDataUrl(blob);
  const { width, height } = await imageDimensions(dataUrl);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const type: "jpg" | "png" = blob.type.includes("png") ? "png" : "jpg";
  return { dataUrl, bytes, width, height, type };
}

/** Fetch every step image once, concurrently (best-effort: failures map to null). */
async function loadImages(doc: DocResponse): Promise<Map<string, LoadedImage | null>> {
  const keys = Array.from(
    new Set(
      doc.sections.flatMap((s) => s.steps.map((step) => step.frameKey).filter((k): k is string => Boolean(k)))
    )
  );
  const entries = await Promise.all(
    keys.map(async (key): Promise<[string, LoadedImage | null]> => {
      try {
        return [key, await loadImage(key)];
      } catch {
        return [key, null];
      }
    })
  );
  return new Map(entries);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function sectionRange(startS: number | null, endS: number | null): string {
  if (startS === null) return "";
  return endS !== null ? `${formatDuration(startS)}–${formatDuration(endS)}` : formatDuration(startS);
}

// ---------------------------------------------------------------------------
// Word (.docx)
// ---------------------------------------------------------------------------

export async function exportDocx(doc: DocResponse, filenameBase: string): Promise<void> {
  const { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType } = await import("docx");
  const images = await loadImages(doc);

  const MAX_IMG_W = 480; // px, fits the default Word page text column
  const children: InstanceType<typeof Paragraph>[] = [];

  children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(doc.title ?? "Untitled doc")] }));
  if (doc.docType) {
    children.push(
      new Paragraph({ children: [new TextRun({ text: doc.docType.toUpperCase(), color: "888888", size: 18 })] })
    );
  }

  for (const section of doc.sections) {
    const range = sectionRange(section.startS, section.endS);
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun(section.heading + (range ? `  (${range})` : ""))]
      })
    );
    if (section.bodyMd.trim()) {
      for (const para of section.bodyMd.split(/\n{2,}/)) {
        if (para.trim()) children.push(new Paragraph({ children: [new TextRun(para.trim())] }));
      }
    }

    section.steps.forEach((step, idx) => {
      children.push(
        new Paragraph({
          spacing: { before: 120 },
          children: [new TextRun({ text: `${idx + 1}. `, bold: true }), new TextRun(step.text)]
        })
      );
      const img = step.frameKey ? images.get(step.frameKey) : null;
      if (img) {
        const w = Math.min(MAX_IMG_W, img.width);
        const h = Math.round((w / img.width) * img.height);
        children.push(
          new Paragraph({
            children: [
              new ImageRun({ data: img.bytes, type: img.type, transformation: { width: w, height: h } })
            ]
          })
        );
      }
      if (step.callout) {
        children.push(
          new Paragraph({
            indent: { left: 360 },
            children: [new TextRun({ text: step.callout, italics: true, color: "666666" })]
          })
        );
      }
    });
  }

  if (doc.confidenceNotes.length > 0) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun("Notes from generation")] }));
    for (const note of doc.confidenceNotes) {
      children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(note)] }));
    }
  }

  if (doc.model) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { before: 240 },
        children: [new TextRun({ text: `Generated by ${doc.model}`, color: "999999", size: 16 })]
      })
    );
  }

  const document = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(document);
  triggerDownload(blob, `${filenameBase}_doc.docx`);
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

export async function exportPdf(doc: DocResponse, filenameBase: string): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const images = await loadImages(doc);

  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const PAGE_W = pdf.internal.pageSize.getWidth();
  const PAGE_H = pdf.internal.pageSize.getHeight();
  const MARGIN = 42;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  let y = MARGIN;

  const ensure = (h: number) => {
    if (y + h > PAGE_H - MARGIN) {
      pdf.addPage();
      y = MARGIN;
    }
  };

  const writeText = (text: string, opts: { size: number; bold?: boolean; color?: [number, number, number]; gap?: number; indent?: number }) => {
    pdf.setFont("helvetica", opts.bold ? "bold" : "normal");
    pdf.setFontSize(opts.size);
    pdf.setTextColor(...(opts.color ?? [20, 20, 20]));
    const indent = opts.indent ?? 0;
    const lines = pdf.splitTextToSize(text, CONTENT_W - indent) as string[];
    const lineH = opts.size * 1.3;
    for (const line of lines) {
      ensure(lineH);
      pdf.text(line, MARGIN + indent, y + opts.size);
      y += lineH;
    }
    y += opts.gap ?? 0;
  };

  // Title + docType
  writeText(doc.title ?? "Untitled doc", { size: 18, bold: true, gap: 2 });
  if (doc.docType) writeText(doc.docType.toUpperCase(), { size: 9, color: [136, 136, 136], gap: 8 });

  for (const section of doc.sections) {
    const range = sectionRange(section.startS, section.endS);
    y += 6;
    writeText(section.heading + (range ? `  (${range})` : ""), { size: 13, bold: true, gap: 4 });
    if (section.bodyMd.trim()) writeText(section.bodyMd.trim(), { size: 10, color: [50, 50, 50], gap: 4 });

    section.steps.forEach((step, idx) => {
      writeText(`${idx + 1}. ${step.text}`, { size: 10, gap: 2 });

      const img = step.frameKey ? images.get(step.frameKey) : null;
      if (img) {
        // px -> pt at 96dpi (0.75), then clamp to the content column.
        let w = Math.min(CONTENT_W, img.width * 0.75);
        let h = (w / img.width) * img.height;
        // Cap very tall images so one screenshot can't dominate a page.
        const MAX_H = PAGE_H - MARGIN * 2 - 24;
        if (h > MAX_H) {
          h = MAX_H;
          w = (h / img.height) * img.width;
        }
        ensure(h + 6);
        pdf.addImage(img.dataUrl, img.type === "png" ? "PNG" : "JPEG", MARGIN, y, w, h);
        y += h + 8;
      }

      if (step.callout) writeText(step.callout, { size: 9, color: [110, 110, 110], indent: 16, gap: 4 });
    });
  }

  if (doc.confidenceNotes.length > 0) {
    y += 6;
    writeText("Notes from generation", { size: 11, bold: true, gap: 4 });
    for (const note of doc.confidenceNotes) writeText(`•  ${note}`, { size: 9, color: [90, 90, 90], indent: 8, gap: 2 });
  }

  if (doc.model) {
    y += 8;
    writeText(`Generated by ${doc.model}`, { size: 8, color: [150, 150, 150] });
  }

  triggerDownload(pdf.output("blob"), `${filenameBase}_doc.pdf`);
}
