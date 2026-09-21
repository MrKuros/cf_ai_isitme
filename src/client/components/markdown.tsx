import { defaultRehypePlugins, Streamdown } from "streamdown";

// LLM output can be steered by target-controlled evidence: no images (tracking pixels on shared
// reports) and no raw HTML (the default "raw" plugin is left out).
const NO_IMAGES = { img: () => null };
const SAFE_REHYPE = [
  defaultRehypePlugins.sanitize,
  defaultRehypePlugins.harden
];

export default function Markdown({
  children,
  animating
}: {
  children: string;
  animating?: boolean;
}) {
  return (
    <Streamdown
      className="sd-theme"
      controls={false}
      isAnimating={animating}
      components={NO_IMAGES}
      rehypePlugins={SAFE_REHYPE}
    >
      {children}
    </Streamdown>
  );
}
