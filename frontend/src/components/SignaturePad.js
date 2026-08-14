import { useRef, useEffect } from "react";
import { Eraser } from "lucide-react";

export default function SignaturePad({ value, onChange, testid }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0A1B22";
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const point = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const start = (e) => {
    e.preventDefault();
    drawing.current = true;
    last.current = point(e);
    try { canvasRef.current.setPointerCapture(e.pointerId); } catch {}
  };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvasRef.current.toDataURL("image/png"));
  };
  const clear = () => {
    const c = canvasRef.current;
    c.getContext("2d").clearRect(0, 0, c.width, c.height);
    onChange("");
  };

  return (
    <div>
      <div className="relative rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 overflow-hidden">
        <canvas
          ref={canvasRef}
          data-testid={testid}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          className="w-full h-40 rounded-lg"
          style={{ touchAction: "none" }}
        />
        {!value && (
          <span className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-slate-400">
            Sign here with your finger, stylus, or mouse
          </span>
        )}
      </div>
      <button type="button" onClick={clear} data-testid={`${testid}-clear`} className="mt-2 inline-flex items-center gap-1 text-xs text-[#4B6370] hover:text-red-500">
        <Eraser size={13} /> Clear signature
      </button>
    </div>
  );
}
