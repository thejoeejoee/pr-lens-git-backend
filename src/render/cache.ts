import { graphContentHash } from "@coldtea/pr-lens-renderer";
import type { GraphDoc } from "@coldtea/pr-lens-schema";

import { draw, EMPTY_DRAWING, type Drawing } from "./draw.ts";

/**
 * Drawings, kept by the hash of the document they came from.
 *
 * The renderer reads no clock, no file and no random number, so the same
 * document always produces the same bytes. That is what makes this cache sound
 * and makes the picture routes stateless: any instance can redraw any revision
 * it holds the document for, and nothing has to be stored alongside it.
 *
 * Eviction is least-recently-used against a byte budget rather than a count,
 * because one large document can outweigh a hundred small ones.
 */
export class DrawingCache {
  readonly #budgetBytes: number;
  readonly #enabled: boolean;
  /** Insertion order is the LRU order; a hit re-inserts at the end. */
  readonly #held = new Map<string, Drawing>();
  #bytes = 0;

  constructor(budgetBytes: number, enabled: boolean) {
    this.#budgetBytes = budgetBytes;
    this.#enabled = enabled;
  }

  /**
   * Throws whatever `draw` throws, which for an undrawable document is the
   * CANNOT_DRAW the contract asks for.
   */
  for(doc: GraphDoc): Drawing {
    if (!this.#enabled) return EMPTY_DRAWING;

    const key = graphContentHash(doc);
    const held = this.#held.get(key);
    if (held !== undefined) {
      this.#held.delete(key);
      this.#held.set(key, held);
      return held;
    }

    const drawing = draw(doc);

    // A drawing larger than the whole budget is served and dropped rather than
    // evicting everything else to make room for one thing.
    if (drawing.bytes <= this.#budgetBytes) {
      this.#held.set(key, drawing);
      this.#bytes += drawing.bytes;
      this.#evict();
    }

    return drawing;
  }

  #evict(): void {
    for (const [key, drawing] of this.#held) {
      if (this.#bytes <= this.#budgetBytes) return;
      this.#held.delete(key);
      this.#bytes -= drawing.bytes;
    }
  }

  stats(): { drawings: number; bytes: number; budgetBytes: number } {
    return {
      drawings: this.#held.size,
      bytes: this.#bytes,
      budgetBytes: this.#budgetBytes,
    };
  }
}
