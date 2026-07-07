import { SafeAreaView, StyleSheet, View } from 'react-native';

import { ReviewScreen } from './ReviewScreen';
import { StepIndicator } from './StepIndicator';
import { useWizard } from './context';

import { buyCopy } from '~/copy/buy';
import { theme } from '~/theme';

export function PerTicketWizard() {
  const { state, dispatch, totalStepCount, currentGlobalStep, isFirstStep, onExitWizard } =
    useWizard();
  const { position, steps, tickets, tier, reviewing } = state;

  if (reviewing) {
    return <ReviewScreen />;
  }

  const currentStep = steps[position.stepIndex];
  if (!currentStep) return null;

  const StepComponent = currentStep.component;
  const ticketLabel = buyCopy.wizard.ticketLabel(position.ticketIndex + 1, state.quantity);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <StepIndicator
          currentStep={currentGlobalStep}
          totalSteps={totalStepCount}
          ticketLabel={ticketLabel}
          stepLabel={currentStep.label}
        />
        <View style={styles.content}>
          <StepComponent
            ticketIndex={position.ticketIndex}
            totalTickets={state.quantity}
            tier={tier}
            data={tickets[position.ticketIndex] ?? {}}
            onNext={(stepData) => dispatch({ type: 'NEXT', stepData })}
            onBack={isFirstStep ? onExitWizard : () => dispatch({ type: 'BACK' })}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  container: { flex: 1 },
  content: { flex: 1 },
});
