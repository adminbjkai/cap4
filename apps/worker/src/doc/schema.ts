import { z } from "zod";

export const CropSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1)
});

export const DocStepSchema = z.object({
  text: z.string().min(1),
  frame_id: z.string().nullish(),
  crop: CropSchema.nullish(),
  alt: z.string().nullish(),
  callout: z.string().nullish()
});

export const DocSectionSchema = z.object({
  heading: z.string().min(1),
  body_md: z.string().default(""),
  steps: z.array(DocStepSchema).default([]),
  source_span: z.object({ start_s: z.number().min(0), end_s: z.number().min(0) }).nullish()
});

export const DocOutputSchema = z.object({
  title: z.string().min(1),
  doc_type: z.enum(["runbook", "tutorial", "sop"]),
  sections: z.array(DocSectionSchema).min(1),
  unused_frames: z.array(z.string()).default([]),
  confidence_notes: z.array(z.string()).default([])
});

export type DocOutput = z.infer<typeof DocOutputSchema>;
export type DocSection = z.infer<typeof DocSectionSchema>;
export type DocStep = z.infer<typeof DocStepSchema>;

export const TriageOutputSchema = z.object({
  frames: z.array(
    z.object({
      frame_id: z.string().min(1),
      caption: z.string().default(""),
      classification: z.enum(["content", "transition", "junk"])
    })
  )
});

export type TriageOutput = z.infer<typeof TriageOutputSchema>;

/** One entry per surviving frame, in the form the model sees. */
export type ManifestFrame = {
  frameId: string; // f_0001 …
  ts: number;
  caption: string;
  fileName: string; // relative to the job workdir
};
