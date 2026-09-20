import { Menu, MenuTrigger, MenuPopover, MenuList, MenuItemRadio, MenuButton, Tooltip } from '@fluentui/react-components';

export function ChoiceMenu<V extends string>({ label, hint, choices, value, onChange, disabled }: { label: string; hint?: string; choices: { value: V; label: string; hint?: string }[]; value: V; onChange: (v: V) => void; disabled?: boolean }) {
  const cur = choices.find((c) => c.value === value)?.label ?? value;
  return (
    <Menu checkedValues={{ v: [value] }} onCheckedValueChange={(_, d) => onChange(d.checkedItems[0] as V)} positioning="below-start">
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content={hint ?? label} relationship="description" positioning="below" withArrow>
          <MenuButton appearance="subtle" size="small" className="rb-tri" menuIcon={null} disabled={disabled} onMouseDown={(e) => e.preventDefault()}>
            <span className="rb-tri-name">{label}</span>
            <span className="rb-tri-val is-val">{cur}</span>
          </MenuButton>
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {choices.map((c) => <MenuItemRadio key={c.value} name="v" value={c.value}>{c.label}{c.hint && <span className="muted"> · {c.hint}</span>}</MenuItemRadio>)}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
