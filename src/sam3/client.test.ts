import { describe, it, expect, vi } from "vitest";
import {
  createSam3Client,
  segmentWithReencode,
  Sam3ServiceError,
  Sam3StaleEmbedError,
  Sam3UnreachableError,
  SAM3_DEFAULT_BASE_URL,
  type BoxPrompt,
} from "./client";

const BOX: BoxPrompt = [10, 20, 30, 40];

// The init shape the client passes. Spelled out here (rather than relying on
// inference from `vi.fn(async () => …)`, which infers a ZERO-arg signature and
// makes `mock.calls[i][1]` unusable) so the assertions can read method/headers/body.
type Init = {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  signal?: AbortSignal;
};

// Minimal Response stand-in: the client only ever reads `ok`, `status`, `json()`.
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function badJsonResponse(status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError("not json");
    },
  } as unknown as Response;
}

const ONE_CANDIDATE = {
  candidates: [
    { rings: [[[1, 2], [3, 4], [5, 6]]], score: 0.9, area_px: 120 },
  ],
  ms: 70,
};

describe("createSam3Client", () => {
  it("defaults to the tunnel URL and strips a trailing slash", () => {
    expect(createSam3Client({}).baseUrl).toBe(SAM3_DEFAULT_BASE_URL);
    expect(createSam3Client({ baseUrl: "http://gpu:9000/" }).baseUrl).toBe(
      "http://gpu:9000"
    );
    // An empty/blank override falls back rather than producing "" + "/segment".
    expect(createSam3Client({ baseUrl: "" }).baseUrl).toBe(SAM3_DEFAULT_BASE_URL);
  });

  it("health() reads the documented fields", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: Init) =>
      jsonResponse({ ok: true, gpu: "A6000", model: "sam3", cached: 2 })
    );
    const client = createSam3Client({ baseUrl: "http://x:1", fetchImpl });
    await expect(client.health()).resolves.toEqual({
      ok: true,
      gpu: "A6000",
      model: "sam3",
      cached: 2,
    });
    expect(fetchImpl.mock.calls[0][0]).toBe("http://x:1/health");
  });

  it("encode() POSTs multipart and returns the embed_id", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: Init) =>
      jsonResponse({ embed_id: "e1", w: 4000, h: 3000, ms: 392 })
    );
    const client = createSam3Client({ baseUrl: "http://x:1", fetchImpl });
    const res = await client.encode(new Blob(["bytes"]));
    expect(res.embed_id).toBe("e1");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://x:1/encode");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it("encode() rejects a 2xx response with no embed_id as a service error", async () => {
    const client = createSam3Client({
      baseUrl: "http://x:1",
      fetchImpl: async () => jsonResponse({ w: 1, h: 1 }),
    });
    await expect(client.encode(new Blob([]))).rejects.toBeInstanceOf(Sam3ServiceError);
  });

  it("segment() sends the box and the FULL click list on every call", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: Init) =>
      jsonResponse(ONE_CANDIDATE)
    );
    const client = createSam3Client({ baseUrl: "http://x:1", fetchImpl });
    await client.segment("e1", BOX, [
      [11, 21, 1],
      [12, 22, 0],
    ]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://x:1/segment");
    expect(init?.headers?.["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init?.body as string)).toEqual({
      embed_id: "e1",
      box: [10, 20, 30, 40],
      points: [
        [11, 21, 1],
        [12, 22, 0],
      ],
    });
  });

  it("segment() parses candidates and defaults missing numeric fields", async () => {
    const client = createSam3Client({
      baseUrl: "http://x:1",
      fetchImpl: async () =>
        jsonResponse({ candidates: [{ rings: [[[1, 2], [3, 4]]] }] }),
    });
    const res = await client.segment("e1", BOX, []);
    expect(res.candidates).toEqual([
      { rings: [[[1, 2], [3, 4]]], score: 0, area_px: 0 },
    ]);
    expect(res.ms).toBe(0);
  });

  it("segment() drops malformed ring vertices and empty rings rather than throwing", async () => {
    const client = createSam3Client({
      baseUrl: "http://x:1",
      fetchImpl: async () =>
        jsonResponse({
          candidates: [
            {
              rings: [
                [[1, 2], ["x", 4], [5, 6]], // bad vertex skipped
                [], // empty ring dropped
                "nope", // non-array ring dropped
              ],
              score: 0.5,
              area_px: 9,
            },
          ],
        }),
    });
    const res = await client.segment("e1", BOX, []);
    expect(res.candidates[0].rings).toEqual([[[1, 2], [5, 6]]]);
  });

  it("segment() throws Sam3StaleEmbedError on 409", async () => {
    const client = createSam3Client({
      baseUrl: "http://x:1",
      fetchImpl: async () => jsonResponse({ error: "STALE_EMBED_ID" }, 409),
    });
    await expect(client.segment("e1", BOX, [])).rejects.toBeInstanceOf(
      Sam3StaleEmbedError
    );
  });

  it("distinguishes unreachable (fetch rejects) from a service error (non-2xx)", async () => {
    const down = createSam3Client({
      baseUrl: "http://x:1",
      fetchImpl: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await expect(down.segment("e1", BOX, [])).rejects.toBeInstanceOf(
      Sam3UnreachableError
    );

    const broken = createSam3Client({
      baseUrl: "http://x:1",
      fetchImpl: async () => jsonResponse({ detail: "cuda oom" }, 500),
    });
    await expect(broken.segment("e1", BOX, [])).rejects.toBeInstanceOf(
      Sam3ServiceError
    );
    await expect(broken.segment("e1", BOX, [])).rejects.not.toBeInstanceOf(
      Sam3UnreachableError
    );
  });

  it("treats a non-JSON 2xx body as a service error", async () => {
    const client = createSam3Client({
      baseUrl: "http://x:1",
      fetchImpl: async () => badJsonResponse(200),
    });
    await expect(client.segment("e1", BOX, [])).rejects.toBeInstanceOf(
      Sam3ServiceError
    );
  });

  it("treats a 2xx /segment body with no candidates array as a service error", async () => {
    const client = createSam3Client({
      baseUrl: "http://x:1",
      fetchImpl: async () => jsonResponse({ ms: 5 }),
    });
    await expect(client.segment("e1", BOX, [])).rejects.toBeInstanceOf(
      Sam3ServiceError
    );
  });
});

