import { Button } from './ui/Button.js';

interface MigrationNoticeProps {
  onDismiss: () => void;
}

export function MigrationNotice({ onDismiss }: MigrationNoticeProps) {
  return (
    <div
      className="absolute inset-0 bg-black/70 flex items-center justify-center z-100"
      onClick={onDismiss}
    >
      <div
        className="pixel-panel py-24 px-32 max-w-xl text-center leading-[1.3]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-5xl mb-12 text-accent">Нам нужно извиниться!</div>
        <p className="text-xl m-0 mb-12">
          Мы перешли на полностью открытые ассеты, созданные с нуля. К сожалению, из-за этого
          пришлось сбросить прежнюю планировку.
        </p>
        <p className="text-xl m-0 mb-12">Приносим извинения за неудобство.</p>
        <p className="text-xl m-0 mb-12">
          Хорошая новость: это было разовое изменение, которое открывает путь к следующим
          обновлениям.
        </p>
        <p className="text-xl m-0 mb-20">Спасибо, что пользуетесь Pixel Agents.</p>
        <Button variant="accent" size="xl" onClick={onDismiss}>
          Понятно
        </Button>
      </div>
    </div>
  );
}
