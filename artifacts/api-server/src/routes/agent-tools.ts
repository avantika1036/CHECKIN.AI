import {
  AskVisitorAnalyticsBody,
  AskVisitorAnalyticsResponse,
  CreateRegistrationDraftBody,
  CreateRegistrationDraftResponse,
  TranscribeVisitorAudioResponse,
} from "@workspace/api-zod";
import {
  db,
  visitorVisitsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import express, { Router, type IRouter } from "express";
import {
  classifyAnalyticsQuestion,
  createRegistrationDraft,
  GroqUnavailableError,
} from "../lib/visitor-agents";
import { getProfile } from "../lib/visitor-seed";

const router: IRouter = Router();
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const SARVAM_AUDIO_TYPES: Record<
  string,
  { contentType: string; extension: string }
> = {
  "audio/aac": { contentType: "audio/aac", extension: "aac" },
  "audio/aiff": { contentType: "audio/aiff", extension: "aiff" },
  "audio/amr": { contentType: "audio/amr", extension: "amr" },
  "audio/flac": { contentType: "audio/flac", extension: "flac" },
  "audio/m4a": { contentType: "audio/mp4", extension: "m4a" },
  "audio/mp3": { contentType: "audio/mpeg", extension: "mp3" },
  "audio/mp4": { contentType: "audio/mp4", extension: "m4a" },
  "audio/mpeg": { contentType: "audio/mpeg", extension: "mp3" },
  "audio/ogg": { contentType: "audio/ogg", extension: "ogg" },
  "audio/opus": { contentType: "audio/opus", extension: "opus" },
  "audio/wav": { contentType: "audio/wav", extension: "wav" },
  "audio/wave": { contentType: "audio/wav", extension: "wav" },
  "audio/webm": { contentType: "audio/webm", extension: "webm" },
  "audio/x-aiff": { contentType: "audio/aiff", extension: "aiff" },
  "audio/x-flac": { contentType: "audio/flac", extension: "flac" },
  "audio/x-wav": { contentType: "audio/wav", extension: "wav" },
  "video/webm": { contentType: "audio/webm", extension: "webm" },
};
const SARVAM_ERROR_CODES = new Set([
  "invalid_request_error",
  "internal_server_error",
  "unprocessable_entity_error",
  "insufficient_quota_error",
  "invalid_api_key_error",
  "authentication_error",
  "not_found_error",
  "rate_limit_exceeded_error",
  "model_call_error",
  "gateway_timeout_error",
  "billing_service_unavailable_error",
]);
const istDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const istWeekdayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Kolkata",
  weekday: "short",
});
const istHourFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  hourCycle: "h23",
});
const istDateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  dateStyle: "medium",
  timeStyle: "short",
});

function istTodayStart(reference = new Date()): Date {
  const parts = istDateFormatter.formatToParts(reference);
  const getPart = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return new Date(
    Date.UTC(getPart("year"), getPart("month") - 1, getPart("day")) -
      330 * 60_000,
  );
}

async function getSarvamErrorCode(response: Response): Promise<string | undefined> {
  try {
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !("error" in payload)) {
      return undefined;
    }
    const details = payload.error;
    if (!details || typeof details !== "object" || !("code" in details)) {
      return undefined;
    }
    const code = details.code;
    return typeof code === "string" && SARVAM_ERROR_CODES.has(code)
      ? code
      : undefined;
  } catch {
    return undefined;
  }
}

