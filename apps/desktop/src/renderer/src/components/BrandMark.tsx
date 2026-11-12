import brandIcon from "../assets/brand-icon.png";

interface BrandMarkProps {
  className?: string;
  size?: number;
}

export function BrandMark({ className = "", size = 18 }: BrandMarkProps) {
  return (
    <span
      className={`brand-mark ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <img src={brandIcon} alt="" draggable={false} />
    </span>
  );
}
