// The "more" menu at the end of a row: the actions a row needs now and then,
// so the row itself shows only its one main action.
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

export interface MenuAction {
  label: string;
  /** Opens this address in a new tab instead of running onSelect. */
  href?: string;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function ActionMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={label}
        title={label}
        className="grid size-9 shrink-0 place-items-center rounded-lg text-muted transition-colors outline-none hover:bg-surface-2 hover:text-text focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-2 data-[state=open]:text-text"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="menu-pop z-50 min-w-44 rounded-xl border border-border bg-surface p-1 shadow-lg"
        >
          {actions.map((a) => {
            const cls = `block cursor-pointer rounded-lg px-3 py-2 text-sm outline-none data-[disabled]:cursor-default data-[disabled]:text-muted data-[highlighted]:bg-surface-2 ${
              a.danger ? 'text-critical' : ''
            }`;
            return a.href ? (
              <DropdownMenu.Item key={a.label} asChild disabled={a.disabled}>
                <a href={a.href} target="_blank" rel="noreferrer noopener" className={cls}>
                  {a.label}
                </a>
              </DropdownMenu.Item>
            ) : (
              <DropdownMenu.Item key={a.label} disabled={a.disabled} onSelect={a.onSelect} className={cls}>
                {a.label}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
