export interface InventoryLine {
  quantity: number;
  unitPrice: number;
}

// Public signature is part of the fixture contract.
export function inventoryTotal(lines: InventoryLine[]): number {
  return lines.reduce((total, line) => total + line.quantity * Math.round(line.unitPrice), 0);
}
