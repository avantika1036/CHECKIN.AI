import {
  ListVisitorProfilesResponse,
  GetVisitorDashboardQueryParams,
  GetVisitorDashboardResponse,
  ListVisitorVisitsQueryParams,
  ListVisitorVisitsResponse,
  CreateVisitorVisitBody,
  CreateVisitorVisitResponse,
  DecideVisitorVisitParams,
  DecideVisitorVisitBody,
  DecideVisitorVisitResponse,
  CheckInVisitorParams,
  CheckInVisitorBody,
  CheckInVisitorResponse,
  CheckOutVisitorParams,
  CheckOutVisitorBody,
  CheckOutVisitorResponse,
  ListVisitorNotificationsQueryParams,
  ListVisitorNotificationsResponse,
  ListVisitorAuditEventsQueryParams,
  ListVisitorAuditEventsResponse,
} from "@workspace/api-zod";
import {
  db,
  organizationProfilesTable,
  visitorAuditEventsTable,
  visitorNotificationsTable,
  visitorVisitsTable,
} from "@workspace/db";
import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  or,
  type SQL,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import { DEMO_PROFILES, getProfile } from "../lib/visitor-seed";

const router: IRouter = Router();
const activeStatuses = ["awaiting_approval", "approved", "checked_in"] as const;
const weekdayOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const hourFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  hourCycle: "h23",
});
const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Kolkata",
  weekday: "short",
});

function istTodayStart(reference = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(reference);
  const getPart = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return new Date(
    Date.UTC(getPart("year"), getPart("month") - 1, getPart("day")) -
      330 * 60_000,
  );
}

function getIstHour(date: Date): number {
  return Number(hourFormatter.format(date));
}

function getIstWeekday(date: Date): (typeof weekdayOrder)[number] | undefined {
  const day = weekdayFormatter.format(date);
  return weekdayOrder.find((weekday) => weekday === day);
}

async function requireProfile(
  profileId: string,
  res: import("express").Response,
): Promise<boolean> {
  const profile = await getProfile(profileId);
  if (!profile) {
    res.status(404).json({ error: "Organization profile not found." });
    return false;
  }
  return true;
}

router.get("/visitor/profiles", async (_req, res): Promise<void> => {
  const profiles = await db.select().from(organizationProfilesTable);
  res.json(ListVisitorProfilesResponse.parse(profiles));
});

