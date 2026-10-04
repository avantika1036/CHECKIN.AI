import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const organizationProfilesTable = pgTable("organization_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  hostLabel: text("host_label").notNull(),
  requiredFields: jsonb("required_fields").$type<string[]>().notNull(),
  notificationTarget: text("notification_target").notNull(),
  rulesSummary: jsonb("rules_summary").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const visitorVisitsTable = pgTable(
  "visitor_visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: text("profile_id")
      .notNull()
      .references(() => organizationProfilesTable.id),
    visitorName: text("visitor_name").notNull(),
    affiliation: text("affiliation"),
    hostName: text("host_name").notNull(),
    purpose: text("purpose").notNull(),
    unitNumber: text("unit_number"),
    groupSize: integer("group_size"),
    visitSlot: text("visit_slot"),
    status: text("status").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decisionAt: timestamp("decision_at", { withTimezone: true }),
    checkInAt: timestamp("check_in_at", { withTimezone: true }),
    checkOutAt: timestamp("check_out_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
  },
  (table) => [
    index("visitor_visits_profile_created_idx").on(table.profileId, table.createdAt),
    index("visitor_visits_profile_status_idx").on(table.profileId, table.status),
  ],
);

export const visitorNotificationsTable = pgTable(
  "visitor_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: text("profile_id")
      .notNull()
      .references(() => organizationProfilesTable.id),
    visitId: uuid("visit_id")
      .notNull()
      .references(() => visitorVisitsTable.id),
    recipient: text("recipient").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("visitor_notifications_profile_recipient_idx").on(
      table.profileId,
      table.recipient,
      table.createdAt,
    ),
  ],
);

export const visitorAuditEventsTable = pgTable(
  "visitor_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: text("profile_id")
      .notNull()
      .references(() => organizationProfilesTable.id),
    visitId: uuid("visit_id").references(() => visitorVisitsTable.id),
    actorName: text("actor_name").notNull(),
    eventType: text("event_type").notNull(),
    message: text("message").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("visitor_audit_profile_occurred_idx").on(
      table.profileId,
      table.occurredAt,
    ),
  ],
);

export const insertOrganizationProfileSchema = createInsertSchema(
  organizationProfilesTable,
).omit({ createdAt: true });
export const insertVisitorVisitSchema = createInsertSchema(visitorVisitsTable).omit({
  id: true,
  createdAt: true,
});
export const insertVisitorNotificationSchema = createInsertSchema(
  visitorNotificationsTable,
).omit({ id: true, createdAt: true });
export const insertVisitorAuditEventSchema = createInsertSchema(
  visitorAuditEventsTable,
).omit({ id: true, occurredAt: true });

export type OrganizationProfile = typeof organizationProfilesTable.$inferSelect;
export type VisitorVisit = typeof visitorVisitsTable.$inferSelect;
export type VisitorNotification = typeof visitorNotificationsTable.$inferSelect;
export type VisitorAuditEvent = typeof visitorAuditEventsTable.$inferSelect;
export type InsertOrganizationProfile = z.infer<
  typeof insertOrganizationProfileSchema
>;
export type InsertVisitorVisit = z.infer<typeof insertVisitorVisitSchema>;
export type InsertVisitorNotification = z.infer<
  typeof insertVisitorNotificationSchema
>;
export type InsertVisitorAuditEvent = z.infer<typeof insertVisitorAuditEventSchema>;