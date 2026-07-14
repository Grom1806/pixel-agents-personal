import { type RefObject,useRef } from 'react';

export function PanelMoveHandle({
  targetRef,
  label,
}: {
  targetRef: RefObject<HTMLElement | null>;
  label: string;
}) {
  const start = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const begin = (event: React.PointerEvent<HTMLButtonElement>) => {
    const target = targetRef.current;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    start.current = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: React.PointerEvent<HTMLButtonElement>) => {
    const target = targetRef.current;
    const origin = start.current;
    if (!target || !origin) return;
    target.style.left = `${Math.max(0, origin.left + event.clientX - origin.x)}px`;
    target.style.top = `${Math.max(0, origin.top + event.clientY - origin.y)}px`;
    target.style.right = 'auto';
  };
  const finish = () => {
    start.current = null;
  };
  return (
    <button
      type="button"
      className="panel-move-handle"
      aria-label={label}
      title="Потяните, чтобы переместить окно"
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      ⠿
    </button>
  );
}
