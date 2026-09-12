export default function TakeoffStat({ label, value }) {
  return (
    <div className="rounded-lg bg-[#F4F7F8] px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[#8AA0AB]">{label}</div>
      <div className="font-['Outfit'] font-semibold text-[#0B3A8F]">{Number(value || 0).toFixed(1)}</div>
    </div>
  );
}
