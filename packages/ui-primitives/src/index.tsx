import React, { type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import {
  Button as AriaButton,
  Checkbox as AriaCheckbox,
  Dialog as AriaDialog,
  DialogTrigger,
  Disclosure as AriaDisclosure,
  DisclosurePanel,
  Heading as AriaHeading,
  Input,
  Label,
  Modal,
  ModalOverlay,
  Popover as AriaPopover,
  Radio as AriaRadio,
  RadioGroup as AriaRadioGroup,
  SearchField as AriaSearchField,
  Switch as AriaSwitch,
  Tab,
  TabList,
  TabPanel,
  Tabs as AriaTabs,
  TextArea as AriaTextArea,
  TextField as AriaTextField,
  Tooltip as AriaTooltip,
  TooltipTrigger
} from "react-aria-components";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";
export type ButtonVariant = "primary" | "secondary" | "subtle" | "ghost" | "danger";
export type ActionModel = {
  id?: string;
  label: string;
  href?: string;
  disabled?: boolean;
  disabledReason?: string;
  onAction?: () => void;
};

/** Combines class names for Tangent UI elements. */
function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export type ButtonProps = Omit<React.ComponentProps<typeof AriaButton>, "children" | "className"> & {
  children?: ReactNode;
  className?: string;
  variant?: ButtonVariant;
  isLoading?: boolean;
  disabled?: boolean;
};

/** Renders the Button UI. */
export function Button({ className, variant = "secondary", isLoading, children, disabled, ...props }: ButtonProps): React.ReactElement {
  return (
    <AriaButton
      {...props}
      isDisabled={disabled || isLoading}
      className={cx("tg-button", `tg-button--${variant}`, isLoading && "tg-button--loading", className)}
    >
      <span className="tg-button__content">{children}</span>
    </AriaButton>
  );
}

export type IconButtonProps = ButtonProps & {
  label: string;
};

/** Renders the IconButton UI. */
export function IconButton({ label, children, ...props }: IconButtonProps): React.ReactElement {
  return (
    <Button {...props} className={cx("tg-icon-button", props.className)} aria-label={label}>
      {children}
    </Button>
  );
}

/** Renders the Link UI. */
export function Link({ className, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>): React.ReactElement {
  return <a {...props} className={cx("tg-link", className)} />;
}

/** Renders the Text UI. */
export function Text({ className, ...props }: HTMLAttributes<HTMLParagraphElement>): React.ReactElement {
  return <p {...props} className={cx("tg-text", className)} />;
}

/** Renders the Heading UI. */
export function Heading({ className, level = 2, ...props }: HTMLAttributes<HTMLHeadingElement> & { level?: 1 | 2 | 3 | 4 }): React.ReactElement {
  return <AriaHeading {...props} level={level} className={cx("tg-heading", `tg-heading--${level}`, className)} />;
}

/** Renders the Badge UI. */
export function Badge({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }): React.ReactElement {
  return <span {...props} className={cx("tg-badge", `tg-badge--${tone}`, className)} />;
}

/** Renders the Kbd UI. */
export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>): React.ReactElement {
  return <kbd {...props} className={cx("tg-kbd", className)} />;
}

/** Renders the Tooltip UI. */
export function Tooltip({ children, content }: { children: ReactNode; content: ReactNode }): React.ReactElement {
  return (
    <TooltipTrigger delay={350}>
      {children}
      <AriaTooltip className="tg-tooltip">{content}</AriaTooltip>
    </TooltipTrigger>
  );
}

/** Renders the Popover UI. */
export function Popover({ children }: { children: ReactNode }): React.ReactElement {
  return <AriaPopover className="tg-popover">{children}</AriaPopover>;
}

/** Renders the Dialog UI. */
export function Dialog({
  title,
  children,
  trigger
}: {
  title: ReactNode;
  children: ReactNode;
  trigger: ReactNode;
}): React.ReactElement {
  return (
    <DialogTrigger>
      {trigger}
      <ModalOverlay className="tg-modal-overlay">
        <Modal className="tg-modal">
          <AriaDialog className="tg-dialog">
            <Heading level={2}>{title}</Heading>
            {children}
          </AriaDialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

export const Drawer = Dialog;

/** Renders the Tabs UI. */
export function Tabs({
  tabs,
  "aria-label": ariaLabel = "Tabs"
}: {
  tabs: Array<{ id: string; label: ReactNode; panel: ReactNode }>;
  "aria-label"?: string;
}): React.ReactElement {
  return (
    <AriaTabs className="tg-tabs" aria-label={ariaLabel}>
      <TabList className="tg-tab-list">
        {tabs.map((tab) => <Tab key={tab.id} id={tab.id} className="tg-tab">{tab.label}</Tab>)}
      </TabList>
      {tabs.map((tab) => <TabPanel key={tab.id} id={tab.id} className="tg-tab-panel">{tab.panel}</TabPanel>)}
    </AriaTabs>
  );
}

/** Renders the Checkbox UI. */
export function Checkbox({ children, ...props }: React.ComponentProps<typeof AriaCheckbox>): React.ReactElement {
  return <AriaCheckbox {...props} className={cx("tg-checkbox", props.className as string | undefined)}>{children}</AriaCheckbox>;
}

/** Renders the RadioGroup UI. */
export function RadioGroup({ children, ...props }: React.ComponentProps<typeof AriaRadioGroup>): React.ReactElement {
  return <AriaRadioGroup {...props} className={cx("tg-radio-group", props.className as string | undefined)}>{children}</AriaRadioGroup>;
}

/** Renders the Radio UI. */
export function Radio({ children, ...props }: React.ComponentProps<typeof AriaRadio>): React.ReactElement {
  return <AriaRadio {...props} className={cx("tg-radio", props.className as string | undefined)}>{children}</AriaRadio>;
}

/** Renders the Switch UI. */
export function Switch({ children, ...props }: React.ComponentProps<typeof AriaSwitch>): React.ReactElement {
  return <AriaSwitch {...props} className={cx("tg-switch", props.className as string | undefined)}>{children}</AriaSwitch>;
}

/** Renders the TextField UI. */
export function TextField({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }): React.ReactElement {
  return (
    <AriaTextField className="tg-field">
      <Label className="tg-field__label">{label}</Label>
      <Input {...props} className="tg-input" />
    </AriaTextField>
  );
}

/** Renders the TextArea UI. */
export function TextArea({ label, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: ReactNode }): React.ReactElement {
  return (
    <AriaTextField className="tg-field">
      <Label className="tg-field__label">{label}</Label>
      <AriaTextArea {...props} className="tg-input tg-textarea" />
    </AriaTextField>
  );
}

/** Renders the SearchField UI. */
export function SearchField({ label = "Search", ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }): React.ReactElement {
  return (
    <AriaSearchField className="tg-field tg-search-field">
      <Label className="tg-field__label">{label}</Label>
      <Input {...props} className="tg-input" />
    </AriaSearchField>
  );
}

/** Renders the Select UI. */
export function Select({ label, children }: { label: ReactNode; children: ReactNode }): React.ReactElement {
  return (
    <label className="tg-field">
      <span className="tg-field__label">{label}</span>
      <select className="tg-input">{children}</select>
    </label>
  );
}

export const Combobox = SearchField;
export const Menu = Popover;

/** Renders the Table UI. */
export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>): React.ReactElement {
  return <table {...props} className={cx("tg-table", className)} />;
}

/** Renders the DataGrid UI. */
export function DataGrid({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div {...props} role="grid" className={cx("tg-data-grid", className)} />;
}

/** Renders the Tree UI. */
export function Tree({ className, ...props }: HTMLAttributes<HTMLUListElement>): React.ReactElement {
  return <ul {...props} role="tree" className={cx("tg-tree", className)} />;
}

/** Renders the Disclosure UI. */
export function Disclosure({ title, children }: { title: ReactNode; children: ReactNode }): React.ReactElement {
  return (
    <AriaDisclosure className="tg-disclosure">
      <Button slot="trigger" variant="ghost">{title}</Button>
      <DisclosurePanel className="tg-disclosure__panel">{children}</DisclosurePanel>
    </AriaDisclosure>
  );
}

export const Accordion = Disclosure;

/** Renders the Toast UI. */
export function Toast({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div {...props} role="status" className={cx("tg-toast", className)} />;
}

/** Renders the Banner UI. */
export function Banner({ tone = "info", className, ...props }: HTMLAttributes<HTMLDivElement> & { tone?: Tone }): React.ReactElement {
  return <div {...props} role="status" className={cx("tg-banner", `tg-banner--${tone}`, className)} />;
}

/** Renders the Spinner UI. */
export function Spinner({ label = "Loading" }: { label?: string }): React.ReactElement {
  return <span className="tg-spinner" role="status" aria-label={label} />;
}

/** Renders the Skeleton UI. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div {...props} className={cx("tg-skeleton", className)} />;
}

/** Renders the EmptyState UI. */
export function EmptyState({ title, children }: { title: ReactNode; children?: ReactNode }): React.ReactElement {
  return <div className="tg-empty-state"><Heading level={3}>{title}</Heading>{children}</div>;
}

/** Renders the ErrorState UI. */
export function ErrorState({ title, children }: { title: ReactNode; children?: ReactNode }): React.ReactElement {
  return <div className="tg-error-state" role="alert"><Heading level={3}>{title}</Heading>{children}</div>;
}

/** Renders the VisuallyHidden UI. */
export function VisuallyHidden({ className, ...props }: HTMLAttributes<HTMLSpanElement>): React.ReactElement {
  return <span {...props} className={cx("tg-visually-hidden", className)} />;
}

/** Renders the FocusScope UI. */
export function FocusScope({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div {...props} className={cx("tg-focus-scope", className)} />;
}
