'use server';

import {
  addGroupMember,
  createAdminGroup,
  listAdminGroups,
  removeGroupMember,
  searchAdminUsers,
  updateAdminGroup,
} from './admin-api';
import { ApiError } from './api';

type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export const createGroupAction = async (
  name: string,
  description: string | null,
): Promise<ActionResult<{ id: string }>> => {
  try {
    const group = await createAdminGroup({ name, description });
    return { ok: true, data: { id: group.id } };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 409) return { ok: false, error: 'Já existe um grupo com este nome.' };
      if (err.status === 400) return { ok: false, error: 'Dados inválidos.' };
      return { ok: false, error: err.message };
    }
    return { ok: false, error: 'Erro inesperado. Tente novamente.' };
  }
};

export const updateGroupAction = async (
  id: string,
  name: string,
  description: string | null,
): Promise<ActionResult> => {
  try {
    await updateAdminGroup(id, { name, description });
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 404) return { ok: false, error: 'Grupo não encontrado.' };
      if (err.status === 409) return { ok: false, error: 'Já existe um grupo com este nome.' };
      return { ok: false, error: err.message };
    }
    return { ok: false, error: 'Erro inesperado. Tente novamente.' };
  }
};

export const addGroupMemberAction = async (
  groupId: string,
  userId: string,
): Promise<ActionResult> => {
  try {
    await addGroupMember(groupId, userId);
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 409) return { ok: false, error: 'Usuário já está neste grupo.' };
      if (err.status === 404) return { ok: false, error: 'Grupo ou usuário não encontrado.' };
      return { ok: false, error: err.message };
    }
    return { ok: false, error: 'Erro inesperado. Tente novamente.' };
  }
};

export const removeGroupMemberAction = async (
  groupId: string,
  userId: string,
): Promise<ActionResult> => {
  try {
    await removeGroupMember(groupId, userId);
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 404) return { ok: false, error: 'Membro não encontrado.' };
      return { ok: false, error: err.message };
    }
    return { ok: false, error: 'Erro inesperado. Tente novamente.' };
  }
};

export interface UserSearchResult {
  id: string;
  name: string;
  email: string;
}

export const searchUsersAction = async (q: string): Promise<UserSearchResult[]> => {
  try {
    const res = await searchAdminUsers({ q: q.trim(), limit: 8 });
    return res.items.map((u) => ({ id: u.id, name: u.name, email: u.email }));
  } catch {
    return [];
  }
};

export interface GroupOption {
  id: string;
  name: string;
}

export const listGroupsAction = async (): Promise<GroupOption[]> => {
  try {
    const res = await listAdminGroups({ limit: 100 });
    return res.items.map((g) => ({ id: g.id, name: g.name }));
  } catch {
    return [];
  }
};
