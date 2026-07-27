import type { MaskRing } from "../annotations/model";

// Thin client for the SAM3 segmentation service. Pure and framework-free (no
// React, no Tauri) so it can be unit-tested with a mock fetch. The service is a
// GPU box reached through an SSH tunnel, so it is routinely absent — every call
// site has to be able to tell "not running" from "running but failed", which is
// why the two failure modes are distinct error classes rather than one Error.

// Default base URL: the local end of the SSH tunnel. Overridable per install
// (persisted in the app settings store on desktop).
export const SAM3_DEFAULT_BASE_URL = "http://127.0.0.1:8765";

export type Health = {
  ok: boolean;
  gpu: string;
  model: string;
  cached: number;
};

export type EncodeResult = {
  embed_id: string;
  w: number;
  h: number;
  ms: number;
};

// One ranked segmentation proposal. Up to 3 come back per request: at distance a
// flag can be smaller than a single mask cell, so which blob IS "the flag" is
// genuinely ambiguous and the labeler picks — the client never chooses for them.
export type Candidate = {
  rings: MaskRing[];
  score: number;
  area_px: number;
};

export type SegmentResult = {
  candidates: Candidate[];
  ms: number;
};

// A box prompt in image pixels, origin top-left: [x1, y1, x2, y2].
export type BoxPrompt = [number, number, number, number];

// A click prompt in image pixels with its polarity: [x, y, label], where
// label 1 = positive (this IS the flag) and 0 = negative (this is NOT).
export type PointPrompt = [number, number, 0 | 1];

// The service could not be reached at all: tunnel down, service not started,
// wrong port, CORS preflight refused. Actionable by the user ("start the
// tunnel"), so the UI shows a different message than for a server-side failure.
export class Sam3UnreachableError extends Error {
  constructor(readonly baseUrl: string, readonly cause?: unknown) {
    super(`SAM3 service unreachable at ${baseUrl}`);
    this.name = "Sam3UnreachableError";
  }
}

// The service answered, but with a failure: a non-2xx status or a body that
// isn't the documented shape. Not something the user can fix by restarting a
// tunnel, so it surfaces the status/detail instead.
export class Sam3ServiceError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "Sam3ServiceError";
  }
}

// The held embed_id is no longer valid on the server (restart or cache
// eviction). Never surfaced to the UI: segmentWithReencode swallows the first
// one by re-encoding. A SECOND consecutive stale id means something is
// genuinely wrong, and that one does propagate.
export class Sam3StaleEmbedError extends Error {
  constructor() {
    super("SAM3 embed_id is stale");
    this.name = "Sam3StaleEmbedError";
  }
}

export type Sam3Client = {
  baseUrl: string;
  health(): Promise<Health>;
  encode(image: Blob): Promise<EncodeResult>;
  segment(
    embedId: string,
    box: BoxPrompt,
    points: PointPrompt[]
  ): Promise<SegmentResult>;
};

type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: BodyInit;
    signal?: AbortSignal;
  }
) => Promise<Response>;

