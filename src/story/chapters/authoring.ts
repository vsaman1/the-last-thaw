/**
 * Small authoring helpers shared by the nine chapter files, and the OVERLAY_REQUESTS contract the
 * level designers read when they add a chapter's extra human structures.
 *
 * Why requests and not placements: the writer decides WHAT the story needs in a level (a block of
 * flats on Station Street, a pipeline across the avalanche track) and roughly WHERE; the designers
 * decide the exact s/d/yaw so the world-logic rules (roads, parking, sea, slopes) and the routes still
 * hold. Until they do, every chapter's `overlay` stays `{ obstacles: [] }`.
 */

import type { ObstacleKind } from '../../core/types';
import type { ArchiveFragment, ChapterId } from '../types';

/**
 * Kinds a request may ask for. The five new kinds are spelled out as strings so this compiles before
 * the props engineer adds them to the StructureKind union (after the merge they are ObstacleKinds too).
 */
export type RequestedKind = ObstacleKind | 'apartmentBlock' | 'pumpjack' | 'oilRig' | 'pipeline' | 'monument';

/** One extra structure the story wants in a level. */
export interface OverlayRequest {
  readonly kind: RequestedKind;
  /** Course position and context from the level's header, e.g. 's≈712 d≈60, on Station Street'. */
  readonly near: string;
  /** Why the story wants it there (what it stands for in the archive). */
  readonly purpose: string;
  /** When the structure should become a named landmark (source 'overlay') once it is placed. */
  readonly landmark?: { readonly id: string; readonly name: string; readonly label?: string };
}

/** Builds a chapter's fragments without repeating its id on every entry. */
export function fragmentsOf(chapterId: ChapterId) {
  return (fragment: Omit<ArchiveFragment, 'chapterId'>): ArchiveFragment => ({ chapterId, ...fragment });
}
