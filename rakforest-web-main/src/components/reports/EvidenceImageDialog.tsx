"use client";

import { useEffect, useId, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { X } from "lucide-react";
import { useLanguage } from "@/lib/i18n/language";

const zoomLevels = [1, 1.5, 2, 3];

type Offset = { x: number; y: number };

export function EvidenceImageDialog({ src, name, onClose }: {
  src: string;
  name: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const frameRef = useRef<HTMLButtonElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const offset = useRef<Offset>({ x: 0, y: 0 });
  const drag = useRef<{ id: number; start: Offset; offset: Offset; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [level, setLevel] = useState(0);
  const scale = zoomLevels[level];

  function moveImage(next: Offset, nextScale: number) {
    const image = imageRef.current;
    const frame = frameRef.current;
    if (!image?.naturalWidth || !frame) return;
    const { clientWidth: width, clientHeight: height } = frame;
    const fit = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const limitX = Math.max(0, (image.naturalWidth * fit * nextScale - width) / 2);
    const limitY = Math.max(0, (image.naturalHeight * fit * nextScale - height) / 2);
    const x = Math.max(-limitX, Math.min(limitX, next.x));
    const y = Math.max(-limitY, Math.min(limitY, next.y));
    offset.current = { x, y };
    image.style.transform = nextScale === 1 ? "" : `translate(${x}px, ${y}px) scale(${nextScale})`;
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(() => moveImage(offset.current, scale));
    observer.observe(frame);
    return () => observer.disconnect();
  }, [scale]);

  function setZoom(nextLevel: number, point: Offset = { x: 0, y: 0 }) {
    if (!imageRef.current?.naturalWidth) return;
    const nextScale = zoomLevels[nextLevel];
    const ratio = nextScale / scale;
    moveImage({
      x: point.x - (point.x - offset.current.x) * ratio,
      y: point.y - (point.y - offset.current.y) * ratio,
    }, nextScale);
    setLevel(nextLevel);
  }

  function zoomAt(event: MouseEvent<HTMLButtonElement>) {
    if (event.detail !== 0 && suppressClick.current) return;
    if (level !== 0 || event.detail === 0) {
      setZoom(level === 0 ? 1 : 0);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setZoom(1, {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    });
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick.current = false;
    if (level === 0) return;
    drag.current = {
      id: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      offset: offset.current,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function dragImage(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.start.x;
    const dy = event.clientY - current.start.y;
    if (!current.moved && Math.hypot(dx, dy) < 5) return;
    current.moved = true;
    suppressClick.current = true;
    moveImage({ x: current.offset.x + dx, y: current.offset.y + dy }, scale);
  }

  function finishDrag(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.id === event.pointerId) drag.current = null;
  }

  return (
    <dialog
      ref={dialogRef}
      data-evidence-viewer
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="fixed inset-0 m-auto w-[calc(100%-1.5rem)] max-w-none overflow-hidden overscroll-contain rounded-xl bg-white p-0 text-[#14241B] shadow-xl backdrop:bg-black/60 md:w-[70vw]"
    >
      <header className="flex items-center gap-3 border-b border-[#D4DCD5] px-4 py-1">
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold" title={name}>{name}</h2>
        <button type="button" autoFocus onClick={onClose} aria-label={t("ปิดภาพ")}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-[#F2F4F1] hover:bg-[#E4ECE6] focus-visible:outline-2 focus-visible:outline-[#1B4332]">
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="relative">
        <button
          ref={frameRef}
          type="button"
          aria-label={t("ซูมภาพหลักฐาน")}
          aria-pressed={level !== 0}
          onClick={zoomAt}
          onPointerDown={startDrag}
          onPointerMove={dragImage}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onLostPointerCapture={finishDrag}
          className={`block h-[max(8rem,calc(70dvh-3.3125rem))] w-full touch-none overflow-hidden bg-[#14241B] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#1B4332] ${level === 0 ? "cursor-zoom-in" : "cursor-grab active:cursor-grabbing"}`}
        >
          <img
            ref={imageRef}
            src={src}
            alt={name}
            decoding="async"
            draggable={false}
            className="block size-full select-none object-contain"
          />
        </button>
        <select
          aria-label={t("ระดับซูมภาพ")}
          value={level}
          onChange={(event) => setZoom(Number(event.target.value))}
          className="absolute right-3 top-3 min-h-11 rounded-lg border border-white/25 bg-[#14241B] px-3 text-sm font-semibold text-white tabular-nums shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          {zoomLevels.map((factor, index) => (
            <option key={factor} value={index}>{Math.round(factor * 100)}%</option>
          ))}
        </select>
      </div>
    </dialog>
  );
}