// Strip a trailing slash so `${baseUrl}/health` never doubles up.
function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function createSam3Client(opts: {
  baseUrl?: string;
  fetchImpl?: FetchLike;
}): Sam3Client {
  const baseUrl = normalizeBaseUrl(opts.baseUrl || SAM3_DEFAULT_BASE_URL);
  const doFetch: FetchLike =
    opts.fetchImpl ?? ((input, init) => fetch(input, init));

  // A rejected fetch means the request never got an HTTP answer — that is the
  // ONLY signal for "unreachable". Anything with a status is a service error.
  async function request(
    path: string,
    init: Parameters<FetchLike>[1]
  ): Promise<Response> {
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${path}`, init);
    } catch (e) {
      throw new Sam3UnreachableError(baseUrl, e);
    }
    return res;
  }

  // Read a JSON body, treating a non-JSON payload on an otherwise-OK response as
  // a service error (the service is answering with something we can't use).
  async function readJson(res: Response, path: string): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw new Sam3ServiceError(
        res.status,
        `SAM3 ${path} returned a non-JSON body`
      );
    }
  }

  return {
    baseUrl,

    async health(): Promise<Health> {
      const res = await request("/health", { method: "GET" });
      if (!res.ok) {
        throw new Sam3ServiceError(res.status, `SAM3 /health failed (${res.status})`);
      }
      const body = (await readJson(res, "/health")) as Partial<Health>;
      return {
        ok: body.ok === true,
        gpu: typeof body.gpu === "string" ? body.gpu : "",
        model: typeof body.model === "string" ? body.model : "",
        cached: typeof body.cached === "number" ? body.cached : 0,
      };
    },

    async encode(image: Blob): Promise<EncodeResult> {
      const form = new FormData();
      form.append("file", image);
      const res = await request("/encode", { method: "POST", body: form });
      if (!res.ok) {
        throw new Sam3ServiceError(res.status, `SAM3 /encode failed (${res.status})`);
      }
      const body = (await readJson(res, "/encode")) as Partial<EncodeResult>;
      if (typeof body.embed_id !== "string" || body.embed_id === "") {
        throw new Sam3ServiceError(res.status, "SAM3 /encode returned no embed_id");
      }
      return {
        embed_id: body.embed_id,
        w: typeof body.w === "number" ? body.w : 0,
        h: typeof body.h === "number" ? body.h : 0,
        ms: typeof body.ms === "number" ? body.ms : 0,
      };
    },

    async segment(
      embedId: string,
      box: BoxPrompt,
      points: PointPrompt[]
    ): Promise<SegmentResult> {
      // The server is stateless per request: the box AND the full click list go
      // on EVERY call, never a delta against a previous one.
      const res = await request("/segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embed_id: embedId, box, points }),
      });
      if (res.status === 409) {
        throw new Sam3StaleEmbedError();
      }
      if (!res.ok) {
        throw new Sam3ServiceError(res.status, `SAM3 /segment failed (${res.status})`);
      }
      const body = (await readJson(res, "/segment")) as {
        candidates?: unknown;
        ms?: unknown;
      };
      if (!Array.isArray(body.candidates)) {
        throw new Sam3ServiceError(res.status, "SAM3 /segment returned no candidates");
      }
      return {
        candidates: body.candidates.map(parseCandidate),
        ms: typeof body.ms === "number" ? body.ms : 0,
      };
    },
  };
}

// Coerce one candidate from the wire. Malformed rings collapse to [] rather than
// throwing, so one bad candidate can't kill an otherwise-usable response — the
// caller renders nothing for it and the labeler cycles past.
function parseCandidate(raw: unknown): Candidate {
  const rec = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  const rings: MaskRing[] = [];
  if (Array.isArray(rec.rings)) {
    for (const ring of rec.rings) {
      if (!Array.isArray(ring)) continue;
      const pts: MaskRing = [];
      for (const pt of ring) {
        if (
          Array.isArray(pt) &&
          typeof pt[0] === "number" &&
          typeof pt[1] === "number"
        ) {
          pts.push([pt[0], pt[1]]);
        }
      }
      if (pts.length > 0) rings.push(pts);
    }
  }
  return {
    rings,
    score: typeof rec.score === "number" ? rec.score : 0,
    area_px: typeof rec.area_px === "number" ? rec.area_px : 0,
  };
}

// Segment, transparently recovering from a stranded embed_id.
//
// A service restart or a cache eviction invalidates the id the caller is holding
// and the server answers 409. The labeler must never see a stale mask or a
// cryptic error for that, so the first 409 re-encodes the SAME image bytes and
// retries once. The returned `embedId` is the id the result was actually produced
// with — the caller MUST write it back to its cache, or the next call repeats the
// whole dance.
//
// Exactly one retry, by design: a second consecutive 409 means the id is being
// invalidated faster than we can use it (or the server is broken), and looping
// would hammer a GPU that is already unhappy. That one propagates.
export async function segmentWithReencode(
  client: Sam3Client,
  embedId: string,
  image: Blob,
  box: BoxPrompt,
  points: PointPrompt[]
): Promise<SegmentResult & { embedId: string }> {
  try {
    const res = await client.segment(embedId, box, points);
    return { ...res, embedId };
  } catch (e) {
    if (!(e instanceof Sam3StaleEmbedError)) throw e;
    const fresh = await client.encode(image);
    const res = await client.segment(fresh.embed_id, box, points);
    return { ...res, embedId: fresh.embed_id };
  }
}
