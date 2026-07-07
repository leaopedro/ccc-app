import { useCallback, useRef, useState } from 'react';

export type CepData = {
  street: string;
  neighborhood: string;
  city: string;
  stateCode: string;
};

export type CepLookupResult =
  | { status: 'success'; data: CepData }
  | { status: 'not_found' }
  | { status: 'error' };

type CepLookupState = { status: 'idle' } | { status: 'loading' } | CepLookupResult;

type ViaCepResponse = {
  erro?: boolean;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
};

export function stripCepDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export async function fetchCep(cep: string, signal?: AbortSignal): Promise<CepLookupResult> {
  const digits = stripCepDigits(cep);
  if (digits.length !== 8) return { status: 'not_found' };

  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, signal ? { signal } : {});

    if (!res.ok) return { status: 'not_found' };

    const json = (await res.json()) as ViaCepResponse;

    if (json.erro) return { status: 'not_found' };

    return {
      status: 'success',
      data: {
        street: json.logradouro ?? '',
        neighborhood: json.bairro ?? '',
        city: json.localidade ?? '',
        stateCode: json.uf ?? '',
      },
    };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    return { status: 'error' };
  }
}

export function useCepLookup() {
  const [state, setState] = useState<CepLookupState>({ status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  const lookup = useCallback(async (cep: string) => {
    const digits = stripCepDigits(cep);
    if (digits.length !== 8) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ status: 'loading' });

    try {
      const result = await fetchCep(cep, controller.signal);
      setState(result);
    } catch {
      // AbortError — ignore
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState({ status: 'idle' });
  }, []);

  return { state, lookup, reset };
}
