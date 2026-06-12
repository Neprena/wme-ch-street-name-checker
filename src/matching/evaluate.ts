import type { LineString } from "geojson";
import type { Segment, SegmentAddress } from "wme-sdk-typings";
import type { Settings } from "../settings";
import { k1 } from "./normalize";
import type { IndexedEntry, OfficialIndex } from "./official-index";

export type IssueStatus =
  | "COSMETIC"
  | "VARIANT"
  | "NEAR"
  | "WRONG_CITY"
  | "NOT_FOUND"
  | "UNNAMED";

export interface Issue {
  segmentId: number;
  status: IssueStatus;
  currentName: string | null;
  /** Official name to apply on fix; null when there is nothing to suggest. */
  suggestion: string | null;
  /** Qualifier shown next to the suggestion: planned / unofficial / full bilingual label. */
  suggestionNote: string | null;
  cityId: number | null;
  cityName: string | null;
  roadType: number;
  length: number;
  geometry: LineString;
  fixable: boolean;
}

export type Verdict =
  | { kind: "ok" }
  | { kind: "okAlt" }
  | { kind: "skipped" }
  | { kind: "issue"; issue: Issue };

function suggestionNoteFor(entry: IndexedEntry): string | null {
  const notes: string[] = [];
  if (!entry.street.official) notes.push("unofficial");
  const status = entry.street.status.toLowerCase();
  if (status !== "" && status !== "bestehend" && status !== "real" && status !== "existing") {
    notes.push("planned");
  }
  if (entry.isSlashPart) notes.push(`full label: ${entry.street.label}`);
  return notes.length > 0 ? notes.join(", ") : null;
}

export function evaluateSegment(
  segment: Segment,
  address: SegmentAddress,
  index: OfficialIndex,
  settings: Settings,
): Verdict {
  if (!settings.checkedRoadTypes.includes(segment.roadType)) return { kind: "skipped" };

  const currentName = address.street?.name?.trim() || null;
  const baseIssue = {
    segmentId: segment.id,
    currentName,
    cityId: address.city?.id ?? null,
    cityName: address.city?.name ?? null,
    roadType: segment.roadType,
    length: segment.length,
    geometry: segment.geometry,
  };

  if (!currentName) {
    // Unnamed roundabout segments are normal in Waze.
    if (segment.junctionId !== null) return { kind: "skipped" };
    return {
      kind: "issue",
      issue: {
        ...baseIssue,
        status: "UNNAMED",
        suggestion: null,
        suggestionNote: null,
        fixable: false,
      },
    };
  }

  const locality =
    settings.cityScoping !== "off" && address.city?.name ? k1(address.city.name) : undefined;

  const match = index.lookup(currentName, locality);
  if (match) {
    if (match.level === "exact") {
      if (locality && !match.inLocality) {
        return {
          kind: "issue",
          issue: {
            ...baseIssue,
            status: "WRONG_CITY",
            suggestion: null,
            suggestionNote: `exists in: ${match.entry.street.zipLabel}`,
            fixable: false,
          },
        };
      }
      return { kind: "ok" };
    }
    const statusByLevel = { cosmetic: "COSMETIC", variant: "VARIANT", near: "NEAR" } as const;
    return {
      kind: "issue",
      issue: {
        ...baseIssue,
        status: statusByLevel[match.level],
        suggestion: match.entry.namePart,
        suggestionNote: suggestionNoteFor(match.entry),
        fixable: true,
      },
    };
  }

  if (settings.altNameCountsAsOk) {
    for (const alt of address.altStreets) {
      const altName = alt.street?.name?.trim();
      if (!altName) continue;
      const altMatch = index.lookup(altName, locality);
      if (altMatch && (altMatch.level === "exact" || altMatch.level === "cosmetic")) {
        return { kind: "okAlt" };
      }
    }
  }

  return {
    kind: "issue",
    issue: {
      ...baseIssue,
      status: "NOT_FOUND",
      suggestion: null,
      suggestionNote: null,
      fixable: false,
    },
  };
}
