import type { IrisifyInstance, IrisifyOptions } from "../types";
import { createController, mergeOptions } from "./controller";

const noop = () => {};
const parentIsolation = new WeakMap<HTMLElement, { previous: string; count: number }>();

function retainParentIsolation(parent: HTMLElement): () => void {
  const current = parentIsolation.get(parent);
  if (current) {
    current.count += 1;
    return () => releaseParentIsolation(parent);
  }

  parentIsolation.set(parent, { previous: parent.style.isolation, count: 1 });
  parent.style.isolation = "isolate";
  return () => releaseParentIsolation(parent);
}

function releaseParentIsolation(parent: HTMLElement) {
  const current = parentIsolation.get(parent);
  if (!current) return;
  current.count -= 1;
  if (current.count > 0) return;
  parentIsolation.delete(parent);
  parent.style.isolation = current.previous;
}

/**
 * Attach the iridescent glow to any element.
 *
 * Two overlay layers are inserted as SIBLINGS of the element, sandwiching it:
 * the outer halo goes BEFORE it (so it paints behind the element - an opaque
 * background then covers the halo's interior, exactly like the original), and
 * the border ring + inner glow go AFTER it (painting on top). Both are
 * `aria-hidden` and `pointer-events: none` - pure decoration.
 *
 * Notes:
 * - the element's ancestors must not clip (`overflow: hidden`) if you want the
 *   outer halo to bloom past the element.
 * - the overlays track the element's size automatically (ResizeObserver). If
 *   you move the element some other way, call `instance.refresh()`.
 */
export function irisify(element: HTMLElement, options: IrisifyOptions = {}): IrisifyInstance {
  if (typeof window === "undefined" || !element?.parentElement) {
    // SSR / detached element: return an inert instance instead of throwing.
    return {
      element,
      update: noop,
      setOptions: noop,
      pause: noop,
      play: noop,
      dismiss: noop,
      show: noop,
      refresh: noop,
      destroy: noop,
    };
  }
  const doc = element.ownerDocument;
  const make = (name: string) => {
    const d = doc.createElement("div");
    d.className = name;
    d.style.position = "absolute";
    return d;
  };
  const under = make("irisify-under");
  const over = make("irisify-over");
  // Halo behind the element, above whatever is behind the parent. The parent is
  // isolated so the negative-z halo stays inside its stacking context - without
  // it, any ancestor background (a dark section, a card) paints over the halo.
  under.style.zIndex = "-1";
  const parent = element.parentElement;
  const releaseIsolation = retainParentIsolation(parent);
  parent.insertBefore(under, element);
  parent.insertBefore(over, element.nextSibling);

  // Match each overlay to the element's box. Overlays are siblings, so they
  // share the element's offsetParent and its offsetLeft/Top coordinates apply.
  const syncBox = () => {
    const x = element.offsetLeft;
    const y = element.offsetTop;
    const w = element.offsetWidth;
    const h = element.offsetHeight;
    for (const c of [under, over]) {
      c.style.left = `${x}px`;
      c.style.top = `${y}px`;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
  };

  const controller = createController({
    under,
    over,
    measureEl: element,
    radiusEl: () => element,
    syncBox,
    options,
  });

  return {
    element,
    update: (next) => controller.update(next),
    setOptions: (next) => controller.setOptions(next),
    pause: () => controller.update({ paused: true }),
    play: () => controller.update({ paused: false }),
    dismiss: () => controller.update({ dismissed: true }),
    show: () => controller.update({ dismissed: false }),
    refresh: () => controller.refresh(),
    destroy: () => {
      controller.destroy();
      under.remove();
      over.remove();
      releaseIsolation();
    },
  };
}

export { createController, mergeOptions };
