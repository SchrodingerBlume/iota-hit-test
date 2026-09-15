// 功能区里的「论文」「版式」「页面」三页：原来堆在左栏表单里的设置，照 Word 的设计 / 布局选项卡
// 搬到功能区——档位是下拉框，三态选项是带勾选的菜单按钮（按钮上直接写着 Auto→开 这种当前值），
// 字体方案下拉、本机字体读取开一个对话框。改的还是同一份 settings / pages，模板收到的仍是 auto。
import { useState, type ReactNode } from 'react';
import { Dropdown, Option, Menu, MenuTrigger, MenuPopover, MenuList, MenuItemRadio, MenuButton, Button, Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, DialogTrigger, Tooltip } from '@fluentui/react-components';
import { TextFont20Regular, Dismiss20Regular } from '@fluentui/react-icons';
import { useStore } from '../model/store';
import type { Pages, Settings } from '../model/types';
import { AXES, SWITCHES, SWITCH_GROUPS, resolveSwitch, type SwitchDef } from '../model/options';
import { PAGE_DEFS, resolvePage } from '../model/pages';
import { FontCard } from './FontCard';

/** 一个分组：一排东西，底下一行小字组名（与 Ribbon 里的一样，避免循环引用各留一份） */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rb-group">
      <div className="rb-items">{children}</div>
      <div className="rb-label">{label}</div>
    </div>
  );
}
const Rows = ({ children }: { children: ReactNode }) => <div className="rb-rows">{children}</div>;
const Row = ({ children }: { children: ReactNode }) => <div className="rb-row">{children}</div>;
/** 三行一组（Word 的小按钮就排三行），按列填满 */
function chunkRows<T>(items: T[], rows = 3): T[][] {
  const per = Math.ceil(items.length / rows);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += per) out.push(items.slice(i, i + per));
  return out;
}

const FONTSETS: { value: Settings['fontset']; label: string; hint: string }[] = [
  { value: 'webapp', label: '站内开源字体', hint: 'Noto CJK + FandolKai + TeX Gyre，随站分发，谁打开都一样' },
  { value: 'windows', label: 'Windows 档（本机字体）', hint: '宋体 / 黑体 / 楷体 / Times New Roman，需要读本机字体' },
  { value: 'macos', label: 'macOS 档（本机字体）', hint: '宋体-简 / 苹方 / 楷体-简，需要读本机字体' },
];

/**
 * 三态选项的菜单按钮：按钮上写「名称 · Auto→开」，菜单里 Auto 一项带着原因。
 * 值可能是布尔也可能是字符串，菜单项的 value 统一成字符串再转回去。
 */
