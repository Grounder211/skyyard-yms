import React, { useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";

interface Props {
  onDetect: (text: string) => void;
  onClose: () => void;
}

export default function QRScanner({ onDetect, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;

    const start = async () => {
      if (!("BarcodeDetector" in window)) {
        setSupported(false);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        // @ts-ignore — BarcodeDetector is not yet in the standard TS lib
        const detector = new window.BarcodeDetector({ formats: ["qr_code"] });

        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0) {
              onDetect(codes[0].rawValue);
              return;
            }
          } catch {
            // detector hiccup — keep trying
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setError("Camera access denied or unavailable.");
      }
    };
    start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl overflow-hidden max-w-sm w-full shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <span className="font-bold text-slate-900 flex items-center gap-2">
            <Camera size={16} /> Scan QR code
          </span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900">
            <X size={18} />
          </button>
        </div>
        {supported ? (
          <div className="relative aspect-square bg-black">
            <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
            <div className="absolute inset-8 border-2 border-white/70 rounded-2xl pointer-events-none" />
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-slate-500">
            Camera scanning isn't supported in this browser. Enter the code manually instead.
          </div>
        )}
        {error && <p className="p-4 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
