"use client";

import { Table } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "../button";

const PAGE_SIZE_OPTIONS = [10, 20, 30, 50];

const getPageRange = (current: number, total: number): (number | "...")[] => {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, "...", total];
  if (current >= total - 3) return [1, "...", total - 4, total - 3, total - 2, total - 1, total];
  return [1, "...", current - 1, current, current + 1, "...", total];
};

interface DataTablePaginationProps<TData> {
  table: Table<TData>;
  totalRows: number;
}

export const DataTablePagination = <TData,>({
  table,
  totalRows,
}: DataTablePaginationProps<TData>) => {
  const { pageIndex, pageSize } = table.getState().pagination;
  const totalPages = table.getPageCount();
  const from = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min((pageIndex + 1) * pageSize, totalRows);
  const pageRange = getPageRange(pageIndex + 1, totalPages);

  return (
    <div className="flex items-center justify-end px-6 py-4 border-t border-border">
      <div className="flex items-center gap-4">
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          Showing <span className="font-medium text-foreground">{from}–{to}</span> of{" "}
          <span className="font-medium text-foreground">{totalRows}</span>
        </span>
        <div className="w-px h-4 bg-border" />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Rows per page</span>
          <select
            value={pageSize}
            onChange={(e) => {
              table.setPageSize(Number(e.target.value));
              table.setPageIndex(0);
            }}
            className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring/30 cursor-pointer"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="icon-xs"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
            aria-label="First page"
          >
            <ChevronsLeft />
          </Button>
          <Button
            variant="secondary"
            size="icon-xs"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Previous page"
          >
            <ChevronLeft />
          </Button>

          {pageRange.map((page, i) =>
            page === "..." ? (
              <span
                key={`ellipsis-${i}`}
                className="w-7 h-7 flex items-center justify-center text-xs text-muted-foreground select-none"
              >
                …
              </span>
            ) : (
              <Button
                key={page}
                variant={page === pageIndex + 1 ? "default" : "outline"}
                size="xs"
                onClick={() => table.setPageIndex((page as number) - 1)}
                aria-label={`Page ${page}`}
                aria-current={page === pageIndex + 1 ? "page" : undefined}
                className="min-w-7 px-2"
              >
                {page}
              </Button>
            )
          )}

          <Button
            variant="secondary"
            size="icon-xs"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Next page"
          >
            <ChevronRight />
          </Button>
          <Button
            variant="secondary"
            size="icon-xs"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
            aria-label="Last page"
          >
            <ChevronsRight />
          </Button>
        </div>
      </div>
    </div>
  );
};
