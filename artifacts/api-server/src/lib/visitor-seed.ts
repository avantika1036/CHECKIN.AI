import { eq } from "drizzle-orm";
import {
  db,
  organizationProfilesTable,
  visitorAuditEventsTable,
  visitorNotificationsTable,
  visitorVisitsTable,
} from "@workspace/db";
import { logger } from "./logger";
import type { VisitorProfileConfig } from "./visitor-agents";

export const DEMO_PROFILES: VisitorProfileConfig[] = [
  {
    id: "university",
    name: "University",
    description: "Campus visitor intake with faculty or staff approval.",
    hostLabel: "Faculty / staff host",
    requiredFields: ["visitorName", "hostName", "purpose"],
    notificationTarget: "Host",
    rulesSummary: [
      "A faculty or staff host is required.",
      "Every visit waits for host approval.",
      "Active duplicate visitor requests are flagged.",
    ],
  },
  {
    id: "housing",
    name: "Housing Society",
    description: "Resident-linked guest entry for a residential community.",
    hostLabel: "Resident",
    requiredFields: ["visitorName", "hostName", "purpose", "unitNumber"],
    notificationTarget: "Resident",
    rulesSummary: [
      "A resident and unit number are required.",
      "The resident must allow entry.",
      "Active duplicate visits for the same unit are flagged.",
    ],
  },
  {
    id: "museum",
    name: "Museum",
    description: "Visitor and group intake with a visit slot and staff contact.",
    hostLabel: "Museum staff contact",
    requiredFields: ["visitorName", "hostName", "purpose", "visitSlot"],
    notificationTarget: "Museum staff",
    rulesSummary: [
      "A staff contact and visit slot are required.",
      "Museum staff must allow entry.",
      "Group size is captured when stated.",
    ],
  },
];

type SeedVisit = {
  visitorName: string;
  affiliation: string;
  hostName: string;
  purpose: string;
  unitNumber?: string;
  groupSize?: number;
  visitSlot?: string;
  status: "awaiting_approval" | "approved" | "denied" | "checked_in" | "checked_out";
  daysAgo: number;
  hour: number;
};

