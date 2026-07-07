import type { WizardStepDefinition, WizardStepProps } from './types';

import { buyCopy } from '~/copy/buy';
import { CarPlatePicker } from '~/screens/cart/CarPlatePicker';

function CarPlateStepScreen({ data, onNext, onBack }: WizardStepProps) {
  const initialCarId = data.carId as string | undefined;
  const initialPlate = data.licensePlate as string | undefined;
  return (
    <CarPlatePicker
      {...(initialCarId !== undefined ? { initialCarId } : {})}
      {...(initialPlate !== undefined ? { initialPlate } : {})}
      onSubmit={({ carId, licensePlate, carLabel }) => onNext({ carId, licensePlate, carLabel })}
      onBack={onBack}
    />
  );
}

export function createCarPlateStep(): WizardStepDefinition {
  return {
    id: 'car-plate',
    label: buyCopy.carPlate.title,
    component: CarPlateStepScreen,
    appliesTo: (context) => context.tier.requiresCar,
  };
}