router.get("/visitor/dashboard", async (req, res): Promise<void> => {
  const parsed = GetVisitorDashboardQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { profileId, dateRange } = parsed.data;
  if (!(await requireProfile(profileId, res))) return;

  const now = new Date();
  const duration = dateRange === "month" ? 30 : 7;
  const rangeStart = new Date(now.getTime() - duration * 24 * 60 * 60_000);
  const previousRangeStart = new Date(
    rangeStart.getTime() - duration * 24 * 60 * 60_000,
  );
  const allVisits = await db
    .select()
    .from(visitorVisitsTable)
    .where(eq(visitorVisitsTable.profileId, profileId))
    .orderBy(desc(visitorVisitsTable.createdAt));

  const currentRangeVisits = allVisits.filter(
    (visit) => visit.createdAt >= rangeStart,
  );
  const previousRangeVisits = allVisits.filter(
    (visit) =>
      visit.createdAt >= previousRangeStart && visit.createdAt < rangeStart,
  );
  const currentWindowArrivals = currentRangeVisits.filter(
    (visit) => visit.checkInAt != null,
  ).length;
  const previousWindowArrivals = previousRangeVisits.filter(
    (visit) => visit.checkInAt != null,
  ).length;
  const weeklyChangePercent =
    previousWindowArrivals === 0
      ? currentWindowArrivals === 0
        ? 0
        : 100
      : Math.round(
          ((currentWindowArrivals - previousWindowArrivals) /
            previousWindowArrivals) *
            100,
        );

  const cellCounts = new Map<string, number>();
  for (const visit of allVisits) {
    if (!visit.checkInAt || visit.checkInAt < rangeStart || visit.checkInAt > now) {
      continue;
    }
    const weekday = getIstWeekday(visit.checkInAt);
    if (!weekday) continue;
    const key = `${weekday}:${getIstHour(visit.checkInAt)}`;
    cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
  }
  const activity = weekdayOrder.flatMap((weekday) =>
    Array.from({ length: 24 }, (_, hour) => ({
      weekday,
      hour,
      count: cellCounts.get(`${weekday}:${hour}`) ?? 0,
    })),
  );
  const peak = activity.reduce(
    (best, cell) => (cell.count > best.count ? cell : best),
    activity[0]!,
  );
  const peakWindow =
    peak.count === 0
      ? "No check-ins yet"
      : `${peak.weekday} ${String(peak.hour).padStart(2, "0")}:00–${String(
          (peak.hour + 1) % 24,
        ).padStart(2, "0")}:00`;
  const todayStart = istTodayStart(now);
  const dashboard = {
    totalVisits: currentRangeVisits.length,
    currentlyInside: allVisits.filter((visit) => visit.status === "checked_in")
      .length,
    pendingApprovals: allVisits.filter(
      (visit) => visit.status === "awaiting_approval",
    ).length,
    deniedToday: allVisits.filter(
      (visit) =>
        visit.status === "denied" &&
        visit.decisionAt != null &&
        visit.decisionAt >= todayStart,
    ).length,
    weeklyChangePercent,
    peakWindow,
    activity,
    recentVisits: currentRangeVisits.slice(0, 6),
  };
  res.json(GetVisitorDashboardResponse.parse(dashboard));
});

router.get("/visitor/visits", async (req, res): Promise<void> => {
  const parsed = ListVisitorVisitsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { profileId, status, search } = parsed.data;
  if (!(await requireProfile(profileId, res))) return;

  const filters: SQL[] = [eq(visitorVisitsTable.profileId, profileId)];
  if (status) filters.push(eq(visitorVisitsTable.status, status));
  if (search?.trim()) {
    const escaped = search.trim().slice(0, 100).replace(/[\\%_]/g, "\\$&");
    const pattern = `%${escaped}%`;
    const searchFilter = or(
      ilike(visitorVisitsTable.visitorName, pattern),
      ilike(visitorVisitsTable.hostName, pattern),
      ilike(visitorVisitsTable.purpose, pattern),
      ilike(visitorVisitsTable.unitNumber, pattern),
    );
    if (searchFilter) filters.push(searchFilter);
  }

  const visits = await db
    .select()
    .from(visitorVisitsTable)
    .where(and(...filters))
    .orderBy(desc(visitorVisitsTable.createdAt));
  res.json(ListVisitorVisitsResponse.parse(visits));
});

