import React from "react";

export interface TableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
}

export function Table<T>({ columns, data, rowKey, emptyMessage = "No hay datos para mostrar." }: TableProps<T>) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-text-muted">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-black/5 bg-surface">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-black/5 bg-background/60">
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-6 py-3 text-xs font-bold uppercase tracking-wide text-primary"
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={rowKey(row)} className="border-b border-black/5 last:border-0 hover:bg-background/40">
              {columns.map((col) => (
                <td key={col.key} className={["px-6 py-4", col.className ?? ""].join(" ")}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
