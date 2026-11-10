// The numbers every page shares: the design size and the campaign's fixed points.
export const W = 720;
export const H = 1280;

// what the original shows before anything has been passed (max_dun_id 0)
export const FIRST_STAGE = 10010;

// The battle map of a chapter. Only the first chapter's map (10008, data_drama_world_info) is in the release, so every chapter fights on it
// for now; when the other maps are packed this is the one place that maps a chapter to its picture.
export function chapterMap(_chapterId: number): number {
  return 10008;
}
