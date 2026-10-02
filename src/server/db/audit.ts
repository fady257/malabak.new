import type { D1Database } from "@cloudflare/workers-types";

export interface AuditEventInput {
  venueId: string;
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  createdAtMs: number;
}

export function auditEventStatement(db: D1Database, event: AuditEventInput): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO audit_events (id,venue_id,actor_user_id,entity_type,entity_id,action,created_at_ms)
    VALUES (?,?,?,?,?,?,?)
  `).bind(
    crypto.randomUUID(),
    event.venueId,
    event.actorUserId,
    event.entityType.slice(0, 60),
    event.entityId.slice(0, 120),
    event.action.slice(0, 80),
    event.createdAtMs,
  );
}
