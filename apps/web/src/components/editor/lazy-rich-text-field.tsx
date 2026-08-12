"use client";

import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";

type RichTextFieldProps = {
  value: string;
  onSave: (value: string) => void;
  placeholder?: string;
  className?: string;
  testId?: string;
  multiline?: boolean;
  toolbar?: boolean;
};

type RichTextFieldImplementation = ComponentType<RichTextFieldProps>;

/**
 * TipTap is only needed after the user opens a text-property control. Keeping
 * it behind this boundary keeps the editor shell responsive while that chunk
 * downloads.
 */
export function LazyRichTextField(props: RichTextFieldProps) {
  const { className = "", multiline = true, onSave, placeholder = "", testId, value } = props;
  const [Implementation, setImplementation] = useState<RichTextFieldImplementation | null>(null);
  const [fallbackValue, setFallbackValue] = useState(value);
  const fallbackValueRef = useRef(value);
  const [handoffValue, setHandoffValue] = useState<string | null>(null);

  useEffect(() => {
    if (Implementation) return;
    fallbackValueRef.current = value;
    setFallbackValue(value);
  }, [Implementation, value]);

  useEffect(() => {
    let mounted = true;
    void import("./rich-text-field").then(({ RichTextField }) => {
      if (!mounted) return;
      setHandoffValue(fallbackValueRef.current);
      setImplementation(() => RichTextField);
    }).catch(() => {
      // A chunk-load failure must leave the native field usable instead of
      // replacing it with an unhandled rejection and a blank editor surface.
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (Implementation) {
    return (
      <Implementation
        {...props}
        value={handoffValue ?? value}
        onSave={(nextValue) => {
          setHandoffValue(null);
          onSave(nextValue);
        }}
      />
    );
  }

  return (
    <div className={`rich-text-field ${className}`.trim()} data-testid={testId}>
      <textarea
        aria-label={placeholder || "Текст слайда"}
        className={`rich-text-content ${multiline ? "rich-text-multiline" : "rich-text-singleline"}`}
        onBlur={() => onSave(fallbackValue)}
        onChange={(event) => {
          fallbackValueRef.current = event.target.value;
          setFallbackValue(event.target.value);
        }}
        placeholder={placeholder}
        rows={multiline ? 3 : 1}
        value={fallbackValue}
      />
    </div>
  );
}
