import { beforeEach, describe, expect, it, vi } from 'vitest';

const alertSpy = vi.fn();
const platform = { OS: 'web' };
const showToast = vi.fn();

vi.mock('react-native', () => ({
  Alert: {
    alert: alertSpy,
  },
  Platform: platform,
}));

vi.mock('./toast', () => ({
  showToast,
}));

describe('confirm helpers', () => {
  beforeEach(() => {
    alertSpy.mockReset();
    showToast.mockReset();
    vi.resetModules();
    vi.unstubAllGlobals();
    platform.OS = 'web';
  });

  it('uses window.confirm on web', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('window', { confirm, alert: vi.fn() });

    const { confirmDestructive } = await import('./confirm');

    await expect(
      confirmDestructive('Excluir', 'Remover este carro?', 'Excluir', 'Cancelar'),
    ).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledWith('Excluir\n\nRemover este carro?');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('uses Alert buttons on native', async () => {
    platform.OS = 'ios';

    const { confirmDestructive } = await import('./confirm');
    const result = confirmDestructive('Excluir', 'Remover este carro?', 'Excluir', 'Cancelar');

    const [, , buttons] = alertSpy.mock.calls[0] as [
      string,
      string,
      { onPress?: () => void; text: string; style?: string }[],
    ];

    buttons[1]?.onPress?.();

    await expect(result).resolves.toBe(true);
    expect(buttons[0]).toMatchObject({ text: 'Cancelar', style: 'cancel' });
    expect(buttons[1]).toMatchObject({ text: 'Excluir', style: 'destructive' });
  });

  it('shows a toast instead of a blocking alert', async () => {
    const { showMessage } = await import('./confirm');

    showMessage('Algo deu errado.');
    expect(showToast).toHaveBeenCalledWith('Algo deu errado.');
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
