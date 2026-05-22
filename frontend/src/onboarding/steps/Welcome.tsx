import type { ReactNode } from "react";
import { LoomMark } from "../../components/primitives/LoomMark";

interface Props {
  onNext: () => void;
}

export function Welcome({ onNext }: Props): ReactNode {
  return (
    <div className="onb-step onb-welcome">
      <div className="onb-mark">
        <LoomMark size={96} dur={2.6} loop color="var(--ink)" />
      </div>
      <h1 className="onb-h1">Welcome to Loom</h1>
      <p className="onb-lede">
        A local-first memory system. Your notes live as plain markdown on
        disk — Loom's agents read and link them on your behalf.
      </p>
      <ul className="onb-points">
        <li>
          <span className="onb-points-mark">·</span>
          Everything stays on this machine. No cloud, no telemetry.
        </li>
        <li>
          <span className="onb-points-mark">·</span>
          Bring your own AI provider — OpenAI, Anthropic, xAI, or local Ollama.
        </li>
        <li>
          <span className="onb-points-mark">·</span>
          You can always re-run this setup from Settings later.
        </li>
      </ul>
      <div className="onb-actions">
        <button className="btn btn-md btn-active" onClick={onNext}>
          Begin →
        </button>
      </div>
    </div>
  );
}
