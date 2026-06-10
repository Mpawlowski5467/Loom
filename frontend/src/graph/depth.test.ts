/*
Frontend testing conventions:
- Pure utility functions: direct input/output assertions, no DOM.
*/
import { describe, expect, it } from "vitest";
import Graph from "graphology";
import {
  collectNodeZ,
  DEPTH_INK_FADE,
  depthColorFor,
  depthSizeFactor,
  depthSizeFactorFor,
  fadeAlpha,
  hash01,
  makeEdgeFader,
  mixToward,
  zForNode,
} from "./depth";
import type { GraphTuning } from "./tuning";

function tuning(partial: Partial<GraphTuning>): GraphTuning {
  return {
    depthEnabled: true,
    ...partial,
  } as GraphTuning;
}

describe("hash01", () => {
  it("is deterministic and within [0, 1)", () => {
    for (const id of ["a", "thr_x1", "note-with-long-id", ""]) {
      const v = hash01(id);
      expect(v).toBe(hash01(id));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("spreads distinct ids", () => {
    expect(hash01("thr_a1")).not.toBe(hash01("thr_a2"));
  });
});

describe("zForNode", () => {
  it("keeps hubs nearer the focus plane than leaves with the same hash", () => {
    const id = "thr_xyz";
    expect(zForNode(id, 12)).toBeLessThan(zForNode(id, 0));
  });

  it("stays within [0, 1)", () => {
    for (const id of ["a", "b", "c", "d"]) {
      for (const c of [0, 3, 12, 40]) {
        const z = zForNode(id, c);
        expect(z).toBeGreaterThanOrEqual(0);
        expect(z).toBeLessThan(1);
      }
    }
  });
});

describe("depthSizeFactor", () => {
  it("is 1 on the focus plane and shrinks with depth", () => {
    expect(depthSizeFactor(0)).toBe(1);
    expect(depthSizeFactor(1)).toBeLessThan(depthSizeFactor(0.5));
    expect(depthSizeFactor(1)).toBeGreaterThan(0);
  });

  it("depthSizeFactorFor is 1 when depth is disabled", () => {
    expect(depthSizeFactorFor(tuning({ depthEnabled: false }), 0.9)).toBe(1);
    expect(depthSizeFactorFor(tuning({}), 0.9)).toBe(depthSizeFactor(0.9));
  });
});

describe("depthColorFor / collectNodeZ", () => {
  it("depthColorFor blends by DEPTH_INK_FADE * z", () => {
    expect(depthColorFor("#000000", "#ffffff", 0)).toBe("#000000");
    expect(depthColorFor("#000000", "#ffffff", 1)).toBe(
      mixToward("#000000", "#ffffff", DEPTH_INK_FADE),
    );
  });

  it("collectNodeZ snapshots z attrs, defaulting to 0", () => {
    const g = new Graph();
    g.addNode("a", { z: 0.7 });
    g.addNode("b", {});
    expect(collectNodeZ(g)).toEqual(
      new Map([
        ["a", 0.7],
        ["b", 0],
      ]),
    );
  });
});

describe("color helpers", () => {
  it("mixToward blends hex toward a target and clamps t", () => {
    expect(mixToward("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixToward("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixToward("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixToward("#000000", "#ffffff", 2)).toBe("#ffffff");
  });

  it("mixToward returns the input unchanged on unparseable colors", () => {
    expect(mixToward("rebeccapurple", "#ffffff", 0.5)).toBe("rebeccapurple");
    expect(mixToward("#2d4a7c", "var(--bg)", 0.5)).toBe("#2d4a7c");
  });

  it("fadeAlpha scales rgba alpha and converts hex", () => {
    expect(fadeAlpha("rgba(26,24,21,0.18)", 0.5)).toBe("rgba(26,24,21,0.09)");
    expect(fadeAlpha("rgb(10, 20, 30)", 0.5)).toBe("rgba(10,20,30,0.5)");
    expect(fadeAlpha("#ff0000", 0.25)).toBe("rgba(255,0,0,0.25)");
    expect(fadeAlpha("not-a-color", 0.5)).toBe("not-a-color");
  });

  it("makeEdgeFader memoizes per (base, quantized fade)", () => {
    const fade = makeEdgeFader();
    const a = fade("rgba(26,24,21,0.18)", 0.701);
    const b = fade("rgba(26,24,21,0.18)", 0.699);
    expect(a).toBe(b); // same 0.70 bucket → same cached string
    expect(fade("rgba(26,24,21,0.18)", 0.5)).not.toBe(a);
  });
});
