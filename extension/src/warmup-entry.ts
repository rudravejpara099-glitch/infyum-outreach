// Bundled into extension/warmup.js by scripts/build-extension.ts. The same warm-up logic the Node connector uses,
// so the like, comment and follow rules live in one place (worker/chrome-warmup.ts).
export { runChromeWarmup } from "@/worker/chrome-warmup";
export { humanDelayMs } from "@/lib/domain/pacing";
export { InstagramBlockedError, InstagramWarmupUncertainError } from "@/worker/driver";