function TriMenu<V extends string | boolean>({ label, hint, choices, value, auto, onChange }: { label: string; hint?: string; choices: { value: V; label: string }[]; value: 'auto' | V; auto: { value: V; reason: string }; onChange: (v: 'auto' | V) => void }) {
  const key = (v: 'auto' | V) => (v === 'auto' ? 'auto' : String(v));
  const parse = (k: string): 'auto' | V => (k === 'auto' ? 'auto' : (choices.find((c) => String(c.value) === k)?.value ?? auto.value));
  const eff = value === 'auto' ? auto.value : value;
  const effLabel = choices.find((c) => c.value === eff)?.label ?? String(eff);
  const tone = eff === true ? 'is-on' : eff === false ? 'is-off' : 'is-val';
  return (
    <Menu checkedValues={{ v: [key(value)] }} onCheckedValueChange={(_, d) => onChange(parse(d.checkedItems[0]))} positioning="below-start">
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content={hint ?? label} relationship="description" positioning="below" withArrow>
          <MenuButton appearance="subtle" size="small" className={`rb-tri ${value === 'auto' ? 'is-auto' : ''}`} onMouseDown={(e) => e.preventDefault()}>
            <span className="rb-tri-name">{label}</span>
            <span className={`rb-tri-val ${tone}`}>{value === 'auto' ? 'Auto→' : ''}{effLabel}</span>
          </MenuButton>
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuItemRadio name="v" value="auto">Auto → {choices.find((c) => c.value === auto.value)?.label ?? String(auto.value)} <span className="muted">· {auto.reason}</span></MenuItemRadio>
          {choices.map((c) => <MenuItemRadio key={String(c.value)} name="v" value={String(c.value)}>{c.label}</MenuItemRadio>)}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

/** 「论文」页：档位与字体 */
export function ThesisTab() {
  const settings = useStore((s) => s.doc.settings);
  const setSettings = useStore((s) => s.setSettings);
  const [fontsOpen, setFontsOpen] = useState(false);
  const axes = AXES.filter((a) => !a.applies || a.applies(settings));
  const degreeType = SWITCHES.find((d) => d.key === 'degreeType')!;
  const fontset = settings.fontset ?? 'webapp';
  return (
    <>
      <Group label="档位">
        <Rows>
          <Row>
            {axes.slice(0, 3).map((a) => <AxisDropdown key={a.key} axis={a} settings={settings} onChange={(v) => setSettings({ [a.key]: v } as Partial<Settings>)} />)}
          </Row>
          <Row>
            {axes.slice(3).map((a) => <AxisDropdown key={a.key} axis={a} settings={settings} onChange={(v) => setSettings({ [a.key]: v } as Partial<Settings>)} />)}
            {(!degreeType.applies || degreeType.applies(settings)) && <SwitchMenu def={degreeType} settings={settings} onChange={(v) => setSettings({ degreeType: v } as Partial<Settings>)} />}
          </Row>
        </Rows>
      </Group>
      <Group label="字体">
        <Rows>
          <Row>
            <Dropdown size="small" className="rb-dd rb-dd-wide" value={FONTSETS.find((f) => f.value === fontset)?.label} selectedOptions={[fontset]} onOptionSelect={(_, d) => d.optionValue && setSettings({ fontset: d.optionValue as Settings['fontset'] })}>
              {FONTSETS.map((f) => <Option key={f.value} value={f.value} text={f.label}><span>{f.label}<br /><small className="muted">{f.hint}</small></span></Option>)}
            </Dropdown>
          </Row>
          <Row>
            <Dialog open={fontsOpen} onOpenChange={(_, d) => setFontsOpen(d.open)}>
              <DialogTrigger disableButtonEnhancement>
                <Button size="small" appearance="subtle" icon={<TextFont20Regular />} onMouseDown={(e) => e.preventDefault()}>本机字体…</Button>
              </DialogTrigger>
              <DialogSurface className="rb-dialog">
                <DialogBody>
                  <DialogTitle action={<DialogTrigger action="close"><Button appearance="subtle" icon={<Dismiss20Regular />} /></DialogTrigger>}>字体方案与本机字体</DialogTitle>
                  <DialogContent><FontCard /></DialogContent>
                  <DialogActions><DialogTrigger disableButtonEnhancement><Button appearance="primary">好</Button></DialogTrigger></DialogActions>
                </DialogBody>
              </DialogSurface>
            </Dialog>
          </Row>
        </Rows>
      </Group>
    </>
  );
}

function AxisDropdown({ axis, settings, onChange }: { axis: (typeof AXES)[number]; settings: Settings; onChange: (v: string) => void }) {
  const cur = settings[axis.key] as string;
  return (
    <Tooltip content={axis.hint} relationship="description" positioning="below" withArrow>
      <span className="rb-axis">
        <span className="rb-axis-name">{axis.label}</span>
        <Dropdown size="small" className="rb-dd" value={axis.choices.find((c) => c.value === cur)?.label ?? cur} selectedOptions={[cur]} onOptionSelect={(_, d) => d.optionValue && onChange(d.optionValue)}>
          {axis.choices.map((c) => <Option key={c.value} value={c.value} text={c.label}>{c.label}</Option>)}
        </Dropdown>
      </span>
    </Tooltip>
  );
}

function SwitchMenu({ def, settings, onChange }: { def: SwitchDef<any>; settings: Settings; onChange: (v: any) => void }) {
  const r = resolveSwitch<any>(def, settings);
  const raw = settings[def.key] as any;
  return <TriMenu label={def.label} hint={def.hint} choices={def.choices} value={raw === 'auto' ? 'auto' : raw} auto={r.auto} onChange={onChange} />;
}

/** 「版式」页：模板的三态选项，按组 */
export function LayoutTab() {
  const settings = useStore((s) => s.doc.settings);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <>
      {SWITCH_GROUPS.map((g) => {
        const defs = SWITCHES.filter((d) => d.group === g && d.key !== 'degreeType' && (!d.applies || d.applies(settings)));
        if (!defs.length) return null;
        return (
          <Group label={g} key={g}>
            <Rows>
              {chunkRows(defs).map((row, i) => <Row key={i}>{row.map((d) => <SwitchMenu key={d.key} def={d} settings={settings} onChange={(v) => setSettings({ [d.key]: v } as Partial<Settings>)} />)}</Row>)}
            </Rows>
          </Group>
        );
      })}
    </>
  );
}

/** 「页面」页：前置 / 后置每一页排不排 */
export function PagesTab() {
  const doc = useStore((s) => s.doc);
  const setPages = useStore((s) => s.setPages);
  const onOff = [{ value: false, label: '关' }, { value: true, label: '开' }];
  return (
    <>
      {(['前置', '后置'] as const).map((g) => {
        const defs = PAGE_DEFS.filter((d) => d.group === g);
        const item = (d: (typeof PAGE_DEFS)[number]) => {
          const r = resolvePage(doc, d.key);
          return <TriMenu key={d.key} label={d.label} hint={d.hint} choices={onOff} value={r.isAuto ? 'auto' : r.value} auto={r.auto} onChange={(v) => setPages({ [d.key]: v } as Partial<Pages>)} />;
        };
        return (
          <Group label={g} key={g}>
            <Rows>
              {chunkRows(defs).map((row, i) => <Row key={i}>{row.map(item)}</Row>)}
            </Rows>
          </Group>
        );
      })}
    </>
  );
}
