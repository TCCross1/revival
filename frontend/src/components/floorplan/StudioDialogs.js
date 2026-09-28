import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import ClientReportPreview from "@/components/floorplan/ClientReportPreview";
import PermitDetailsPreview from "@/components/floorplan/PermitDetailsPreview";
import { parseFtIn } from "@/lib/floorPlan/units";
import { resizeRoom } from "@/lib/floorPlan/model";
import { hasNativeRoomPlan, isIPhone, requestNativeScan } from "@/lib/floorPlan/roomplan";
import { toast } from "sonner";
import { ScanLine, Upload } from "lucide-react";

export default function StudioDialogs({
  roomDialog,
  setRoomDialog,
  lidarOpen,
  setLidarOpen,
  lidarText,
  setLidarText,
  applyLidar,
  applyScanPayload,
  loadSampleScan,
  patchLevel,
  reportOpen,
  setReportOpen,
  meta,
  scope,
  takeoffs,
  pdfUrl,
  generateReport,
  estimates,
  contracts,
  reportAttach,
  setReportAttach,
  permitOpen,
  permitPreview,
  permitSheets,
  setPermitSheets,
  permitPdfUrl,
  generatePermit,
  setPermitOpen,
}) {
  return (
    <>
      <Dialog open={Boolean(roomDialog)} onOpenChange={() => setRoomDialog(null)}>
        <DialogContent className="bg-white max-w-sm">
          <DialogHeader><DialogTitle className="font-['Outfit']">Room size</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Width</Label><Input value={roomDialog?.w || ""} onChange={(e) => setRoomDialog({ ...roomDialog, w: e.target.value })} /></div>
            <div><Label>Depth</Label><Input value={roomDialog?.d || ""} onChange={(e) => setRoomDialog({ ...roomDialog, d: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button type="button" className="bg-[#0B3A8F] hover:bg-[#082C73]" onClick={() => {
              try {
                const width = parseFtIn(roomDialog.w);
                const depth = parseFtIn(roomDialog.d);
                if (width < 36 || depth < 36) {
                  toast.error("Enter a room at least 3' × 3'.");
                  return;
                }
                patchLevel((lvl) => resizeRoom(lvl, roomDialog.id, width, depth));
                setRoomDialog(null);
              } catch (err) {
                console.error("[RoomSize] could not resize the room", err);
                toast.error("Could not resize that room. Please try again.");
              }
            }}>Set size</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lidarOpen} onOpenChange={setLidarOpen}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader><DialogTitle className="font-['Outfit']">Scan kitchen</DialogTitle></DialogHeader>
          <p className="text-sm text-[#4B6370]">
            {hasNativeRoomPlan()
              ? "Walk the kitchen with this iPhone. RoomPlan captures walls, openings, the island, sink, and appliances, then drops a rough layout on this plan. Measurements are approximate — verify them before you order."
              : isIPhone()
                ? "LiDAR scanning uses Apple RoomPlan in Revival Pro’s iPhone app. You can still import a RoomPlan JSON export here. After the scan, this plan stays in sync with Mac."
                : "On an iPhone 16 Pro, Scan Kitchen runs Apple RoomPlan inside the Revival iPhone app. Here you can import that scan JSON, or load a sample kitchen to practice cleanup. Edits sync to the phone automatically."}
          </p>
          {hasNativeRoomPlan() ? (
            <Button
              type="button"
              className="bg-[#0B3A8F] hover:bg-[#082C73] gap-1"
              data-testid="start-roomplan-scan"
              onClick={() => {
                requestNativeScan();
                toast.message("Starting RoomPlan… walk the kitchen slowly.");
              }}
            >
              <ScanLine size={14} /> Start LiDAR scan
            </Button>
          ) : null}
          <label className="text-xs font-medium text-[#0B3A8F]">
            Import scan file
            <input
              type="file"
              accept="application/json,.json"
              className="mt-1 block w-full text-xs"
              data-testid="lidar-file"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  const text = await file.text();
                  setLidarText(text);
                  const parsed = JSON.parse(text);
                  if (applyScanPayload) applyScanPayload(parsed);
                  else applyLidar();
                } catch (err) {
                  toast.error(err.message || "Could not read that scan file.");
                }
              }}
            />
          </label>
          <textarea className="w-full h-28 rounded-md border border-slate-200 p-2 text-xs font-mono" placeholder="Paste RoomPlan JSON" value={lidarText} onChange={(e) => setLidarText(e.target.value)} data-testid="lidar-json" />
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button type="button" variant="outline" onClick={() => { loadSampleScan?.(); toast.message("Sample kitchen loaded — Place scan to drop it."); }}>Load sample kitchen</Button>
            <Button type="button" variant="outline" onClick={() => setLidarOpen(false)}>Close</Button>
            <Button type="button" className="bg-[#0B3A8F] hover:bg-[#082C73] gap-1" onClick={applyLidar}><Upload size={14} /> Place scan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {reportOpen ? (
        <ClientReportPreview
          meta={meta}
          scope={scope}
          takeoffs={takeoffs}
          pdfUrl={pdfUrl}
          busy={Boolean(generateReport?.isPending)}
          estimates={estimates}
          contracts={contracts}
          attach={reportAttach}
          onAttachChange={setReportAttach}
          onClose={() => setReportOpen(false)}
          onGenerate={() => generateReport.mutate()}
        />
      ) : null}
      {permitOpen ? (
        <PermitDetailsPreview
          preview={permitPreview}
          sheets={permitSheets}
          onSheetsChange={setPermitSheets}
          pdfUrl={permitPdfUrl}
          busy={Boolean(generatePermit?.isPending)}
          onClose={() => setPermitOpen(false)}
          onGenerate={() => generatePermit.mutate()}
        />
      ) : null}
    </>
  );
}
