// Tenant portal concerns: raised by a tenant, received and answered by staff.
export const CONCERN_STATUS = ["Sent", "Received", "In progress", "Resolved", "Closed"] as const;
export type ConcernStatus = (typeof CONCERN_STATUS)[number];

export interface ConcernUpdateDTO {
  id: string;
  kind: "followup" | "response" | "status";
  message: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
  attachments: AttachmentDTO[];
}

export interface AttachmentDTO {
  id: string;
  filename: string;
  mime: string;
  size: number;
}

export interface ConcernDTO {
  id: string;
  controlNo: string;
  property: string;
  tenantName: string;
  trade: string;
  location: string;
  concern: string;
  status: ConcernStatus;
  createdAt: string;
  receivedAt: string | null;
  receivedBy: string | null;
  createdByName: string;
  updates: ConcernUpdateDTO[];
  attachments: AttachmentDTO[];
  unseenFollowups: number;
}
