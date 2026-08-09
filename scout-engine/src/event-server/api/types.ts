// scout-engine/src/event-server/api/types.ts
// Shared types for the event ingestion server API.

export type Severity = 'info' | 'warning' | 'critical' | 'breach';

export interface SecurityEventRow {
  id: string;
  severity: Severity;
  source: string;
  event_type: string;
  description: string;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  session_id: string | null;
  instance_id: string | null;
  mitigated: boolean;
  created_at: string;
}

export interface IncomingEventPayload {
  severity: Severity;
  source: string;
  event_type: string;
  description: string;
  metadata?: Record<string, unknown>;
  ip_address?: string;
  session_id?: string;
  instance_id?: string;
}
