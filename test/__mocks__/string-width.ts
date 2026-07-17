export default function stringWidth(str: string): number {
  // Simple fallback for tests that strips ANSI and returns length
  return str.replace(/\x1B\[[0-9;]*m/g, "").length;
}
module.exports = stringWidth;
