/** A warm-up visit is complete when it touched between one and `pieces` posts (every one liked), commented on no more than it liked, and followed. */
export function warmupComplete(result: { likes: number; comments: number; followed: boolean }, pieces: number): boolean {
  return Number.isSafeInteger(pieces) && pieces > 0
    && Number.isSafeInteger(result.likes) && result.likes >= 1 && result.likes <= pieces
    && Number.isSafeInteger(result.comments) && result.comments >= 0 && result.comments <= result.likes
    && result.followed;
}
