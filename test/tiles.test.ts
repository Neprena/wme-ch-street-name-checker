import { describe, expect, it } from "vitest";
import { TILE_SIZE_DEG, TileCache, TileFetcher, tileKeyToBbox, tileKeysForBbox } from "../src/geoadmin/tiles";
import type { Bbox } from "../src/geoadmin/types";
import { makeOfficial } from "./fixtures/swiss-names";

describe("tileKeysForBbox", () => {
  it("returns a single tile for a tiny bbox", () => {
    const keys = tileKeysForBbox([6.631, 46.521, 6.632, 46.522]);
    expect(keys).toHaveLength(1);
  });

  it("covers a bbox spanning tile boundaries", () => {
    const keys = tileKeysForBbox([6.619, 46.519, 6.641, 46.541]);
    // spans 2 tile columns x 2 tile rows
    expect(keys.length).toBeGreaterThanOrEqual(4);
  });

  it("roundtrips with tileKeyToBbox", () => {
    const [key] = tileKeysForBbox([6.631, 46.521, 6.632, 46.522]);
    const bbox = tileKeyToBbox(key as string);
    expect(bbox[2] - bbox[0]).toBeCloseTo(TILE_SIZE_DEG);
    expect(bbox[3] - bbox[1]).toBeCloseTo(TILE_SIZE_DEG);
    expect(bbox[0]).toBeLessThanOrEqual(6.631);
    expect(bbox[2]).toBeGreaterThanOrEqual(6.632);
  });
});

describe("TileCache", () => {
  it("returns null for misses and expires entries after the TTL", () => {
    let now = 1_000_000;
    const cache = new TileCache(10, 1000, () => now);
    expect(cache.get("a")).toBeNull();
    cache.set("a", [makeOfficial("Rue A")]);
    expect(cache.get("a")).toHaveLength(1);
    now += 1001;
    expect(cache.get("a")).toBeNull();
  });

  it("evicts the least recently used tile beyond capacity", () => {
    const cache = new TileCache(2, 60_000, () => 0);
    cache.set("a", []);
    cache.set("b", []);
    cache.get("a"); // touch a -> b becomes LRU
    cache.set("c", []);
    expect(cache.get("a")).not.toBeNull();
    expect(cache.get("b")).toBeNull();
    expect(cache.get("c")).not.toBeNull();
  });
});

describe("TileFetcher", () => {
  it("fetches uncached tiles, uses the cache afterwards, and dedupes by esid", async () => {
    const shared = makeOfficial("Rue Partagée");
    let calls = 0;
    const fetcher = new TileFetcher(new TileCache(10, 60_000, () => 0), async () => {
      calls++;
      return [shared, makeOfficial(`Rue ${calls}`)];
    });
    const bbox: Bbox = [6.619, 46.519, 6.641, 46.541];
    const tiles = tileKeysForBbox(bbox).length;

    const first = await fetcher.fetchBbox(bbox);
    expect(calls).toBe(tiles);
    // one shared entry across all tiles + one unique per tile
    expect(first).toHaveLength(tiles + 1);

    await fetcher.fetchBbox(bbox);
    expect(calls).toBe(tiles); // all cached, no new fetches
  });

  it("reports progress", async () => {
    const fetcher = new TileFetcher(new TileCache(10, 60_000, () => 0), async () => []);
    const progress: Array<[number, number]> = [];
    await fetcher.fetchBbox([6.631, 46.521, 6.632, 46.522], undefined, (done, total) =>
      progress.push([done, total]),
    );
    expect(progress[0]).toEqual([0, 1]);
    expect(progress.at(-1)).toEqual([1, 1]);
  });
});
