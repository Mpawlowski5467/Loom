import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { CaptureItem } from "../../../lib/api";
import { CaptureCard } from "../CaptureCard";

void React;

const BASE: CaptureItem = {
  id: "cap_001",
  title: "Test capture",
  type: "capture",
  tags: [],
  created: "2026-05-16T10:00:00Z",
  modified: "2026-05-16T10:00:00Z",
  author: "user",
  source: "manual",
  status: "active",
  preview: "preview text",
  file_path: "/path/captures/test.md",
};

describe("CaptureCard", () => {
  it("renders title and preview", () => {
    render(
      <CaptureCard
        capture={BASE}
        effectiveStatus="pending"
        onProcess={vi.fn()}
        onArchive={vi.fn()}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText("Test capture")).toBeDefined();
    expect(screen.getByText("preview text")).toBeDefined();
  });

  it("shows Pending badge for pending status", () => {
    render(
      <CaptureCard
        capture={BASE}
        effectiveStatus="pending"
        onProcess={vi.fn()}
        onArchive={vi.fn()}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText("Pending")).toBeDefined();
  });

  it("shows Filed → label when done with note_title", () => {
    render(
      <CaptureCard
        capture={BASE}
        effectiveStatus="done"
        processResult={{
          processed: true,
          note_id: "n1",
          note_title: "Result Note",
          note_type: "topic",
          target_path: "",
          error: "",
        }}
        onProcess={vi.fn()}
        onArchive={vi.fn()}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText("Filed → [[Result Note]]")).toBeDefined();
  });

  it("disables Process button when processing", () => {
    render(
      <CaptureCard
        capture={BASE}
        effectiveStatus="processing"
        onProcess={vi.fn()}
        onArchive={vi.fn()}
        onClick={vi.fn()}
      />,
    );
    const processBtn = screen.getByText("Processing...") as HTMLButtonElement;
    expect(processBtn.disabled).toBe(true);
  });

  it("calls onProcess when Process clicked", () => {
    const onProcess = vi.fn();
    render(
      <CaptureCard
        capture={BASE}
        effectiveStatus="pending"
        onProcess={onProcess}
        onArchive={vi.fn()}
        onClick={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Process"));
    expect(onProcess).toHaveBeenCalledOnce();
  });

  it("calls onArchive without bubbling to card click", () => {
    const onArchive = vi.fn();
    const onClick = vi.fn();
    render(
      <CaptureCard
        capture={BASE}
        effectiveStatus="pending"
        onProcess={vi.fn()}
        onArchive={onArchive}
        onClick={onClick}
      />,
    );
    fireEvent.click(screen.getByText("Archive"));
    expect(onArchive).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });
});
