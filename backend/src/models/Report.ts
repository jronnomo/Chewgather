import mongoose, { Document, Schema } from 'mongoose';

export type ReportTargetType = 'user' | 'plan';
export type ReportStatus = 'open' | 'reviewed' | 'dismissed';

export interface IReport extends Document {
  reporterId: mongoose.Types.ObjectId;
  targetType: ReportTargetType;
  targetId: mongoose.Types.ObjectId;
  reason: string;
  detail?: string;
  status: ReportStatus;
  createdAt: Date;
  updatedAt: Date;
}

const ReportSchema = new Schema<IReport>(
  {
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    targetType: { type: String, enum: ['user', 'plan'], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 100 },
    detail: { type: String, trim: true, maxlength: 1000 },
    status: { type: String, enum: ['open', 'reviewed', 'dismissed'], default: 'open' },
  },
  { timestamps: true }
);

// One open report per reporter per target keeps repeat-tapping from flooding
// the moderation queue; a new report is allowed once the prior one is closed.
ReportSchema.index(
  { reporterId: 1, targetType: 1, targetId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } }
);

export default mongoose.model<IReport>('Report', ReportSchema);