const SEED_VISITS: Record<string, SeedVisit[]> = {
  university: [
    {
      visitorName: "Rahul Sharma",
      affiliation: "Infosys",
      hostName: "Prof. Verma",
      purpose: "Project review",
      status: "checked_out",
      daysAgo: 6,
      hour: 9,
    },
    {
      visitorName: "Aditi Rao",
      affiliation: "Alumni",
      hostName: "Dr. Menon",
      purpose: "Research meeting",
      status: "checked_out",
      daysAgo: 5,
      hour: 11,
    },
    {
      visitorName: "Kabir Nair",
      affiliation: "Campus vendor",
      hostName: "Facilities Desk",
      purpose: "Equipment delivery",
      status: "checked_out",
      daysAgo: 4,
      hour: 14,
    },
    {
      visitorName: "Sara Thomas",
      affiliation: "Tech Mahindra",
      hostName: "Prof. Verma",
      purpose: "Guest lecture",
      status: "checked_out",
      daysAgo: 3,
      hour: 10,
    },
    {
      visitorName: "Arjun Shah",
      affiliation: "Parent",
      hostName: "Admissions Office",
      purpose: "Admissions meeting",
      status: "checked_in",
      daysAgo: 0,
      hour: 10,
    },
    {
      visitorName: "Nisha Iyer",
      affiliation: "Research partner",
      hostName: "Dr. Menon",
      purpose: "Laboratory consultation",
      status: "awaiting_approval",
      daysAgo: 0,
      hour: 13,
    },
    {
      visitorName: "Dev Patel",
      affiliation: "Alumni",
      hostName: "Prof. Verma",
      purpose: "Campus visit",
      status: "approved",
      daysAgo: 1,
      hour: 15,
    },
  ],
  housing: [
    {
      visitorName: "Rohan Mehta",
      affiliation: "Family",
      hostName: "Ananya Mehta",
      purpose: "Family visit",
      unitNumber: "B-804",
      status: "checked_out",
      daysAgo: 6,
      hour: 18,
    },
    {
      visitorName: "Kavya Sood",
      affiliation: "Courier",
      hostName: "Ritesh Khanna",
      purpose: "Package delivery",
      unitNumber: "A-302",
      status: "checked_out",
      daysAgo: 5,
      hour: 12,
    },
    {
      visitorName: "Neel Joshi",
      affiliation: "Service provider",
      hostName: "Ananya Mehta",
      purpose: "Internet repair",
      unitNumber: "B-804",
      status: "checked_out",
      daysAgo: 4,
      hour: 16,
    },
    {
      visitorName: "Pooja Das",
      affiliation: "Friend",
      hostName: "Ritesh Khanna",
      purpose: "Dinner visit",
      unitNumber: "A-302",
      status: "denied",
      daysAgo: 3,
      hour: 20,
    },
    {
      visitorName: "Sanjay Rao",
      affiliation: "Family",
      hostName: "Ananya Mehta",
      purpose: "Family visit",
      unitNumber: "B-804",
      status: "checked_in",
      daysAgo: 0,
      hour: 19,
    },
    {
      visitorName: "Isha Kapoor",
      affiliation: "Guest",
      hostName: "Ritesh Khanna",
      purpose: "Social visit",
      unitNumber: "A-302",
      status: "awaiting_approval",
      daysAgo: 0,
      hour: 17,
    },
    {
      visitorName: "Manav Singh",
      affiliation: "Plumber",
      hostName: "Ananya Mehta",
      purpose: "Kitchen maintenance",
      unitNumber: "B-804",
      status: "approved",
      daysAgo: 1,
      hour: 9,
    },
  ],
  museum: [
    {
      visitorName: "Mira Bose",
      affiliation: "Independent visitor",
      hostName: "Visitor Services",
      purpose: "Gallery visit",
      visitSlot: "10:00 AM",
      groupSize: 1,
      status: "checked_out",
      daysAgo: 6,
      hour: 10,
    },
    {
      visitorName: "Riverside School",
      affiliation: "School group",
      hostName: "Anil Desai",
      purpose: "Educational tour",
      visitSlot: "11:00 AM",
      groupSize: 18,
      status: "checked_out",
      daysAgo: 5,
      hour: 11,
    },
    {
      visitorName: "Karan Gill",
      affiliation: "Independent visitor",
      hostName: "Visitor Services",
      purpose: "Exhibition visit",
      visitSlot: "2:00 PM",
      groupSize: 2,
      status: "checked_out",
      daysAgo: 4,
      hour: 14,
    },
    {
      visitorName: "Cedar College",
      affiliation: "College group",
      hostName: "Anil Desai",
      purpose: "History tour",
      visitSlot: "12:00 PM",
      groupSize: 24,
      status: "checked_out",
      daysAgo: 3,
      hour: 12,
    },
    {
      visitorName: "Leena Paul",
      affiliation: "Independent visitor",
      hostName: "Visitor Services",
      purpose: "Gallery visit",
      visitSlot: "3:00 PM",
      groupSize: 1,
      status: "checked_in",
      daysAgo: 0,
      hour: 15,
    },
    {
      visitorName: "Oakwood School",
      affiliation: "School group",
      hostName: "Anil Desai",
      purpose: "Curator-led tour",
      visitSlot: "1:00 PM",
      groupSize: 16,
      status: "awaiting_approval",
      daysAgo: 0,
      hour: 13,
    },
    {
      visitorName: "Nandita Sen",
      affiliation: "Independent visitor",
      hostName: "Visitor Services",
      purpose: "Exhibition visit",
      visitSlot: "11:00 AM",
      groupSize: 1,
      status: "approved",
      daysAgo: 1,
      hour: 11,
    },
  ],
};

