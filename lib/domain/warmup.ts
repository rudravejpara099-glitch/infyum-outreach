/** The existing ten-piece engagement rule must finish before a first DM is prepared. */
export function warmupComplete(result: { likes: number; comments: number; followed: boolean }, pieces: number): boolean {
  return Number.isSafeInteger(pieces) && pieces > 0 && result.likes === pieces
    && Number.isSafeInteger(result.comments) && result.comments >= 0 && result.comments <= pieces
    && result.followed;
}
