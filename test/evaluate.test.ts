import type { LineString } from "geojson";
import type { Segment, SegmentAddress } from "wme-sdk-typings";
import { describe, expect, it } from "vitest";
import { evaluateSegment } from "../src/matching/evaluate";
import { OfficialIndex } from "../src/matching/official-index";
import { DEFAULT_SETTINGS, type Settings } from "../src/settings";
import { LAUSANNE_STREETS, makeOfficial } from "./fixtures/swiss-names";

const GEOMETRY: LineString = {
  type: "LineString",
  coordinates: [
    [6.63, 46.52],
    [6.64, 46.52],
  ],
};

function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 1,
    roadType: 1,
    junctionId: null,
    length: 120,
    geometry: GEOMETRY,
    primaryStreetId: 100,
    alternateStreetIds: [],
    ...overrides,
  } as unknown as Segment;
}

function makeAddress(
  streetName: string | null,
  altNames: string[] = [],
  cityName: string | null = "Lausanne",
): SegmentAddress {
  const city = cityName ? { id: 10, name: cityName } : null;
  return {
    street: streetName ? { id: 100, name: streetName } : null,
    city,
    state: null,
    country: null,
    isEmpty: streetName === null,
    altStreets: altNames.map((name) => ({
      street: { id: 200, name },
      city,
      state: null,
      country: null,
      isEmpty: false,
      altStreets: [],
    })),
  } as unknown as SegmentAddress;
}

const index = new OfficialIndex(LAUSANNE_STREETS);
const settings: Settings = { ...DEFAULT_SETTINGS };

describe("evaluateSegment", () => {
  it("skips unchecked road types", () => {
    const v = evaluateSegment(
      makeSegment({ roadType: 4 } as Partial<Segment>),
      makeAddress("Whatever"),
      index,
      settings,
    );
    expect(v.kind).toBe("skipped");
  });

  it("skips unnamed roundabout segments", () => {
    const v = evaluateSegment(
      makeSegment({ junctionId: 42 } as Partial<Segment>),
      makeAddress(null),
      index,
      settings,
    );
    expect(v.kind).toBe("skipped");
  });

  it("flags unnamed checkable segments", () => {
    const v = evaluateSegment(makeSegment(), makeAddress(null), index, settings);
    expect(v.kind).toBe("issue");
    if (v.kind === "issue") {
      expect(v.issue.status).toBe("UNNAMED");
      expect(v.issue.fixable).toBe(false);
    }
  });

  it("returns ok for an exact match", () => {
    const v = evaluateSegment(makeSegment(), makeAddress("Rue du Grand-Pont"), index, settings);
    expect(v.kind).toBe("ok");
  });

  it("produces a fixable COSMETIC issue with the official spelling as suggestion", () => {
    const v = evaluateSegment(makeSegment(), makeAddress("rue du grand-pont"), index, settings);
    expect(v.kind).toBe("issue");
    if (v.kind === "issue") {
      expect(v.issue.status).toBe("COSMETIC");
      expect(v.issue.suggestion).toBe("Rue du Grand-Pont");
      expect(v.issue.fixable).toBe(true);
    }
  });

  it("produces a VARIANT issue for abbreviations", () => {
    const v = evaluateSegment(makeSegment(), makeAddress("Av. de Florimont"), index, settings);
    expect(v.kind).toBe("issue");
    if (v.kind === "issue") expect(v.issue.status).toBe("VARIANT");
  });

  it("produces a NEAR issue for typos", () => {
    const v = evaluateSegment(makeSegment(), makeAddress("Avenue de Florimomt"), index, settings);
    expect(v.kind).toBe("issue");
    if (v.kind === "issue") {
      expect(v.issue.status).toBe("NEAR");
      expect(v.issue.suggestion).toBe("Avenue de Florimont");
    }
  });

  it("accepts an alternate-name match as okAlt", () => {
    const v = evaluateSegment(
      makeSegment(),
      makeAddress("Nom Fantaisiste", ["Rue du Grand-Pont"]),
      index,
      settings,
    );
    expect(v.kind).toBe("okAlt");
  });

  it("ignores alternates when the setting is off", () => {
    const v = evaluateSegment(
      makeSegment(),
      makeAddress("Nom Fantaisiste", ["Rue du Grand-Pont"]),
      index,
      { ...settings, altNameCountsAsOk: false },
    );
    expect(v.kind).toBe("issue");
    if (v.kind === "issue") expect(v.issue.status).toBe("NOT_FOUND");
  });

  it("flags WRONG_CITY under scoping when the name exists only elsewhere", () => {
    const scoped = new OfficialIndex([
      makeOfficial("Rue de la Gare", { zipLabel: "1009 Pully", comName: "Pully" }),
    ]);
    const v = evaluateSegment(
      makeSegment(),
      makeAddress("Rue de la Gare", [], "Lausanne"),
      scoped,
      { ...settings, cityScoping: "warn" },
    );
    expect(v.kind).toBe("issue");
    if (v.kind === "issue") {
      expect(v.issue.status).toBe("WRONG_CITY");
      expect(v.issue.fixable).toBe(false);
    }
  });

  it("does not flag WRONG_CITY when scoping is off", () => {
    const scoped = new OfficialIndex([
      makeOfficial("Rue de la Gare", { zipLabel: "1009 Pully", comName: "Pully" }),
    ]);
    const v = evaluateSegment(
      makeSegment(),
      makeAddress("Rue de la Gare", [], "Lausanne"),
      scoped,
      settings,
    );
    expect(v.kind).toBe("ok");
  });
});
