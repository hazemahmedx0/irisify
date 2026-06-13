import {
  createElement,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import type { IrisifyInstance, IrisifyOptions } from "../types";
import { createController, type Controller } from "../dom/controller";
import { irisify } from "../dom/attach";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Collect every option key explicitly so updates REPLACE stale values
 *  (a key the caller stops passing falls back to its default). */
function pickOptions(p: IrisifyOptions): IrisifyOptions {
  return {
    preset: p.preset,
    colors: p.colors,
    speed: p.speed,
    glow: p.glow,
    intensity: p.intensity,
    border: p.border,
    placement: p.placement,
    direction: p.direction,
    gap: p.gap,
    paused: p.paused,
    dismissed: p.dismissed,
    radius: p.radius,
    zIndex: p.zIndex,
    reducedMotion: p.reducedMotion,
    enabled: p.enabled,
    advanced: p.advanced,
  };
}

const OPTION_KEYS = [
  "preset", "colors", "speed", "glow", "intensity", "border", "placement",
  "direction", "gap", "paused", "dismissed", "radius", "zIndex",
  "reducedMotion", "enabled", "advanced",
] as const;

export interface IrisifyProps
  extends IrisifyOptions,
    Omit<HTMLAttributes<HTMLElement>, "color"> {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Wrapper tag. Default `"div"`. */
  as?: ElementType;
  /** Ref to the wrapper element. */
  wrapperRef?: Ref<HTMLElement>;
}

const overlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
};

// The outer halo must paint BEHIND the wrapped element but ABOVE whatever is
// behind the wrapper. z-index −1 + `isolation: isolate` on the wrapper keeps
// the halo inside the wrapper's own stacking context - without the isolation,
// a negative-z layer escapes upwards and any ancestor with a background (e.g.
// a dark section) paints OVER it, killing the outer glow.
const underStyle: CSSProperties = { ...overlayStyle, zIndex: -1 };

/**
 * Wrap any element to give it the iridescent border glow:
 *
 * ```tsx
 * <Irisify preset="flash">
 *   <div className="card">…</div>
 * </Irisify>
 * ```
 *
 * The wrapper is `position: relative` and should hug the child (the glow traces
 * the WRAPPER's box; corner radius is read from the child automatically). The
 * outer halo is rendered before the child so an opaque child background covers
 * its interior - exactly the original's layer order.
 */
export function Irisify({ children, className, style, as, wrapperRef, ...rest }: IrisifyProps) {
  const Tag = (as ?? "div") as ElementType;
  // split irisify options from pass-through DOM props (onClick, id, data-*…)
  const options = rest as IrisifyOptions;
  const domProps: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (!(OPTION_KEYS as readonly string[]).includes(k)) domProps[k] = v;
  }
  const rootRef = useRef<HTMLDivElement | null>(null);
  const underRef = useRef<HTMLDivElement | null>(null);
  const overRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<Controller | null>(null);
  const optionsRef = useRef<IrisifyOptions>(pickOptions(options));
  optionsRef.current = pickOptions(options);

  useIsoLayoutEffect(() => {
    const root = rootRef.current;
    const under = underRef.current;
    const over = overRef.current;
    if (!root || !under || !over) return;
    const controller = createController({
      under,
      over,
      measureEl: root,
      // corner radius comes from the wrapped child (the first element that
      // isn't one of our overlays)
      radiusEl: () =>
        Array.from(root.children).find((c) => c !== under && c !== over) ?? root,
      options: optionsRef.current,
    });
    controllerRef.current = controller;
    return () => {
      controllerRef.current = null;
      controller.destroy();
    };
  }, []);

  // Push prop changes into the controller (cheap deep-compare via JSON - the
  // options object is small, plain data).
  const serialized = JSON.stringify(optionsRef.current);
  useEffect(() => {
    controllerRef.current?.setOptions(optionsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized]);

  const setRoot = (node: HTMLDivElement | null) => {
    rootRef.current = node;
    if (typeof wrapperRef === "function") wrapperRef(node);
    else if (wrapperRef && "current" in (wrapperRef as object))
      (wrapperRef as { current: HTMLElement | null }).current = node;
  };

  return createElement(
    Tag,
    {
      ...domProps,
      ref: setRoot,
      className,
      style: { position: "relative", isolation: "isolate", ...style },
    },
    createElement("div", { ref: underRef, "aria-hidden": true, style: underStyle }),
    children,
    createElement("div", { ref: overRef, "aria-hidden": true, style: overlayStyle }),
  );
}

/**
 * Hook form - attach the glow to YOUR element (no wrapper):
 *
 * ```tsx
 * const ref = useIrisify<HTMLDivElement>({ preset: "beam" });
 * return <div ref={ref} className="card">…</div>;
 * ```
 */
export function useIrisify<T extends HTMLElement>(options: IrisifyOptions = {}) {
  const ref = useRef<T | null>(null);
  const instRef = useRef<IrisifyInstance | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!ref.current) return;
    const inst = irisify(ref.current, optionsRef.current);
    instRef.current = inst;
    return () => {
      instRef.current = null;
      inst.destroy();
    };
  }, []);

  const serialized = JSON.stringify(options);
  useEffect(() => {
    instRef.current?.setOptions(optionsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized]);

  return ref;
}

export type { IrisifyInstance, IrisifyOptions };
