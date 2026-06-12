import type { LineString } from "geojson";
import type { WmeSDK } from "wme-sdk-typings";
import { describe, expect, it } from "vitest";
import { fixGroup, fixSegment, withFixLock } from "../src/fix";
import type { Issue } from "../src/matching/evaluate";
import { DEFAULT_SETTINGS } from "../src/settings";

const GEOMETRY: LineString = {
  type: "LineString",
  coordinates: [
    [6.63, 46.52],
    [6.64, 46.52],
  ],
};

let nextId = 1;

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    segmentId: nextId++,
    status: "VARIANT",
    currentName: "Av. de Florimont",
    suggestion: "Avenue de Florimont",
    note: null,
    cityId: 10,
    cityName: "Lausanne",
    roadType: 1,
    length: 100,
    geometry: GEOMETRY,
    fixable: true,
    ...overrides,
  };
}

/** Minimal SDK stub where every street fix succeeds. */
function makeSdk(): { sdk: WmeSDK; updates: number[] } {
  const updates: number[] = [];
  const sdk = {
    Editing: { isEditingAllowed: () => true },
    DataModel: {
      Segments: {
        getById: ({ segmentId }: { segmentId: number }) => ({
          id: segmentId,
          primaryStreetId: 100,
          alternateStreetIds: [],
        }),
        getAddress: () => ({ city: { id: 10, name: "Lausanne" } }),
        updateAddress: ({ segmentId }: { segmentId: number }) => {
          updates.push(segmentId);
        },
      },
      Streets: {
        getStreet: () => ({ id: 200, name: "Avenue de Florimont" }),
        addStreet: () => ({ id: 200, name: "Avenue de Florimont" }),
      },
    },
  } as unknown as WmeSDK;
  return { sdk, updates };
}

describe("fixSegment", () => {
  it("applies the suggestion", () => {
    const { sdk, updates } = makeSdk();
    const i = issue();
    const outcome = fixSegment(sdk, i, DEFAULT_SETTINGS);
    expect(outcome.ok).toBe(true);
    expect(updates).toEqual([i.segmentId]);
  });

  it("does nothing when the street is already assigned (no empty edit)", () => {
    const { sdk, updates } = makeSdk();
    // makeSdk assigns primaryStreetId 100; force getStreet to return that same street
    (sdk.DataModel.Streets as { getStreet: unknown }).getStreet = () => ({ id: 100 });
    const outcome = fixSegment(sdk, issue(), DEFAULT_SETTINGS);
    expect(outcome.ok).toBe(true);
    expect(updates).toHaveLength(0);
  });

  it("refuses non-fixable issues", () => {
    const { sdk } = makeSdk();
    const outcome = fixSegment(sdk, issue({ fixable: false, suggestion: null }), DEFAULT_SETTINGS);
    expect(outcome.ok).toBe(false);
    expect(outcome.errorCode).toBe("errNotFixable");
  });
});

describe("fixGroup", () => {
  it("reports progress for each segment and yields between them", async () => {
    const { sdk, updates } = makeSdk();
    const issues = [issue(), issue(), issue()];
    const progress: Array<[number, number]> = [];
    const outcomes = await fixGroup(sdk, issues, DEFAULT_SETTINGS, (done, total) =>
      progress.push([done, total]),
    );
    expect(outcomes).toHaveLength(3);
    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(updates).toHaveLength(3);
  });

  it("stops at the first error", async () => {
    const { sdk } = makeSdk();
    const issues = [issue(), issue({ fixable: false, suggestion: null }), issue()];
    const outcomes = await fixGroup(sdk, issues, DEFAULT_SETTINGS);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[1]?.ok).toBe(false);
  });
});

describe("withFixLock", () => {
  it("rejects re-entrance while a fix is running", async () => {
    let release!: () => void;
    const first = withFixLock(
      () => new Promise<string>((resolve) => (release = () => resolve("first"))),
    );
    const second = await withFixLock(async () => "second");
    expect(second).toBeNull();
    release();
    expect(await first).toBe("first");
    // lock released: next call goes through
    expect(await withFixLock(async () => "third")).toBe("third");
  });
});