describe("segmentWithReencode — the 409 recovery path", () => {
  it("passes through on success without re-encoding, returning the same embedId", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: Init) =>
      jsonResponse(ONE_CANDIDATE)
    );
    const client = createSam3Client({ baseUrl: "http://x:1", fetchImpl });
    const res = await segmentWithReencode(
      client,
      "e1",
      new Blob(["bytes"]),
      BOX,
      []
    );
    expect(res.embedId).toBe("e1");
    expect(res.candidates).toHaveLength(1);
    // Exactly one call: no encode happened.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("on 409, re-encodes ONCE and retries, returning the FRESH embedId", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string, _init?: Init) => {
      calls.push(url);
      if (url.endsWith("/encode")) {
        return jsonResponse({ embed_id: "e2", w: 10, h: 10, ms: 1 });
      }
      // First /segment is stale; the retry (after the re-encode) succeeds.
      const priorSegments = calls.filter((c) => c.endsWith("/segment")).length;
      return priorSegments === 1
        ? jsonResponse({ error: "STALE_EMBED_ID" }, 409)
        : jsonResponse(ONE_CANDIDATE);
    });
    const client = createSam3Client({ baseUrl: "http://x:1", fetchImpl });

    const res = await segmentWithReencode(
      client,
      "stale",
      new Blob(["bytes"]),
      BOX,
      [[1, 2, 1]]
    );

    expect(res.embedId).toBe("e2");
    expect(res.candidates).toHaveLength(1);
    expect(calls).toEqual([
      "http://x:1/segment",
      "http://x:1/encode",
      "http://x:1/segment",
    ]);
    // The retry resends the box AND the full click list against the new id.
    const retryBody = JSON.parse(
      fetchImpl.mock.calls[2][1]?.body as string
    );
    expect(retryBody).toEqual({
      embed_id: "e2",
      box: [10, 20, 30, 40],
      points: [[1, 2, 1]],
    });
  });

  it("a SECOND consecutive 409 propagates — it retries once, it does not loop", async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: Init) =>
      url.endsWith("/encode")
        ? jsonResponse({ embed_id: "e2", w: 10, h: 10, ms: 1 })
        : jsonResponse({ error: "STALE_EMBED_ID" }, 409)
    );
    const client = createSam3Client({ baseUrl: "http://x:1", fetchImpl });

    await expect(
      segmentWithReencode(client, "stale", new Blob(["bytes"]), BOX, [])
    ).rejects.toBeInstanceOf(Sam3StaleEmbedError);

    // segment, encode, segment — and then it stops.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not re-encode for a non-409 failure", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: Init) =>
      jsonResponse({ detail: "boom" }, 500)
    );
    const client = createSam3Client({ baseUrl: "http://x:1", fetchImpl });
    await expect(
      segmentWithReencode(client, "e1", new Blob(["bytes"]), BOX, [])
    ).rejects.toBeInstanceOf(Sam3ServiceError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("propagates an unreachable service from the re-encode leg", async () => {
    let n = 0;
    const client = createSam3Client({
      baseUrl: "http://x:1",
      fetchImpl: async () => {
        n++;
        if (n === 1) return jsonResponse({ error: "STALE_EMBED_ID" }, 409);
        throw new TypeError("Failed to fetch"); // tunnel dropped mid-recovery
      },
    });
    await expect(
      segmentWithReencode(client, "e1", new Blob(["bytes"]), BOX, [])
    ).rejects.toBeInstanceOf(Sam3UnreachableError);
  });
});
