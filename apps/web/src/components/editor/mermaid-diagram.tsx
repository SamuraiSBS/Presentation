"use client";

import { useEffect, useId, useState } from "react";
import type { MermaidDiagramSpec } from "@studydeck/shared";

type MermaidDiagramProps = {
  diagram: MermaidDiagramSpec;
};

export function MermaidDiagram({ diagram }: MermaidDiagramProps) {
  const reactId = useId();
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(diagram.safety !== "safe");

  useEffect(() => {
    let cancelled = false;

    async function render() {
      if (diagram.safety !== "safe") {
        setFailed(true);
        return;
      }

      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            fontFamily: "Nunito, Arial, sans-serif",
            primaryColor: "#FFF7EC",
            primaryTextColor: "#2C2116",
            primaryBorderColor: "#E3C5A2",
            lineColor: "#B96800",
            secondaryColor: "#FFFFFF",
            tertiaryColor: "#FFE4BD",
          },
        });
        await mermaid.parse(diagram.source);
        const result = await mermaid.render(
          `studydeck-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
          diagram.source,
        );
        if (!cancelled) {
          setSvg(result.svg);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    void render();
    return () => {
      cancelled = true;
    };
  }, [diagram.safety, diagram.source, reactId]);

  if (failed || !svg) {
    return (
      <div className="mermaid-fallback">
        {diagram.title ? <strong>{diagram.title}</strong> : null}
        <p>{diagram.fallback || diagram.caption}</p>
      </div>
    );
  }

  return (
    <div className="mermaid-diagram">
      <div dangerouslySetInnerHTML={{ __html: svg }} />
      {diagram.caption ? <p>{diagram.caption}</p> : null}
    </div>
  );
}