function istVisitTime(daysAgo: number, hour: number): Date {
  const now = new Date();
  const shifted = new Date(now.getTime() + 330 * 60_000);
  const localDate = new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate() - daysAgo,
      hour,
      15,
    ),
  );
  return new Date(localDate.getTime() - 330 * 60_000);
}

export async function initializeVisitorDemoData(): Promise<void> {
  for (const profile of DEMO_PROFILES) {
    await db
      .insert(organizationProfilesTable)
      .values(profile)
      .onConflictDoUpdate({
        target: organizationProfilesTable.id,
        set: {
          name: profile.name,
          description: profile.description,
          hostLabel: profile.hostLabel,
          requiredFields: profile.requiredFields,
          notificationTarget: profile.notificationTarget,
          rulesSummary: profile.rulesSummary,
        },
      });
  }

  const existing = await db
    .select({ id: visitorVisitsTable.id })
    .from(visitorVisitsTable)
    .limit(1);
  if (existing.length > 0) {
    return;
  }

  const inserted = [];
  for (const profile of DEMO_PROFILES) {
    for (const visit of SEED_VISITS[profile.id] ?? []) {
      const createdAt = istVisitTime(visit.daysAgo, visit.hour);
      const decisionAt =
        visit.status === "awaiting_approval"
          ? null
          : new Date(createdAt.getTime() + 3 * 60_000);
      const checkInAt =
        visit.status === "checked_in" || visit.status === "checked_out"
          ? new Date(createdAt.getTime() + 5 * 60_000)
          : null;
      const checkOutAt =
        visit.status === "checked_out"
          ? new Date(createdAt.getTime() + 45 * 60_000)
          : null;

      const [row] = await db
        .insert(visitorVisitsTable)
        .values({
          profileId: profile.id,
          visitorName: visit.visitorName,
          affiliation: visit.affiliation,
          hostName: visit.hostName,
          purpose: visit.purpose,
          unitNumber: visit.unitNumber ?? null,
          groupSize: visit.groupSize ?? null,
          visitSlot: visit.visitSlot ?? null,
          status: visit.status,
          createdBy: "Front Desk",
          createdAt,
          decisionAt,
          checkInAt,
          checkOutAt,
          decisionNote:
            visit.status === "denied" ? "Demo: host declined this request." : null,
        })
        .returning();
      inserted.push(row);
    }
  }

  for (const visit of inserted) {
    await db.insert(visitorAuditEventsTable).values({
      profileId: visit.profileId,
      visitId: visit.id,
      actorName: visit.createdBy,
      eventType: "REGISTRATION_CREATED",
      message: `Visitor request created for ${visit.visitorName}.`,
      occurredAt: visit.createdAt,
    });
    if (visit.status === "awaiting_approval") {
      await db.insert(visitorNotificationsTable).values({
        profileId: visit.profileId,
        visitId: visit.id,
        recipient: visit.hostName,
        title: "Visitor approval requested",
        message: `${visit.visitorName} is waiting to visit you.`,
        status: "pending",
        createdAt: visit.createdAt,
      });
    } else if (visit.status === "approved" || visit.status === "denied") {
      await db.insert(visitorAuditEventsTable).values({
        profileId: visit.profileId,
        visitId: visit.id,
        actorName: visit.hostName,
        eventType: visit.status === "approved" ? "HOST_APPROVED" : "HOST_DENIED",
        message: `Demo host ${visit.status} the visitor request.`,
        occurredAt: visit.decisionAt ?? visit.createdAt,
      });
    }
  }

  logger.info({ profiles: DEMO_PROFILES.length, visits: inserted.length }, "Seeded visitor demo data");
}

export async function getProfile(profileId: string) {
  const [profile] = await db
    .select()
    .from(organizationProfilesTable)
    .where(eq(organizationProfilesTable.id, profileId))
    .limit(1);
  return profile;
}