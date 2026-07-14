import { type RefObject,useRef } from 'react';

interface CornerResizeHandleProps {
  targetRef: RefObject<HTMLElement | null>;
  anchoredTo: 'left' | 'right';
  label: string;
}

export function CornerResizeHandle({ targetRef, anchoredTo, label }: CornerResizeHandleProps) {
  const start = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
    left: number;
  } | null>(null);

  const resize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const target = targetRef.current;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    start.current = {
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
      left: rect.left,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const move = (event: React.PointerEvent<HTMLButtonElement>) => {
    const target = targetRef.current;
    const origin = start.current;
    if (!target || !origin) return;
    const horizontal = event.clientX - origin.x;
    const styles = window.getComputedStyle(target);
    const minWidth = Number.parseFloat(styles.minWidth) || 240;
    const minHeight = Number.parseFloat(styles.minHeight) || 185;
    const width = Math.min(
      window.innerWidth - 24,
      Math.max(minWidth, origin.width + (anchoredTo === 'right' ? -horizontal : horizontal)),
    );
    const height = Math.min(
      window.innerHeight - 24,
      Math.max(minHeight, origin.height + event.clientY - origin.y),
    );
    target.style.width = `${width}px`;
    target.style.height = `${height}px`;
    if (anchoredTo === 'left') target.style.left = `${Math.max(0, origin.left + horizontal)}px`;
  };

  const finish = () => {
    start.current = null;
  };

  return (
    <button
      className="panel-resize-handle"
      type="button"
      aria-label={label}
      title="Потяните, чтобы изменить размер"
      onPointerDown={resize}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      ◣
    </button>
  );
}
