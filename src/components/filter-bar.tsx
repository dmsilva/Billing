"use client";

import { useState, useMemo } from "react";

export interface FilterConfig {
  searchPlaceholder?: string;
  months?: string[];
  properties?: string[];
  categories?: string[];
  paymentSources?: string[];
  statuses?: string[];
}

export interface FilterState {
  search: string;
  month: string;
  property: string;
  category: string;
  payment: string;
  status: string;
}

const EMPTY: FilterState = { search: "", month: "", property: "", category: "", payment: "", status: "" };

export function useFilters() {
  const [filters, setFilters] = useState<FilterState>(EMPTY);
  const update = (key: keyof FilterState, value: string) =>
    setFilters(prev => ({ ...prev, [key]: value }));
  const reset = () => setFilters(EMPTY);
  const active = Object.values(filters).some(v => v !== "");
  return { filters, update, reset, active };
}

export function FilterBar({
  config,
  filters,
  onUpdate,
  onReset,
  active,
}: {
  config: FilterConfig;
  filters: FilterState;
  onUpdate: (key: keyof FilterState, value: string) => void;
  onReset: () => void;
  active: boolean;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={filters.search}
        onChange={e => onUpdate("search", e.target.value)}
        placeholder={config.searchPlaceholder || "Pesquisar…"}
        className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-[12px] w-[220px] focus:outline-none focus:border-[var(--accent)]"
      />

      {config.months && config.months.length > 0 && (
        <Select label="Mês" value={filters.month} options={config.months} onChange={v => onUpdate("month", v)} />
      )}
      {config.properties && config.properties.length > 0 && (
        <Select label="Imóvel" value={filters.property} options={config.properties} onChange={v => onUpdate("property", v)} />
      )}
      {config.categories && config.categories.length > 0 && (
        <Select label="Categoria" value={filters.category} options={config.categories} onChange={v => onUpdate("category", v)} />
      )}
      {config.paymentSources && config.paymentSources.length > 0 && (
        <Select label="Pagamento" value={filters.payment} options={config.paymentSources} onChange={v => onUpdate("payment", v)} />
      )}
      {config.statuses && config.statuses.length > 0 && (
        <Select label="Estado" value={filters.status} options={config.statuses} onChange={v => onUpdate("status", v)} />
      )}

      {active && (
        <button
          onClick={onReset}
          className="rounded-lg bg-[#f0f0f4] px-2.5 py-2 text-[11px] font-[700] text-[#667] hover:bg-[#e4e4ea]"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}

function Select({ label, value, options, onChange }: {
  label: string; value: string; options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="rounded-[10px] border border-[var(--line)] bg-white px-2.5 py-2 text-[12px] focus:outline-none focus:border-[var(--accent)]"
    >
      <option value="">{label}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
