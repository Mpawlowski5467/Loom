import { describe, expect, it } from "vitest";
import { glColor } from "./glColor";

describe("glColor", () => {
  it("premultiplies translucent rgba colors", () => {
    expect(glColor("rgba(250, 250, 250, 0.2)")).toBe("rgba(50,50,50,0.2)");
    expect(glColor("rgba(10,20,30,0.5)")).toBe("rgba(5,10,15,0.5)");
  });

  it("leaves opaque and non-rgba colors alone", () => {
    expect(glColor("rgba(10,20,30,1)")).toBe("rgba(10,20,30,1)");
    expect(glColor("#60a5fa")).toBe("#60a5fa");
    expect(glColor("rgb(1,2,3)")).toBe("rgb(1,2,3)");
  });
});
