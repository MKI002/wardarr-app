// Types of the issue engine. Signals are raw observations; groups are causes.

export type Severity = 'critical' | 'warning' | 'info';
export type SignalLevel = 'error' | 'warning' | 'notice' | 'info';

/** Where a problem lives: in a connected service or in Wardarr itself. */
export type IssueOrigin = 'service' | 'wardarr';

export interface InstanceRef {
  id: string;
  name: string;
  adapter: string;
}

export type SignalKind = 'health' | 'connection' | 'queueItem' | 'cache' | 'update';

/** A single observation, for example one health message of one instance. */
export interface Signal {
  origin: IssueOrigin;
  instance: InstanceRef;
  kind: SignalKind;
  /** Name of the health check or internal job that produced the signal. */
  source?: string;
  level: SignalLevel;
  /** Original text exactly as the service reported it. */
  message: string;
  wikiUrl?: string;
  data?: Record<string, unknown>;
}

/** A translatable message: an i18n key plus interpolation values. */
export interface Msg {
  key: string;
  params?: Record<string, string | number>;
}

/**
 * Action classes:
 * - safe: harmless, runs on click (test, recheck, retry)
 * - risky: changes something on a service, needs confirmation
 * - guide: a step-by-step instruction the user follows
 */
export type ActionClass = 'safe' | 'risky' | 'guide';

export type ActionKind =
  'recheck' | 'mute' | 'testIndexer' | 'reloadCache' | 'openLink' | 'openWardarr' | 'guide';

export interface IssueAction {
  id: string;
  kind: ActionKind;
  class: ActionClass;
  label: Msg;
  instanceId?: string;
  /** External link (openLink) or internal route (openWardarr). */
  href?: string;
  payload?: Record<string, string | number>;
  steps?: Msg[];
  confirm?: Msg;
}

export interface IssueDetail {
  instance: InstanceRef;
  source?: string;
  level: SignalLevel;
  message: string;
  wikiUrl?: string;
}

export interface IssueItem {
  label: string;
  instanceId: string;
  info?: Msg;
}

export interface IssueGroup {
  /** Stable fingerprint of the cause: `<ruleId>:<key>`. */
  fingerprint: string;
  ruleId: string;
  origin: IssueOrigin;
  severity: Severity;
  title: Msg;
  /** Short description of what is affected, for the "Affected" column. */
  affected: Msg;
  explanation: Msg;
  fix: Msg;
  /** Instances that reported this cause; "recheck" polls exactly these. */
  instances: InstanceRef[];
  details: IssueDetail[];
  items: IssueItem[];
  actions: IssueAction[];
}

/** What a rule found in one signal. One signal can name several causes. */
export interface RuleHit<P> {
  /** Stable part of the fingerprint, unique per cause within the rule. */
  key: string;
  params: P;
}

export interface MatchedSignal<P> {
  signal: Signal;
  params: P;
}

export interface RuleOutput {
  severity: Severity;
  title: Msg;
  affected: Msg;
  explanation: Msg;
  fix: Msg;
  items?: IssueItem[];
  actions: IssueAction[];
}

export interface RuleContext {
  /** Resolves a deep link into an instance UI, if the adapter supports it. */
  webUrl(
    instanceId: string,
    target?: { kind: 'indexer' | 'queue' | 'settings' | 'system'; id?: string | number },
  ): string | undefined;
  /** Finds an indexer by name on a connected Prowlarr instance. */
  findIndexer(name: string): { instanceId: string; indexerId: number } | undefined;
}

/**
 * A catalog rule: detection, explanation, recommended fix and actions.
 * Rules are fixed code, never generated.
 */
export interface IssueRule<P = Record<string, unknown>> {
  id: string;
  /** Returns null when the signal is not handled by this rule. */
  detect(signal: Signal): RuleHit<P>[] | null;
  build(matches: MatchedSignal<P>[], ctx: RuleContext): RuleOutput;
}
