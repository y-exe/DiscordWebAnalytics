import type { CSSProperties } from "react";

export default function RotatingYamakawa({ size = "160px", className = "" }: { size?: string; className?: string }) {
  return <div className={`rotating-yamakawa ${className}`} style={{ "--rotating-logo-size": size } as CSSProperties} role="img" aria-label="回るやまかわロゴ">
    <div className="rotating-yamakawa-grid" aria-hidden="true"><span className="rotating-yamakawa-char rotating-yamakawa-ya">や</span><span className="rotating-yamakawa-char rotating-yamakawa-ma">ま</span><span className="rotating-yamakawa-char rotating-yamakawa-ka">か</span><span className="rotating-yamakawa-char rotating-yamakawa-wa">わ</span></div>
  </div>;
}
