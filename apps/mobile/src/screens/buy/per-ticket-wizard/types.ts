import type { TicketTier } from '@jdm/shared/events';
import type { ComponentType } from 'react';

/**
 * Data collected for a single ticket during the wizard flow.
 * Each pluggable step appends its key to this record.
 */
export type TicketData = Record<string, unknown>;

/** Context passed to every wizard step component. */
export interface WizardStepProps {
  /** Zero-based index of the ticket being configured. */
  ticketIndex: number;
  /** Total tickets the user is purchasing. */
  totalTickets: number;
  /** The selected tier for this purchase. */
  tier: TicketTier;
  /** Data collected so far for this ticket (from previous steps). */
  data: TicketData;
  /** Advance to next step, passing the data this step collected. */
  onNext: (stepData: TicketData) => void;
  /** Go back to the previous step. */
  onBack: () => void;
}

/**
 * Contract for pluggable wizard steps.
 *
 * C7 (extras) and E3 (car/plate) implement this to plug into the wizard.
 * Steps are rendered in array order for each ticket.
 *
 * @example
 * ```ts
 * const extrasStep: WizardStepDefinition = {
 *   id: 'extras',
 *   label: 'Extras',
 *   component: ExtrasStepScreen,
 *   appliesTo: () => true,
 * };
 * ```
 */
export interface WizardStepDefinition {
  /** Unique step identifier (e.g. 'extras', 'car-plate'). */
  id: string;
  /** Human-readable label shown in the step indicator (PT-BR). */
  label: string;
  /** The step screen component. Receives WizardStepProps. */
  component: ComponentType<WizardStepProps>;
  /**
   * Predicate: should this step appear for the given tier?
   * Omit or return true to always show.
   */
  appliesTo?: (context: { tier: TicketTier }) => boolean;
}

/** Position within the wizard navigation. */
export interface WizardPosition {
  ticketIndex: number;
  stepIndex: number;
}

/** Full wizard state managed by the reducer. */
export interface WizardState {
  eventId: string;
  tier: TicketTier;
  quantity: number;
  steps: WizardStepDefinition[];
  position: WizardPosition;
  /** Per-ticket collected data. Index = ticketIndex. */
  tickets: TicketData[];
  /** True when on the final review screen. */
  reviewing: boolean;
  /** True when purchasing extras only (user already has ticket). */
  extrasOnly: boolean;
  /** Payment method — 'card' (Stripe) or 'pix' (AbacatePay). */
  method: 'card' | 'pix';
}

export type WizardAction =
  | { type: 'NEXT'; stepData: TicketData }
  | { type: 'BACK' }
  | { type: 'GO_TO_REVIEW' }
  | { type: 'RESET' };

/**
 * Callback invoked after the review screen successfully calls `createOrder`.
 * Receives the API response fields needed to initiate Stripe payment.
 * The wizard does NOT pass ticket extras here — those are sent to the API
 * in the order payload. This callback only drives the payment sheet.
 */
export type OnOrderCreated = (order: {
  orderId: string;
  clientSecret: string;
  amountCents: number;
  currency: string;
}) => void | Promise<void>;
