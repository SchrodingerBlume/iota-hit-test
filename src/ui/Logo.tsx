// 站标：一枚齿轮，中间「HιotaT」——HIT 里嵌着希腊字母 ι 的 iota。衬线体，H / T 深蓝、ιota 橙。
const TEETH = 12;
function gearPath(r = 46, depth = 8, w = 0.55): string {
  const pts: string[] = [];
  const n = TEETH * 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const phase = i % 4;
    const rr = phase === 1 || phase === 2 ? r : r - depth;
    // 齿侧斜一点，不然像锯齿
    const t = phase === 1 ? a - (w * Math.PI) / n : phase === 2 ? a + (w * Math.PI) / n : a;
    pts.push(`${(50 + rr * Math.cos(t)).toFixed(2)},${(50 + rr * Math.sin(t)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}
const GEAR = gearPath();

export function Logo({ size = 28, title = 'iota-hit' }: { size?: number; title?: string }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={title}>
      <path d={GEAR} fill="var(--hit)" />
      <circle cx="50" cy="50" r="33" fill="var(--panel)" />
      <text x="50" y="62" textAnchor="middle" fontFamily='"Times New Roman", "Noto Serif CJK SC", serif' fontSize="36" fontWeight="700">
        <tspan fill="var(--hit)">H</tspan><tspan fill="var(--hit-orange)" fontStyle="italic">ι</tspan><tspan fill="var(--hit)">T</tspan>
      </text>
    </svg>
  );
}
