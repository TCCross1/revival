import { formatFtIn } from "@/lib/floorPlan/units";

export default function WallDetail({ rec }) {
  if (!rec) return null;
  const plies = rec.plies || 1;
  const jacks = rec.jack_studs || 1;
  const kings = rec.king_studs || 1;
  return (
    <div className="rounded-lg border border-[#C45C26]/30 bg-[#FFF8F4] p-2" data-testid="lvl-wall-detail">
      <svg viewBox="0 0 260 118" className="w-full h-28">
        <rect x="8" y="8" width="244" height="102" rx="6" fill="#FBF8F2" stroke="#0A4D68" strokeWidth="1" />
        {Array.from({ length: kings }).map((_, i) => (
          <rect key={`kL${i}`} x={18 + i * 8} y="28" width="7" height="70" fill="#0A4D68" />
        ))}
        {Array.from({ length: jacks }).map((_, i) => (
          <rect key={`jL${i}`} x={18 + kings * 8 + i * 7} y="46" width="6" height="52" fill="#5E7C89" />
        ))}
        {Array.from({ length: plies }).map((_, i) => (
          <rect key={`b${i}`} x="52" y={22 + i * 7} width="156" height="6" fill="none" stroke="#C45C26" strokeWidth="1.6" strokeDasharray="4 2.5" />
        ))}
        {Array.from({ length: kings }).map((_, i) => (
          <rect key={`kR${i}`} x={220 - i * 8} y="28" width="7" height="70" fill="#0A4D68" />
        ))}
        {Array.from({ length: jacks }).map((_, i) => (
          <rect key={`jR${i}`} x={214 - kings * 8 - i * 7} y="46" width="6" height="52" fill="#5E7C89" />
        ))}
        <text x="130" y="18" textAnchor="middle" fontSize="8" fill="#0A4D68" fontFamily="Outfit" fontWeight="600">{rec.label}</text>
        <text x="130" y="108" textAnchor="middle" fontSize="7" fill="#4B6370" fontFamily="Outfit">
          {formatFtIn(rec.span_in)} span · {jacks} jack / {kings} king each end
        </text>
      </svg>
      <p className="text-[10px] text-[#8B2E0E] leading-snug">{rec.disclaimer}</p>
    </div>
  );
}