router.post("/agents/registration-draft", async (req, res): Promise<void> => {
  const parsed = CreateRegistrationDraftBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const profile = await getProfile(parsed.data.profileId);
  if (!profile) {
    res.status(404).json({ error: "Organization profile not found." });
    return;
  }

  try {
    const draft = await createRegistrationDraft({
      profile,
      utterance: parsed.data.utterance,
    });
    if (draft.intent !== "register_visitor") {
      res.status(400).json({
        error: "Describe a visitor who is arriving to register.",
      });
      return;
    }
    const { intent: _intent, ...response } = draft;
    res.json(CreateRegistrationDraftResponse.parse(response));
  } catch (error) {
    if (error instanceof GroqUnavailableError) {
      req.log.warn(
        { providerStatus: error.providerStatus },
        "Registration agent unavailable",
      );
      res.status(503).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/agents/analytics", async (req, res): Promise<void> => {
  const parsed = AskVisitorAnalyticsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { profileId, question } = parsed.data;
  if (!(await getProfile(profileId))) {
    res.status(404).json({ error: "Organization profile not found." });
    return;
  }

  try {
    const classification = await classifyAnalyticsQuestion({
      profileId,
      question,
    });
    const { metric, subject } = classification;
    if (metric === "unsupported") {
      res.status(400).json({
        error:
          "Try: who checked in last, who is inside right now, visits today, busiest arrival hour, top host, most common purpose, or the status of a named visitor.",
      });
      return;
    }

    const visits = await db
      .select()
      .from(visitorVisitsTable)
      .where(eq(visitorVisitsTable.profileId, profileId));
    const now = new Date();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
    const todayStart = istTodayStart(now);
    const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
    const when = (d: Date) => istDateTimeFormatter.format(d);
    const topOf = (keys: string[]) => {
      const counts = new Map<string, number>();
      for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
      return [...counts.entries()].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))[0];
    };
    let value = 0;
    let answer = "";

    if (metric === "total_visits") {
      value = visits.filter((visit) => visit.createdAt >= weekStart).length;
      answer = `${value} visitor ${value === 1 ? "request was" : "requests were"} created in the last 7 days.`;
    } else if (metric === "currently_inside") {
      value = visits.filter((visit) => visit.status === "checked_in").length;
      answer = `${value} ${value === 1 ? "visitor is" : "visitors are"} currently checked in.`;
    } else if (metric === "who_is_inside") {
      const inside = visits.filter((visit) => visit.status === "checked_in");
      value = inside.length;
      answer = value
        ? `Currently inside: ${inside.map((v) => `${v.visitorName} (to see ${v.hostName})`).join(", ")}.`
        : "Nobody is checked in right now.";
    } else if (metric === "pending_approvals") {
      value = visits.filter((visit) => visit.status === "awaiting_approval").length;
      answer = `${value} ${value === 1 ? "visit is" : "visits are"} waiting for host approval.`;
    } else if (metric === "denied_today") {
      value = visits.filter(
        (visit) =>
          visit.status === "denied" &&
          visit.decisionAt != null &&
          visit.decisionAt >= todayStart,
      ).length;
      answer = `${value} ${value === 1 ? "visit was" : "visits were"} denied today.`;
    } else if (metric === "visits_today") {
      value = visits.filter((visit) => visit.createdAt >= todayStart).length;
      answer = `${value} ${plural(value, "visit was", "visits were")} registered today.`;
    } else if (metric === "last_checked_in_visitor") {
      const last = visits
        .filter((v) => v.checkInAt != null)
        .sort((a, b) => b.checkInAt!.getTime() - a.checkInAt!.getTime())[0];
      value = last ? 1 : 0;
      answer = last
        ? `${last.visitorName} checked in last, at ${when(last.checkInAt!)}, to see ${last.hostName}.`
        : "Nobody has checked in yet.";
    } else if (metric === "last_checked_out_visitor") {
      const last = visits
        .filter((v) => v.checkOutAt != null)
        .sort((a, b) => b.checkOutAt!.getTime() - a.checkOutAt!.getTime())[0];
      value = last ? 1 : 0;
      answer = last
        ? `${last.visitorName} checked out most recently, at ${when(last.checkOutAt!)}.`
        : "Nobody has checked out yet.";
    } else if (metric === "top_host") {
      const top = topOf(visits.filter((v) => v.createdAt >= weekStart).map((v) => v.hostName));
      value = top?.[1] ?? 0;
      answer = top
        ? `${top[0]} received the most visits in the last 7 days (${value}).`
        : "There were no visits in the last 7 days.";
    } else if (metric === "top_purpose") {
      const top = topOf(visits.filter((v) => v.createdAt >= weekStart).map((v) => v.purpose));
      value = top?.[1] ?? 0;
      answer = top
        ? `The most common purpose in the last 7 days was "${top[0]}" (${value}).`
        : "There were no visits in the last 7 days.";
    } else if (metric === "visitor_lookup") {
      const needle = (subject ?? "").toLocaleLowerCase();
      const matches = needle
        ? visits
            .filter((v) => v.visitorName.toLocaleLowerCase().includes(needle))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        : [];
      const hit = matches[0];
      value = matches.length;
      const label: Record<string, string> = {
        awaiting_approval: "awaiting host approval",
        approved: "approved but not yet checked in",
        denied: "denied",
        checked_in: "currently checked in",
        checked_out: "checked out",
      };
      answer = hit
        ? `${hit.visitorName}'s latest visit (to see ${hit.hostName}) is ${label[hit.status] ?? hit.status}.`
        : `No visitor matching "${subject ?? ""}" was found.`;
    } else {
      const hourlyCounts = new Map<number, number>();
      for (const visit of visits) {
        if (!visit.checkInAt || visit.checkInAt < weekStart || visit.checkInAt > now) {
          continue;
        }
        const hour = Number(istHourFormatter.format(visit.checkInAt));
        hourlyCounts.set(hour, (hourlyCounts.get(hour) ?? 0) + 1);
      }
      const peak = [...hourlyCounts.entries()].sort(
        ([hourA, countA], [hourB, countB]) => countB - countA || hourA - hourB,
      )[0];
      value = peak?.[1] ?? 0;
      if (peak) {
        const weekday = istWeekdayFormatter.format(
          visits.find(
            (visit) =>
              visit.checkInAt &&
              visit.checkInAt >= weekStart &&
              Number(istHourFormatter.format(visit.checkInAt)) === peak[0],
          )?.checkInAt ?? now,
        );
        const nextHour = (peak[0] + 1) % 24;
        answer = `The busiest arrival hour was ${weekday} ${String(peak[0]).padStart(2, "0")}:00–${String(nextHour).padStart(2, "0")}:00, with ${value} ${value === 1 ? "check-in" : "check-ins"}.`;
      } else {
        answer = "There are no check-ins in the last 7 days.";
      }
    }

    res.json(
      AskVisitorAnalyticsResponse.parse({
        answer,
        metric,
        value,
        agentTrace: [
          ...classification.agentTrace,
          {
            agent: "Read-only Metrics Tool",
            detail:
              "Queried an approved Postgres metric; the model did not write or generate SQL.",
            status: "completed",
          },
        ],
      }),
    );
  } catch (error) {
    if (error instanceof GroqUnavailableError) {
      req.log.warn(
        { providerStatus: error.providerStatus },
        "Analytics agent unavailable",
      );
      res.status(503).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post(
  "/agents/transcribe",
  express.raw({ type: "multipart/form-data", limit: MAX_AUDIO_BYTES }),
  async (req, res): Promise<void> => {
    const contentType = req.get("content-type");
    if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) {
      res.status(400).json({ error: "Send the recording as multipart form data." });
      return;
    }
    if (!Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: "The audio recording is missing." });
      return;
    }

    let uploaded: ReturnType<FormData["get"]>;
    try {
      const parsedForm = await new Request("http://localhost/audio-upload", {
        method: "POST",
        headers: { "content-type": contentType },
        body: req.body,
      }).formData();
      uploaded = parsedForm.get("file");
    } catch {
      res.status(400).json({ error: "The audio form data could not be read." });
      return;
    }

    if (!uploaded || typeof uploaded === "string" || uploaded.size === 0) {
      res.status(400).json({ error: "Choose a non-empty audio recording." });
      return;
    }
    const audioType = uploaded.type.split(";")[0]?.trim().toLowerCase() ?? "";
    const audioFormat = SARVAM_AUDIO_TYPES[audioType];
    if (!audioFormat) {
      res.status(400).json({ error: "Use a supported audio recording format." });
      return;
    }
    if (uploaded.size > MAX_AUDIO_BYTES) {
      res.status(413).json({ error: "The audio recording exceeds the upload limit." });
      return;
    }

    const apiKey = process.env.SARVAM_API_KEY;
    if (!apiKey) {
      req.log.error("SARVAM_API_KEY is not configured");
      res.status(503).json({ error: "Speech transcription is not configured." });
      return;
    }

    const form = new FormData();
    form.append(
      "file",
      new Blob([await uploaded.arrayBuffer()], {
        type: audioFormat.contentType,
      }),
      `visitor-recording.${audioFormat.extension}`,
    );
    form.append("model", "saaras:v3");
    form.append("mode", "transcribe");

    let providerResponse: Response;
    try {
      providerResponse = await fetch("https://api.sarvam.ai/speech-to-text", {
        method: "POST",
        headers: { "api-subscription-key": apiKey },
        body: form,
        signal: AbortSignal.timeout(45_000),
      });
    } catch {
      req.log.warn("Sarvam transcription request could not be completed");
      res.status(503).json({ error: "Speech transcription is temporarily unavailable." });
      return;
    }

    if (!providerResponse.ok) {
      const providerCode = await getSarvamErrorCode(providerResponse.clone());
      req.log.warn(
        {
          providerStatus: providerResponse.status,
          providerCode,
          audioType: audioFormat.contentType,
        },
        "Sarvam transcription request was rejected",
      );
      res.status(
        providerResponse.status === 400 || providerResponse.status === 415
          ? 400
          : 503,
      ).json({
        error:
          providerResponse.status === 400 || providerResponse.status === 415
            ? "Sarvam could not read this recording. Try another recording."
            : "Speech transcription is temporarily unavailable.",
      });
      return;
    }

    let providerResult: unknown;
    try {
      providerResult = await providerResponse.json();
    } catch {
      req.log.warn("Sarvam returned an unreadable transcription response");
      res.status(503).json({ error: "Speech transcription is temporarily unavailable." });
      return;
    }
    if (!providerResult || typeof providerResult !== "object") {
      req.log.warn("Sarvam returned an invalid transcription response");
      res.status(503).json({ error: "Speech transcription is temporarily unavailable." });
      return;
    }

    const result = providerResult as Record<string, unknown>;
    if (typeof result.transcript !== "string") {
      req.log.warn("Sarvam response did not contain a transcript");
      res.status(503).json({ error: "Speech transcription is temporarily unavailable." });
      return;
    }
    res.json(
      TranscribeVisitorAudioResponse.parse({
        requestId: typeof result.request_id === "string" ? result.request_id : null,
        transcript: result.transcript,
        languageCode:
          typeof result.language_code === "string" ? result.language_code : null,
        languageProbability:
          typeof result.language_probability === "number"
            ? result.language_probability
            : null,
      }),
    );
  },
);

export default router;