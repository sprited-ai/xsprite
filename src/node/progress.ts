/** Fake progress bar for long opaque waits (model calls give no progress).
 * Approaches 95% asymptotically over the expected duration; completion snaps
 * to 100%. TTY only — silent newline-style logs otherwise. */

export function startProgress(label: string, expectedMs: number) {
  const start = Date.now();
  const isTTY = process.stderr.isTTY;
  if (!isTTY) process.stderr.write(`${label}...\n`);

  const render = () => {
    const t = Date.now() - start;
    const pct = 95 * (1 - Math.exp(-t / (expectedMs / 2)));
    draw(label, pct, t);
  };
  const timer = isTTY ? setInterval(render, 120) : undefined;

  return {
    done(finalLabel?: string) {
      if (timer) clearInterval(timer);
      if (isTTY) {
        draw(finalLabel ?? label, 100, Date.now() - start);
        process.stderr.write("\n");
      } else if (finalLabel) {
        process.stderr.write(`${finalLabel} (${((Date.now() - start) / 1000).toFixed(1)}s)\n`);
      }
    },
  };
}

function draw(label: string, pct: number, elapsedMs: number) {
  const width = 28;
  const filled = Math.round((pct / 100) * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const secs = (elapsedMs / 1000).toFixed(0);
  process.stderr.write(`\r${label} [${bar}] ${pct.toFixed(0).padStart(3)}% ${secs}s `);
}
