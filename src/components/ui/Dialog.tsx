import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

interface DialogProps {
  open: boolean;
  title: React.ReactNode;
  children: React.ReactNode;
  onOpenChange: (open: boolean) => void;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  closeLabel: string;
  dismissible?: boolean;
  closeOnBackdrop?: boolean;
  showCloseButton?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement>;
  className?: string;
  contentClassName?: string;
  contentFades?: boolean;
}

const isVisible = (element: HTMLElement) => {
  const style = window.getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none";
};

const getFocusableElements = (container: HTMLElement) =>
  Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true" &&
      isVisible(element),
  );

export const Dialog: React.FC<DialogProps> = ({
  open,
  title,
  children,
  onOpenChange,
  description,
  footer,
  closeLabel,
  dismissible = true,
  closeOnBackdrop = true,
  showCloseButton = true,
  initialFocusRef,
  className = "",
  contentClassName = "",
  contentFades = true,
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusDialog = () => {
      const fallback = contentRef.current;
      const target = initialFocusRef?.current ?? fallback;
      target?.focus();
    };

    const animationFrame = requestAnimationFrame(focusDialog);

    return () => {
      cancelAnimationFrame(animationFrame);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [initialFocusRef, open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) {
        event.preventDefault();
        onOpenChange(false);
        return;
      }

      if (event.key !== "Tab" || !contentRef.current) return;

      const focusableElements = getFocusableElements(contentRef.current);
      if (focusableElements.length === 0) {
        event.preventDefault();
        contentRef.current.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (activeElement === contentRef.current) {
        event.preventDefault();
        if (event.shiftKey) {
          lastElement.focus();
        } else {
          firstElement.focus();
        }
      } else if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [dismissible, onOpenChange, open]);

  if (!open) return null;

  const handleBackdropMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (
      dismissible &&
      closeOnBackdrop &&
      event.target === event.currentTarget
    ) {
      onOpenChange(false);
    }
  };
  const contentStyle: React.CSSProperties | undefined = contentFades
    ? {
        maskImage:
          "linear-gradient(to bottom, transparent 0, black 10px, black calc(100% - 20px), transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent 0, black 10px, black calc(100% - 20px), transparent 100%)",
      }
    : undefined;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-6"
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`steel-panel flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden outline-none sm:max-h-[calc(100dvh-3rem)] ${className}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--hairline)] px-[18px] py-3.5">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-[15px] font-normal tracking-[-0.01em] text-text"
            >
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-[12px] text-mid-gray">
                {description}
              </p>
            )}
          </div>
          {dismissible && showCloseButton && (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label={closeLabel}
              className="steel-chip shrink-0 cursor-pointer p-1 text-mid-gray transition-colors hover:text-text hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
        <div
          className={`min-h-0 overflow-y-auto px-[18px] pb-4 pt-3.5 ${contentClassName}`}
          style={contentStyle}
        >
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--hairline)] px-[18px] py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};
