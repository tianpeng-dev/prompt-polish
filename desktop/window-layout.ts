import { constrainWindowPosition, type Rectangle } from "./logic.js";

export const EDITOR_SIZE = { width: 460, height: 176 };
export const VIEW_HEIGHTS = {
  editor: 176,
  methods: 320,
  settings: 280,
  details: 340,
} as const;
export type WindowView = keyof typeof VIEW_HEIGHTS;
export type WindowLayout = {
  view: WindowView;
  side: "above" | "below";
  height: number;
};

export function validateWindowView(value: unknown): WindowView {
  if (typeof value !== "string" || !Object.hasOwn(VIEW_HEIGHTS, value))
    throw new TypeError("窗口视图无效。");
  return value as WindowView;
}

export function calculateViewBounds(
  anchor: { x: number; y: number },
  workArea: Rectangle,
  view: WindowView,
): WindowLayout & Rectangle {
  const height = Math.min(
    VIEW_HEIGHTS[view],
    Math.max(176, workArea.height - 16),
  );
  const belowSpace = workArea.y + workArea.height - 8 - anchor.y;
  const aboveSpace = anchor.y + EDITOR_SIZE.height - workArea.y - 8;
  const side =
    belowSpace < height && aboveSpace > belowSpace ? "above" : "below";
  const bounds = {
    x: anchor.x,
    y: side === "above" ? anchor.y + EDITOR_SIZE.height - height : anchor.y,
    width: EDITOR_SIZE.width,
    height,
  };
  const position = constrainWindowPosition(bounds, workArea, 0);
  return { ...bounds, ...position, view, side, height };
}

export function compactAnchor(
  bounds: Rectangle,
  side: WindowLayout["side"],
): { x: number; y: number } {
  return {
    x: bounds.x,
    y:
      side === "above"
        ? bounds.y + bounds.height - EDITOR_SIZE.height
        : bounds.y,
  };
}
