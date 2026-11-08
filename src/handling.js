export const HANDLING_PROFILES = Object.freeze({
  steady: Object.freeze({
    id: "steady",
    label: "稳健",
    angle: 0.34,
    response: 0.85,
  }),
  balanced: Object.freeze({
    id: "balanced",
    label: "均衡",
    angle: 0.46,
    response: 1,
  }),
  wide: Object.freeze({
    id: "wide",
    label: "大角度",
    angle: 0.56,
    response: 1.1,
  }),
});
export const HANDLING_IDS = Object.freeze(Object.keys(HANDLING_PROFILES));
export function handlingProfile(id) {
  return HANDLING_IDS.includes(id)
    ? HANDLING_PROFILES[id]
    : HANDLING_PROFILES.balanced;
}
