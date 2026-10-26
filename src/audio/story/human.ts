/**
 * Which archive documents are human (DESIGN §8.6): the recurring piano motif "No. 14" is tied to the
 * people of The Last Thaw, so it plays over the Archive Revelation only when at least one document a
 * person wrote, remembered or photographed surfaced from the run. A ministry's reply or a council
 * notice is not a human voice, and denial (chapter 5) gets none.
 *
 * Human: a letter or memory not written by an institution of the bible (INSTITUTIONS); a caption
 * that is a photograph; a record kept by one of the bible's characters (a personal log).
 */
import { BIBLE, INSTITUTIONS } from '../../story/bible';
import type { ArchiveDocument } from '../../story/types';
import { HUMAN_DOCUMENT_RULE } from '../contract';

const characterIds: ReadonlySet<string> = new Set(BIBLE.characters.map((c) => c.id));
const institutions: ReadonlySet<string> = new Set(INSTITUTIONS);

export function isHumanFragment(doc: Pick<ArchiveDocument, 'kind' | 'author' | 'title'>): boolean {
  const R = HUMAN_DOCUMENT_RULE;
  if (R.personalKinds.includes(doc.kind)) return doc.author === undefined || !institutions.has(doc.author);
  if (doc.kind === R.photographKind) return doc.title.startsWith(R.photographTitlePrefix);
  if (doc.kind === R.characterRecordKind) return doc.author !== undefined && characterIds.has(doc.author);
  return false;
}

/** True when any of a run's surfaced documents is human. */
export const anyHuman = (docs: readonly Pick<ArchiveDocument, 'kind' | 'author' | 'title'>[]): boolean => docs.some(isHumanFragment);
