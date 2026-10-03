"use client";

import {
  ColumnDef,
  OnChangeFn,
  PaginationState,
  SortingState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "../skeleton";
import { DataTablePagination } from "./data-table-pagination";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  className?: string;
  emptyMessage?: string;
  isLoading?: boolean;
  onRowClick?: (row: TData) => void;
  // Pagination
  pagination?: boolean;
  defaultPageSize?: number;
  // Server-side pagination — provide these when fetching data from the server
  manualPagination?: boolean;
  totalRows?: number;
  paginationState?: PaginationState;
  onPaginationChange?: OnChangeFn<PaginationState>;
}

export const DataTable = <TData, TValue>({
  columns,
  data,
  className,
  emptyMessage = "No results found.",
  isLoading = false,
  onRowClick,
  pagination = false,
  defaultPageSize = 10,
  manualPagination = false,
  totalRows,
  paginationState,
  onPaginationChange,
}: DataTableProps<TData, TValue>) => {
  const [internalPagination, setInternalPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: defaultPageSize,
  });
  const [sorting, setSorting] = useState<SortingState>([]);

  const resolvedPaginationState =
    manualPagination && paginationState ? paginationState : internalPagination;

  const resolvedOnPaginationChange: OnChangeFn<PaginationState> =
    manualPagination && onPaginationChange ? onPaginationChange : setInternalPagination;

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      ...(pagination && { pagination: resolvedPaginationState }),
    },
    onSortingChange: setSorting,
    ...(pagination && {
      onPaginationChange: resolvedOnPaginationChange,
      getPaginationRowModel: getPaginationRowModel(),
      manualPagination,
      // rowCount lets TanStack derive pageCount for server-side; ignored for client-side
      ...(manualPagination && {
        rowCount: totalRows ?? -1,
      }),
    }),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const resolvedTotalRows = manualPagination ? (totalRows ?? data.length) : data.length;
  const skeletonRows = resolvedPaginationState.pageSize;

  return (
    <div className={cn("flex flex-col", className)} suppressHydrationWarning>
      <div className="overflow-x-auto" suppressHydrationWarning>
        <table className="w-full" suppressHydrationWarning>
          <colgroup>
            {table.getVisibleLeafColumns().map((column) => (
              <col
                key={column.id}
                style={column.getSize() !== 150 ? { width: column.getSize() } : undefined}
              />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-background/50">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-border">
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                      className={cn(
                        "text-left px-6 py-4 text-xs font-semibold tracking-wider uppercase whitespace-nowrap",
                        canSort && "cursor-pointer select-none hover:text-foreground transition-colors"
                      )}
                    >
                      {header.isPlaceholder ? null : (
                        <div className="flex items-center gap-1.5">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {canSort && (
                            <span className="text-muted-foreground/50">
                              {sorted === "asc" ? (
                                <ArrowUp className="size-3" />
                              ) : sorted === "desc" ? (
                                <ArrowDown className="size-3" />
                              ) : (
                                <ArrowUpDown className="size-3" />
                              )}
                            </span>
                          )}
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody suppressHydrationWarning>
            {isLoading ? (
              Array.from({ length: skeletonRows }).map((_, rowIdx) => (
                <tr key={rowIdx} className="border-b border-border last:border-0" suppressHydrationWarning>
                  {columns.map((_, colIdx) => (
                    <td key={colIdx} className="px-6 py-4" suppressHydrationWarning>
                      <Skeleton className="h-4" />
                    </td>
                  ))}
                </tr>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-6 py-16 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(
                    "border-b border-border last:border-0 hover:bg-muted/30 transition-colors",
                    onRowClick && "cursor-pointer",
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-6 py-4 text-sm text-foreground">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && !isLoading && table.getPageCount() > 0 && (
        <DataTablePagination table={table} totalRows={resolvedTotalRows} />
      )}
    </div>
  );
};