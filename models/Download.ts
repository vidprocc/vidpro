import { Schema, model, type InferSchemaType } from 'mongoose';

const DownloadSchema = new Schema({
  url: { type: String, required: true },
  title: { type: String, required: true },
  status: {
    type: String,
    enum: ["pending", "downloading", "completed", "error"],
    default: "pending"
  }
}, {
  timestamps: true
});

DownloadSchema.index({ title: 1 });
DownloadSchema.index({ status: 1 });
DownloadSchema.index({ createdAt: -1 });

export type Download = InferSchemaType<typeof DownloadSchema>;
export const Download = model('Download', DownloadSchema);