"use client";

import { ListSearch } from "@/components/list-search";

export function CustomerSearch(props: { initialQuery: string; initialIncludeInactive: boolean }) {
  return (
    <ListSearch
      {...props}
      label="Buscar cliente por nome, telefone ou placa"
      placeholder="Nome, telefone ou placa"
    />
  );
}