router.post("/visitor/visits", async (req, res): Promise<void> => {
  const parsed = CreateVisitorVisitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;
  const profile = await getProfile(body.profileId);
  if (!profile) {
    res.status(404).json({ error: "Organization profile not found." });
    return;
  }

  const valuesByField: Record<string, string | number | undefined> = {
    visitorName: body.visitorName.trim(),
    hostName: body.hostName.trim(),
    purpose: body.purpose.trim(),
    unitNumber: body.unitNumber?.trim(),
    groupSize: body.groupSize,
    visitSlot: body.visitSlot?.trim(),
  };
  const missing = profile.requiredFields.filter((field) => {
    const value = valuesByField[field];
    return value == null || value === "";
  });
  if (missing.length > 0) {
    res.status(400).json({
      error: `Required for ${profile.name}: ${missing.join(", ")}.`,
    });
    return;
  }

  const duplicateName = body.visitorName.trim().toLocaleLowerCase();
  const transactionResult = await db.transaction(async (tx) => {
    const activeVisits = await tx
      .select()
      .from(visitorVisitsTable)
      .where(
        and(
          eq(visitorVisitsTable.profileId, body.profileId),
          inArray(visitorVisitsTable.status, [...activeStatuses]),
        ),
      );
    const possibleDuplicate = activeVisits.some((visit) => {
      const sameName = visit.visitorName.trim().toLocaleLowerCase() === duplicateName;
      if (!sameName) return false;
      return body.profileId !== "housing" ||
        visit.unitNumber?.trim().toLocaleLowerCase() ===
          body.unitNumber?.trim().toLocaleLowerCase();
    });
    if (possibleDuplicate) return { duplicate: true as const };

    const [visit] = await tx
      .insert(visitorVisitsTable)
      .values({
        profileId: body.profileId,
        visitorName: body.visitorName.trim(),
        affiliation: body.affiliation?.trim() || null,
        hostName: body.hostName.trim(),
        purpose: body.purpose.trim(),
        unitNumber: body.unitNumber?.trim() || null,
        groupSize: body.groupSize ?? null,
        visitSlot: body.visitSlot?.trim() || null,
        status: "awaiting_approval",
        createdBy: body.createdBy.trim(),
      })
      .returning();

    await tx.insert(visitorNotificationsTable).values({
      profileId: body.profileId,
      visitId: visit.id,
      recipient: visit.hostName,
      title: "Visitor approval requested",
      message: `${visit.visitorName} is requesting a visit: ${visit.purpose}.`,
      status: "pending",
    });
    await tx.insert(visitorAuditEventsTable).values({
      profileId: body.profileId,
      visitId: visit.id,
      actorName: visit.createdBy,
      eventType: "REGISTRATION_CREATED",
      message: `Visitor request created for ${visit.visitorName}.`,
    });
    return { duplicate: false as const, visit };
  });

  if (transactionResult.duplicate) {
    res.status(409).json({
      error: "An active visit for this visitor already exists.",
    });
    return;
  }
  res
    .status(201)
    .json(CreateVisitorVisitResponse.parse(transactionResult.visit));
});

router.post(
  "/visitor/visits/:visitId/decision",
  async (req, res): Promise<void> => {
    const params = DecideVisitorVisitParams.safeParse(req.params);
    const body = DecideVisitorVisitBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const outcome = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(visitorVisitsTable)
        .where(eq(visitorVisitsTable.id, params.data.visitId))
        .for("update");
      if (!existing) return { kind: "missing" as const };
      if (
        existing.hostName.trim().toLocaleLowerCase() !==
        body.data.actorName.trim().toLocaleLowerCase()
      ) {
        return { kind: "wrong-host" as const };
      }
      if (existing.status !== "awaiting_approval") {
        return { kind: "resolved" as const };
      }

      const status = body.data.action === "allow" ? "approved" : "denied";
      const [visit] = await tx
        .update(visitorVisitsTable)
        .set({
          status,
          decisionAt: new Date(),
          decisionNote: body.data.note?.trim() || null,
        })
        .where(eq(visitorVisitsTable.id, existing.id))
        .returning();
      await tx
        .update(visitorNotificationsTable)
        .set({ status })
        .where(eq(visitorNotificationsTable.visitId, existing.id));
      await tx.insert(visitorAuditEventsTable).values({
        profileId: visit.profileId,
        visitId: visit.id,
        actorName: body.data.actorName.trim(),
        eventType: status === "approved" ? "HOST_APPROVED" : "HOST_DENIED",
        message:
          body.data.note?.trim() ||
          `Host ${status === "approved" ? "allowed" : "denied"} the visit.`,
      });
      return { kind: "updated" as const, visit };
    });

    if (outcome.kind === "missing") {
      res.status(404).json({ error: "Visit not found." });
      return;
    }
    if (outcome.kind === "wrong-host") {
      res.status(403).json({
        error: "Only the assigned host can allow or deny this visit.",
      });
      return;
    }
    if (outcome.kind === "resolved") {
      res.status(400).json({ error: "This visit has already been resolved." });
      return;
    }
    res.json(DecideVisitorVisitResponse.parse(outcome.visit));
  },
);

