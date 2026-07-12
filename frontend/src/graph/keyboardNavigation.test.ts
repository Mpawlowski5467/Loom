import { describe, expect, it } from "vitest";
import {
  findDirectionalNode,
  type GraphArrowKey,
  type ViewportNodePoint,
} from "./keyboardNavigation";

const center = { x: 100, y: 100 };

function node(id: string, x: number, y: number): ViewportNodePoint {
  return { id, x, y };
}

describe("findDirectionalNode", () => {
  it.each<[GraphArrowKey, string]>([
    ["ArrowUp", "up"],
    ["ArrowDown", "down"],
    ["ArrowLeft", "left"],
    ["ArrowRight", "right"],
  ])("uses the viewport center for %s without a selection", (key, id) => {
    const nodes = [
      node("up", 100, 60),
      node("down", 100, 140),
      node("left", 60, 100),
      node("right", 140, 100),
    ];

    expect(
      findDirectionalNode(nodes, key, { viewportCenter: center })?.id,
    ).toBe(id);
  });

  it("navigates from the selected node and excludes that origin", () => {
    const selected = node("selected", 200, 100);
    const nodes = [
      node("center-right", 140, 100),
      selected,
      node("selected-right", 220, 100),
    ];

    expect(
      findDirectionalNode(nodes, "ArrowRight", {
        selectedOrigin: selected,
        viewportCenter: center,
      }),
    ).toEqual(node("selected-right", 220, 100));
  });

  it("falls back to the viewport center for a non-finite selected position", () => {
    const result = findDirectionalNode(
      [node("right", 120, 100), node("left", 80, 100)],
      "ArrowRight",
      {
        selectedOrigin: node("stale", Number.NaN, 100),
        viewportCenter: center,
      },
    );

    expect(result?.id).toBe("right");
  });

  it("rejects nodes behind or exactly perpendicular to the direction", () => {
    const nodes = [
      node("behind", 90, 100),
      node("above", 100, 80),
      node("below", 100, 120),
    ];

    expect(
      findDirectionalNode(nodes, "ArrowRight", { viewportCenter: center }),
    ).toBeNull();
  });

  it("balances forward and perpendicular distance", () => {
    const nodes = [
      node("close-but-wide", 120, 125),
      node("aligned", 160, 100),
      node("close-and-near-axis", 120, 105),
    ];

    expect(
      findDirectionalNode(nodes.slice(0, 2), "ArrowRight", {
        viewportCenter: center,
      })?.id,
    ).toBe("aligned");
    expect(
      findDirectionalNode(nodes, "ArrowRight", { viewportCenter: center })?.id,
    ).toBe("close-and-near-axis");
  });

  it("breaks geometric ties by id regardless of input order", () => {
    const alpha = node("alpha", 110, 105);
    const zeta = node("zeta", 110, 95);
    const options = { viewportCenter: center };

    expect(findDirectionalNode([zeta, alpha], "ArrowRight", options)?.id).toBe(
      "alpha",
    );
    expect(findDirectionalNode([alpha, zeta], "ArrowRight", options)?.id).toBe(
      "alpha",
    );
  });

  it("ignores non-finite node positions", () => {
    const result = findDirectionalNode(
      [
        node("nan", Number.NaN, 100),
        node("infinite", Number.POSITIVE_INFINITY, 100),
        node("valid", 130, 100),
      ],
      "ArrowRight",
      { viewportCenter: center },
    );

    expect(result?.id).toBe("valid");
  });

  it("returns null when the viewport center and selected origin are unusable", () => {
    expect(
      findDirectionalNode([node("candidate", 120, 100)], "ArrowRight", {
        viewportCenter: { x: Number.NaN, y: 100 },
      }),
    ).toBeNull();
  });
});