router.post(
  "/visitor/visits/:visitId/check-in",
  async (req, res): Promise<void> => {
    const params = CheckInVisitorParams.safeParse(req.params);
    const body = CheckInVisitorBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const outcome = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(visitorVisitsTable)
        .where(eq(visitorVisitsTable.id, params.data.visitId))
        .for("update");
      if (!existing) return { kind: "missing" as const };
      if (existing.status !== "approved") {
        return { kind: "invalid-state" as const };
      }
      const [visit] = await tx
        .update(visitorVisitsTable)
        .set({ status: "checked_in", checkInAt: new Date() })
        .where(eq(visitorVisitsTable.id, existing.id))
        .returning();
      await tx.insert(visitorAuditEventsTable).values({
        profileId: visit.profileId,
        visitId: visit.id,
        actorName: body.data.actorName.trim(),
        eventType: "VISITOR_CHECKED_IN",
        message: `${visit.visitorName} checked in.`,
      });
      return { kind: "updated" as const, visit };
    });

    if (outcome.kind === "missing") {
      res.status(404).json({ error: "Visit not found." });
      return;
    }
    if (outcome.kind === "invalid-state") {
      res.status(400).json({
        error: "Only an approved visit can be checked in.",
      });
      return;
    }
    res.json(CheckInVisitorResponse.parse(outcome.visit));
  },
);

router.post(
  "/visitor/visits/:visitId/check-out",
  async (req, res): Promise<void> => {
    const params = CheckOutVisitorParams.safeParse(req.params);
    const body = CheckOutVisitorBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const outcome = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(visitorVisitsTable)
        .where(eq(visitorVisitsTable.id, params.data.visitId))
        .for("update");
      if (!existing) return { kind: "missing" as const };
      if (existing.status !== "checked_in") {
        return { kind: "invalid-state" as const };
      }
      const [visit] = await tx
        .update(visitorVisitsTable)
        .set({ status: "checked_out", checkOutAt: new Date() })
        .where(eq(visitorVisitsTable.id, existing.id))
        .returning();
      await tx.insert(visitorAuditEventsTable).values({
        profileId: visit.profileId,
        visitId: visit.id,
        actorName: body.data.actorName.trim(),
        eventType: "VISITOR_CHECKED_OUT",
        message: `${visit.visitorName} checked out.`,
      });
      return { kind: "updated" as const, visit };
    });

    if (outcome.kind === "missing") {
      res.status(404).json({ error: "Visit not found." });
      return;
    }
    if (outcome.kind === "invalid-state") {
      res.status(400).json({
        error: "Only a checked-in visit can be checked out.",
      });
      return;
    }
    res.json(CheckOutVisitorResponse.parse(outcome.visit));
  },
);

router.get("/visitor/notifications", async (req, res): Promise<void> => {
  const parsed = ListVisitorNotificationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { profileId, recipient } = parsed.data;
  if (!(await requireProfile(profileId, res))) return;

  const notifications = await db
    .select()
    .from(visitorNotificationsTable)
    .where(
      and(
        eq(visitorNotificationsTable.profileId, profileId),
        eq(visitorNotificationsTable.recipient, recipient),
      ),
    )
    .orderBy(desc(visitorNotificationsTable.createdAt));
  res.json(ListVisitorNotificationsResponse.parse(notifications));
});

router.get("/visitor/audit", async (req, res): Promise<void> => {
  const parsed = ListVisitorAuditEventsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { profileId, limit } = parsed.data;
  if (!(await requireProfile(profileId, res))) return;

  const events = await db
    .select()
    .from(visitorAuditEventsTable)
    .where(eq(visitorAuditEventsTable.profileId, profileId))
    .orderBy(desc(visitorAuditEventsTable.occurredAt))
    .limit(limit);
  res.json(ListVisitorAuditEventsResponse.parse(events));
});

export default router;